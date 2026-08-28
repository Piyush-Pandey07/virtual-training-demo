/**
 * Where decks live.
 *
 * One interface, three implementations, because this app has to run in three
 * situations that genuinely differ: a deployment with blob storage configured, a
 * developer's machine, and a deployment with nothing configured at all.
 *
 * That third one is not a hypothetical. The demo is deployed and working with two
 * environment variables set, and a change that made it require a third would break
 * it the moment it shipped. So no configuration means the built-in deck, read-only,
 * which is exactly how the app behaved before storage existed.
 *
 * Deliberately not a database. The reason to want one was querying which decks have
 * unresolved blocking flags before allowing a publish, and that query turns out not
 * to exist: publish is always about one deck, so its flags can live in one object
 * beside it. Blob storage also has to hold the slide images regardless, so this way
 * there is one place decks live rather than two, and one environment variable
 * instead of a database with migrations.
 */

import 'server-only';

import type { DeckOrigin, DeckRecord } from '../deck-types';

export type DeckStatus = 'draft' | 'published';

/** Enough to list a deck without loading it. */
export interface DeckSummary {
  id: string;
  title: string;
  subtitle: string;
  status: DeckStatus;
  slideCount: number;
  estimatedMinutes: number;
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
  /** True for a deck that came from code and cannot be edited or deleted. */
  readOnly: boolean;
  /**
   * Where the deck's content came from.
   *
   * Distinct from `readOnly`, which is a property of the store rather than of the
   * deck: seeding the built-in deck into a writable store makes it editable while
   * leaving it authored. Absent on decks stored before the field existed, read as
   * uploaded, which is the same permissive reading DeckMeta documents.
   */
  origin: DeckOrigin;
}

export interface StoredDeck {
  record: DeckRecord;
  status: DeckStatus;
  createdAt: string;
  updatedAt: string;
  readOnly: boolean;
  /**
   * True when the deck's `meta.json` was absent or unreadable.
   *
   * Such a deck reads as a draft, and this says why, so a deck that has gone dark
   * can be explained rather than guessed at.
   */
  metaMissing: boolean;
}

/** What sits beside a deck: its status and its timestamps. */
export interface StoredMeta {
  status: DeckStatus;
  createdAt: string;
  updatedAt: string;
}

const EPOCH = new Date(0).toISOString();

/**
 * Reads the metadata beside a deck, failing closed.
 *
 * Shared by both writable stores because they used to disagree: the blob store
 * caught a JSON parse failure and carried on, the filesystem store let it throw out
 * of `get()`. One failed open, the other failed closed by accident.
 *
 * Anything that cannot be read as metadata yields a draft. That is a change: this
 * used to yield `published`, on the reasoning that a deck with content and no
 * metadata is better readable than not. That reasoning held while published was a
 * label. It stops holding the moment published decides who may be taught from a
 * deck, because `save()` writes `deck.json` first and `meta.json` second — so a
 * failure between the two writes would promote an unreviewed deck to published and
 * put it in front of a trainee as though a person had checked it.
 */
export function readStoredMeta(text: string | null): {
  status: DeckStatus;
  createdAt: string;
  updatedAt: string;
  metaMissing: boolean;
} {
  let meta: StoredMeta | null = null;
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') meta = parsed as StoredMeta;
    } catch {
      meta = null;
    }
  }

  const status: DeckStatus | null =
    meta?.status === 'draft' || meta?.status === 'published' ? meta.status : null;

  return {
    status: status ?? 'draft',
    createdAt: typeof meta?.createdAt === 'string' ? meta.createdAt : EPOCH,
    updatedAt: typeof meta?.updatedAt === 'string' ? meta.updatedAt : EPOCH,
    metaMissing: status === null,
  };
}

export class DeckStoreError extends Error {}

/** A deck that is present but unusable. Separated so the cause can be shown. */
export class DeckInvalidError extends DeckStoreError {
  constructor(
    readonly deckId: string,
    readonly errors: string[],
  ) {
    super(`Deck "${deckId}" is stored but not valid:\n  ${errors.join('\n  ')}`);
  }
}

export interface DeckStore {
  /** Human-readable, for diagnostics and the health endpoint. */
  readonly kind: 'blob' | 'filesystem' | 'seeded';
  /** False for the seeded store, which is compiled in. */
  readonly writable: boolean;

  list(): Promise<DeckSummary[]>;
  /** Undefined when there is no such deck. Throws DeckInvalidError if it is corrupt. */
  get(id: string): Promise<StoredDeck | undefined>;
  save(record: DeckRecord, status: DeckStatus): Promise<DeckSummary>;
  remove(id: string): Promise<void>;
}

/** Rejects an id that could escape its prefix or collide with a path separator. */
export function assertUsableDeckId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    throw new DeckStoreError(
      `"${id}" is not a usable deck id. Use lower-case letters, numbers and hyphens.`,
    );
  }
}

export function summarise(stored: StoredDeck): DeckSummary {
  const { record } = stored;
  return {
    id: record.meta.id,
    title: record.meta.title,
    subtitle: record.meta.subtitle,
    status: stored.status,
    slideCount: record.slides.length,
    estimatedMinutes: Math.round(
      record.slides.reduce((total, slide) => total + slide.targetSeconds, 0) / 60,
    ),
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    readOnly: stored.readOnly,
    origin: record.meta.origin ?? 'uploaded',
  };
}
