import 'server-only';

import type { DeckRecord, DeckSlide } from '../deck-types';
import type { KnowledgeTopic } from '../knowledge/types';
import type { DocumentStore } from '../roster/documents';
import { ISMS_DECK } from './isms';
import { parseDeck, serialiseDeck } from './serialise';
import {
  assertUsableDeckId,
  DeckInvalidError,
  summarise,
  type DeckStatus,
  type DeckStore,
  type DeckSummary,
  type StoredDeck,
} from './store';

/**
 * Decks in the document database, beside everything else about a customer.
 *
 * The structured half of a deck lives here and the rendered slide images stay in blob
 * storage, which is the split that matters: a deck record is queried, versioned and
 * written transactionally, and an image is fetched by name and served. Nothing about a
 * picture benefits from being in a database.
 *
 * **One document per slide, not one per deck.** A deck record is roughly fifteen
 * kilobytes per slide once analysed, and a Firestore document is capped at one
 * mebibyte, so a whole deck in one document would fail at about sixty-nine slides
 * against an upload limit of five hundred pages. Splitting removes the cliff and costs
 * nothing: a collection read returns every slide in one round trip, so loading a deck
 * is three reads whatever its size.
 *
 *   orgs/{org}/decks/{id}                 the deck, minus its slides and topics
 *   orgs/{org}/decks/{id}/slides/{n}      one per slide
 *   orgs/{org}/decks/{id}/topics/{n}      one per topic
 *
 * The store is handed an already-scoped document store, so every path above is
 * relative to one customer and this file never names an organisation.
 */

const DECKS = 'decks';

/**
 * The seeding marker, in its own collection.
 *
 * Not a document inside `decks`, which would then have to be filtered out of every
 * listing and would be one forgotten filter away from appearing as a deck.
 */
export const SEED = 'deck-seed';
const SEED_MARKER = 'marker';

/**
 * The collections this store owns, for whoever has to delete a customer.
 *
 * Exported rather than remembered. Deleting a customer has to name every collection
 * under their prefix, because Firestore keeps a subcollection when its parent goes,
 * and a list kept somewhere else drifts the moment a store gains a collection. Slides
 * and topics are not here: they hang off a deck and go when `remove` takes it.
 */
export const DECK_COLLECTIONS = [DECKS, SEED] as const;

/** The deck document, which is everything except the parts that are split out. */
interface DeckDocument {
  id: string;
  status: DeckStatus;
  createdAt: string;
  updatedAt: string;
  /** The record's own metadata, small and always read with the deck. */
  meta: DeckRecord['meta'];
  /** Counted on write so a listing needs no subcollection reads. */
  slideCount: number;
  totalSeconds: number;
  /**
   * Which set of slides and topics belongs to this deck right now.
   *
   * Absent on a deck written before generations existed, whose parts carry no
   * generation either. Both are read as one implicit generation, so an old deck keeps
   * working and gains a real one the next time it is saved.
   */
  generation?: string;
}

/**
 * One slide or topic, stamped with the generation that wrote it.
 *
 * `slide` and `topic` are the shape used before generations existed, when each part
 * held its content under the field's own name. Both are read: a store that cannot read
 * what it wrote last week is worse than one carrying a field it no longer writes, and
 * every deck already in the database was written that way. A save upgrades them.
 */
interface Part<T> {
  id: number;
  generation?: string;
  value?: T;
  slide?: T;
  topic?: T;
}

/** What a part holds, whichever shape wrote it. */
function valueOf<T>(part: Part<T>): T | undefined {
  return part.value ?? part.slide ?? part.topic;
}

function slidesOf(deckId: string): string {
  return `${DECKS}/${deckId}/slides`;
}

function topicsOf(deckId: string): string {
  return `${DECKS}/${deckId}/topics`;
}

/**
 * A document id that sorts the way a reader expects.
 *
 * Firestore orders ids as strings, so slide 10 would come before slide 2. Padding is
 * cheaper than sorting after the fact and means a listing arrives in order.
 */
function ordinal(index: number): string {
  return String(index).padStart(4, '0');
}

