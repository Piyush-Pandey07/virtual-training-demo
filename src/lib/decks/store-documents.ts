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
const SEED = 'deck-seed';
const SEED_MARKER = 'marker';

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

    await this.docs.set(SEED, SEED_MARKER, { at: new Date().toISOString() });
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
      this.docs.all<{ slide: DeckSlide }>(slidesOf(id)),
      this.docs.all<{ topic: KnowledgeTopic }>(topicsOf(id)),
    ]);

    const record: DeckRecord = {
      meta: document.meta,
      slides: slides.map((row) => row.slide).sort((a, b) => a.id - b.id),
      topics: topics.map((row) => row.topic),
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

    // Slides and topics are replaced rather than merged. A re-analysis produces a
    // different number of both, and leaving the old ones would give a deck slides its
    // record does not list and topics nothing points at.
    await this.clearParts(id);

    await Promise.all([
      ...record.slides.map((slide) =>
        this.docs.set(slidesOf(id), ordinal(slide.id), { id: slide.id, slide }),
      ),
      ...record.topics.map((topic, index) =>
        this.docs.set(topicsOf(id), ordinal(index), { id: index, topic }),
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
    };

    // The deck document last. While it is absent the deck does not exist, so a failure
    // part-way leaves parts nobody can reach rather than a deck missing its slides.
    await this.docs.set(DECKS, id, document);

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

  private async clearParts(id: string): Promise<void> {
    for (const collection of [slidesOf(id), topicsOf(id)]) {
      const rows = await this.docs.all<{ id: number }>(collection).catch(() => []);
      await Promise.all(
        rows.map((row) => this.docs.remove(collection, ordinal(row.id)).catch(() => undefined)),
      );
    }
  }
}
