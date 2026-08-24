/**
 * Decks on disk.
 *
 * For local development, and for the tests, which is the more important of the two:
 * it exercises exactly the same serialisation, validation and status handling as the
 * blob store, so the logic that can actually be wrong is covered without needing a
 * storage token in CI.
 *
 * Not usable on Vercel. The filesystem there is read-only apart from a temporary
 * directory that does not survive a request, which is why the blob store exists.
 */

import 'server-only';

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { DeckRecord } from '../deck-types';
import { parseDeck, serialiseDeck } from './serialise';
import { seedDecks } from './store-seeded';
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
 * Marks that the built-in decks have already been copied in.
 *
 * A separate file rather than an emptiness check, because the store being empty
 * is exactly the state after someone deletes the only deck, and re-seeding then
 * would bring it straight back. An in-process flag cannot stand in for this: on
 * serverless, every cold start is a new process and would seed again.
 */
const SEED_MARKER = '.seeded';

/** Everything about a deck that is not the deck itself. */
interface StoredMeta {
  status: DeckStatus;
  createdAt: string;
  updatedAt: string;
}

export class FilesystemDeckStore implements DeckStore {
  readonly kind = 'filesystem' as const;
  readonly writable = true;

  private seeded = false;
  /** True while seeding, so the saves it performs do not recurse. */
  private seeding = false;

  constructor(private readonly root: string) {}

  private deckDir(id: string): string {
    assertUsableDeckId(id);
    return join(this.root, id);
  }

  /**
   * Copies the built-in decks in, once ever, tracked by a persisted marker.
   *
   * The flag is set only after the work succeeds. Setting it first, which is the
   * obvious way to write this, means a single transient failure disables seeding for
   * the life of the process: every later request sees the flag, skips the work, and
   * reports an empty library. That is exactly how this behaved in the dev server,
   * while the same code seeded correctly when run directly.
   */
  private async ensureSeeded(): Promise<void> {
    if (this.seeded) return;

    await mkdir(this.root, { recursive: true });

    const marker = join(this.root, SEED_MARKER);
    const already = await readFile(marker, 'utf8').catch(() => null);
    if (already !== null) {
      this.seeded = true;
      return;
    }

    // The marker goes down first, so a failure partway through cannot seed twice.
    // `seeding` guards the reentry from save(), which calls back into here.
    await writeFile(marker, new Date().toISOString(), 'utf8');
    this.seeding = true;
    try {
      for (const { record, status } of seedDecks()) {
        await this.save(record, status);
      }
    } finally {
      this.seeding = false;
    }

    this.seeded = true;
  }

  async list(): Promise<DeckSummary[]> {
    await this.ensureSeeded();

    const entries = await readdir(this.root).catch(() => [] as string[]);
    const summaries: DeckSummary[] = [];

    for (const id of entries) {
      // The marker is not a deck.
      if (id.startsWith('.')) continue;
      // A deck that fails to parse is skipped in a listing rather than breaking it.
      // The library staying usable matters more than surfacing one bad deck here,
      // and `get` reports the reason properly when it is opened.
      const stored = await this.get(id).catch(() => undefined);
      if (stored) summaries.push(summarise(stored));
    }

    return summaries.sort((a, b) => a.title.localeCompare(b.title));
  }

  /**
   * Re-checks the marker when a lookup came up empty.
   *
   * `seeded` is a cache of "the marker was there", not proof that the decks still
   * are. If storage is emptied under a running process, the flag makes every later
   * request report that the deck does not exist, with nothing to explain it, until
   * someone restarts. Clearing the flag on a miss lets the next request re-seed.
   *
   * Only on the miss path, so the common case still costs nothing.
   */
  private async reseedIfEmptied(): Promise<void> {
    this.seeded = false;
    await this.ensureSeeded();
  }

  async get(id: string): Promise<StoredDeck | undefined> {
    await this.ensureSeeded();

    const dir = this.deckDir(id);
    let deckText = await readFile(join(dir, 'deck.json'), 'utf8').catch(() => null);

    if (deckText === null) {
      await this.reseedIfEmptied();
      deckText = await readFile(join(dir, 'deck.json'), 'utf8').catch(() => null);
    }

    if (deckText === null) return undefined;

    const parsed = parseDeck(deckText);
    if (!parsed.ok) throw new DeckInvalidError(id, parsed.errors);

    const metaText = await readFile(join(dir, 'meta.json'), 'utf8').catch(() => null);
    const meta = metaText ? (JSON.parse(metaText) as StoredMeta) : null;

    return {
      record: parsed.record,
      status: meta?.status === 'draft' ? 'draft' : 'published',
      createdAt: meta?.createdAt ?? new Date(0).toISOString(),
      updatedAt: meta?.updatedAt ?? new Date(0).toISOString(),
      readOnly: false,
    };
  }

  async save(record: DeckRecord, status: DeckStatus): Promise<DeckSummary> {
    // Seeding first, so a library whose first ever operation is an upload still
    // ends up with the built-in deck alongside it.
    if (!this.seeding) await this.ensureSeeded();

    const dir = this.deckDir(record.meta.id);
    await mkdir(dir, { recursive: true });

    // Preserved across a save, so editing a deck does not reset when it was made.
    const previous = await readFile(join(dir, 'meta.json'), 'utf8')
      .then((text) => JSON.parse(text) as StoredMeta)
      .catch(() => null);

    const now = new Date().toISOString();
    const meta: StoredMeta = {
      status,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };

    await writeFile(join(dir, 'deck.json'), serialiseDeck(record), 'utf8');
    await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

    return summarise({ record, ...meta, readOnly: false });
  }

  async remove(id: string): Promise<void> {
    await this.ensureSeeded();
    await rm(this.deckDir(id), { recursive: true, force: true });
  }
}

/** Where decks go when no blob token is set. Outside the build output on purpose. */
export function defaultFilesystemRoot(): string {
  return join(process.cwd(), '.data', 'decks');
}

export { dirname };