/**
 * A name for one write of a deck's parts.
 *
 * Time first so the ids sort by age, which is what makes an interrupted save's leftover
 * parts recognisable later. The random tail is what stops two saves in the same
 * millisecond sharing one.
 */
function newGeneration(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function partId(generation: string, index: number): string {
  return `${generation}-${ordinal(index)}`;
}

/**
 * The document id a part was stored under.
 *
 * A part written before generations existed has none, and was stored under its bare
 * ordinal. Both shapes have to be addressable or the old ones cannot be cleaned up.
 */
function idOf(part: { id: number; generation?: string }): string {
  return part.generation ? partId(part.generation, part.id) : ordinal(part.id);
}

export class DocumentDeckStore implements DeckStore {
  readonly kind = 'documents' as const;
  readonly writable = true;

  private seeded = false;
  private seeding = false;

  constructor(private readonly docs: DocumentStore) {}

  /**
   * Copies the worked example in, once ever, tracked by a persisted marker.
   *
   * A marker rather than an emptiness check, and the other two stores learned this the
   * same way. Empty is exactly the state a delete leaves behind, so "seed when there
   * are no decks" hands a customer back the example every time they remove it. And
   * "skip when there is anything" loses the example entirely when an upload happens to
   * be the very first operation against a new customer.
   *
   * The marker is written before the deck, so a failure partway cannot seed twice.
   * `seeding` guards the reentry from `save`, which calls back into here.
   */
  private async ensureSeeded(): Promise<void> {
    if (this.seeded) return;

    const already = await this.docs.get<{ at: string }>(SEED, SEED_MARKER).catch(() => undefined);
    if (already) {
      this.seeded = true;
      return;
    }

    // Carries its own id so anything sweeping the collection can address it. Without
    // that the marker outlived the customer it belonged to: a purge could read it and
    // not name it, and a reused organisation id would then never be seeded.
    await this.docs.set(SEED, SEED_MARKER, { id: SEED_MARKER, at: new Date().toISOString() });
    this.seeding = true;
    try {
      await this.save(ISMS_DECK, 'published');
    } finally {
      this.seeding = false;
    }

    this.seeded = true;
  }

  async list(): Promise<DeckSummary[]> {
    await this.ensureSeeded();

    const documents = await this.docs.all<DeckDocument>(DECKS);
    return documents
      .map((deck) => ({
        id: deck.id,
        title: deck.meta.title,
        subtitle: deck.meta.subtitle,
        status: deck.status,
        slideCount: deck.slideCount,
        estimatedMinutes: Math.round(deck.totalSeconds / 60),
        createdAt: deck.createdAt,
        updatedAt: deck.updatedAt,
        readOnly: false,
        origin: deck.meta.origin ?? ('uploaded' as const),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async get(id: string): Promise<StoredDeck | undefined> {
    assertUsableDeckId(id);
    await this.ensureSeeded();

    const document = await this.docs.get<DeckDocument>(DECKS, id);
    if (!document) return undefined;

    const [slides, topics] = await Promise.all([
      this.docs.all<Part<DeckSlide>>(slidesOf(id)),
      this.docs.all<Part<KnowledgeTopic>>(topicsOf(id)),
    ]);

    // Only the generation this deck currently points at. Anything else is either a save
    // that lost a race or one that was interrupted, and in both cases it is a complete
    // set of somebody else's slides sitting in the same collection. Reading them would
    // produce a deck that is a blend of two.
    const current = (part: Part<unknown>) =>
      (part.generation ?? '') === (document.generation ?? '');

    const present = <T>(value: T | undefined): value is T => value !== undefined;

    const record: DeckRecord = {
      meta: document.meta,
      slides: slides
        .filter(current)
        .map(valueOf)
        .filter(present)
        .sort((a, b) => a.id - b.id),
      topics: topics.filter(current).map(valueOf).filter(present),
    };

    // Round-tripped through the same validation a stored file gets. The pieces were
    // written separately and are being put back together here, which is exactly where
    // a deck that no longer makes sense as a whole should be caught.
    const parsed = parseDeck(serialiseDeck(record));
    if (!parsed.ok) throw new DeckInvalidError(id, parsed.errors);

    return {
      record: parsed.record,
      status: document.status,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      readOnly: false,
      metaMissing: false,
    };
  }

  async save(record: DeckRecord, status: DeckStatus): Promise<DeckSummary> {
    const id = record.meta.id;
    assertUsableDeckId(id);
    if (!this.seeding) await this.ensureSeeded();

    const now = new Date().toISOString();
    const existing = await this.docs.get<DeckDocument>(DECKS, id);

    // A new generation, written alongside whatever is already there rather than over
    // it. Clearing first and writing after is the obvious shape and the wrong one: two
    // saves of the same deck interleave into a single set holding some slides from each,
    // and the deck document then disagrees with the slides it counts.
    //
    // Firestore's batched write would fix the race and not the size -- a batch holds
    // five hundred operations, and a five-hundred-slide deck needs more than that for
    // its slides alone. Generations have no such ceiling.
    const generation = newGeneration();

    await Promise.all([
      ...record.slides.map((slide) =>
        this.docs.set<Part<DeckSlide>>(slidesOf(id), partId(generation, slide.id), {
          id: slide.id,
          generation,
          value: slide,
        }),
      ),
      ...record.topics.map((topic, index) =>
        this.docs.set<Part<KnowledgeTopic>>(topicsOf(id), partId(generation, index), {
          id: index,
          generation,
          value: topic,
        }),
      ),
    ]);

    const document: DeckDocument = {
      id,
      status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      meta: record.meta,
      slideCount: record.slides.length,
      totalSeconds: record.slides.reduce((total, slide) => total + slide.targetSeconds, 0),
      generation,
    };

    // One write, and the deck is this generation's. Every reader either sees the old
    // set complete or the new set complete, never a mixture, because nothing points at
    // a half-written generation until this line runs.
    await this.docs.set(DECKS, id, document);

    // Everything older than what the deck now points at. Best effort and deliberately
    // after the switchover: a failure here leaves parts nobody reads, which costs
    // storage, where a failure before it would have left a deck with no slides at all.
    await this.sweep(id).catch(() => undefined);

    return summarise({
      record,
      status,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      readOnly: false,
      metaMissing: false,
    });
  }

  async remove(id: string): Promise<void> {
    assertUsableDeckId(id);
    await this.ensureSeeded();

    // The deck document first here, for the same reason it is written last: from this
    // moment the deck is gone as far as everything else is concerned, and what remains
    // is tidying.
    await this.docs.remove(DECKS, id);
    await this.clearParts(id);
  }

  /**
   * Removes parts, keeping one generation when asked to.
   *
   * `keep` is the generation the deck now points at. Without it everything goes, which
   * is what removing a deck wants.
   */
  /**
   * Removes every generation older than the one the deck currently points at.
   *
   * Reads the deck document again rather than trusting the generation this save just
   * wrote. Two saves racing both sweep, and a sweep that kept only its own generation
   * deleted the winner's slides out from under it: the loser switched nothing, then
   * tidied away everything that was not its own, including the set the deck had just
   * started pointing at. The deck was left with no slides and no error until somebody
   * opened it.
   *
   * Anything newer is left alone too. It can only be a save still in flight, and when
   * it switches over its own sweep removes what this one kept. Generations begin with a
   * base-36 millisecond stamp, so comparing them as strings compares their age.
   */
  private async sweep(id: string): Promise<void> {
    const document = await this.docs.get<DeckDocument>(DECKS, id);
    const current = document?.generation;
    if (!current) return;

    for (const collection of [slidesOf(id), topicsOf(id)]) {
      const rows = await this.docs.all<Part<unknown>>(collection).catch(() => []);
      await Promise.all(
        rows
          .filter((row) => !row.generation || row.generation < current)
          .map((row) => this.docs.remove(collection, idOf(row)).catch(() => undefined)),
      );
    }
  }

  /** Removes every part of a deck, whatever generation wrote it. For `remove`. */
  private async clearParts(id: string): Promise<void> {
    for (const collection of [slidesOf(id), topicsOf(id)]) {
      const rows = await this.docs.all<Part<unknown>>(collection).catch(() => []);
      await Promise.all(
        rows.map((row) => this.docs.remove(collection, idOf(row)).catch(() => undefined)),
      );
    }
  }
}
