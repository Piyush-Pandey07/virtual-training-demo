/**
 * Decks in Vercel Blob storage.
 *
 * This is the production store. It is also the one piece of this stage that cannot
 * be exercised without a real token, so the network calls are behind a small
 * injected client: everything that can actually be wrong, the key layout, the
 * seeding rule, status handling, parse failures, is tested against an in-memory
 * fake, and what is left is four calls to the Vercel SDK.
 *
 * A deck is a prefix, which is also where the slide images will go once uploads
 * exist:
 *
 *   decks/{id}/deck.json    the deck itself
 *   decks/{id}/meta.json    status and timestamps
 *   decks/{id}/pages/...    rendered slides, later
 */

import 'server-only';

import type { DeckRecord } from '../deck-types';
import type { BinaryBlobClient } from './assets';
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

export interface BlobEntry {
  pathname: string;
  url: string;
}

/**
 * The parts of blob storage this store needs.
 *
 * Injected rather than imported so the logic above it can be tested. The real
 * implementation is at the bottom of this file.
 */
export interface BlobClient {
  put(pathname: string, body: string): Promise<BlobEntry>;
  list(prefix: string): Promise<BlobEntry[]>;
  remove(urls: string[]): Promise<void>;
  /** Null when the object is absent. */
  read(url: string): Promise<string | null>;
}

interface StoredMeta {
  status: DeckStatus;
  createdAt: string;
  updatedAt: string;
}

const ROOT = 'decks';

/**
 * Marks that the built-in decks have already been copied in.
 *
 * A stored marker rather than an emptiness check, because empty is exactly the
 * state after someone deletes the only deck. An in-process flag is not enough
 * either: each serverless cold start is a fresh process and would seed again.
 */
const SEED_MARKER = `${ROOT}/.seeded`;

export class BlobDeckStore implements DeckStore {
  readonly kind = 'blob' as const;
  readonly writable = true;

  private seeded = false;
  /** True while seeding, so the saves it performs do not recurse. */
  private seeding = false;

  constructor(private readonly client: BlobClient) {}

  private prefix(id: string): string {
    assertUsableDeckId(id);
    return `${ROOT}/${id}`;
  }

  /**
   * Copies the built-in decks in, once ever, tracked by a stored marker.
   *
   * The flag is set only after the work succeeds. Setting it first, which is the
   * obvious way to write this, means a single transient failure disables seeding for
   * the life of the process: every later request sees the flag, skips the work, and
   * reports an empty library. That is exactly how this behaved in the dev server,
   * while the same code seeded correctly when run directly.
   */
  private async ensureSeeded(): Promise<void> {
    if (this.seeded) return;

    const existing = await this.client.list(SEED_MARKER);
    if (existing.some((blob) => blob.pathname === SEED_MARKER)) {
      this.seeded = true;
      return;
    }

    // The marker goes down first, so a failure partway through cannot seed twice.
    // `seeding` guards the reentry from save(), which calls back into here.
    await this.client.put(SEED_MARKER, new Date().toISOString());
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

  /** Deck ids present under the root, derived from the object keys. */
  private async ids(): Promise<string[]> {
    const blobs = await this.client.list(`${ROOT}/`);
    const found = new Set<string>();
    for (const blob of blobs) {
      // decks/{id}/deck.json — the id is the second segment, and a deck only counts
      // as present once its deck.json exists, so a half-finished upload is invisible.
      const parts = blob.pathname.split('/');
      if (parts.length >= 3 && parts[0] === ROOT && parts[2] === 'deck.json') {
        found.add(parts[1]);
      }
    }
    return [...found];
  }

  async list(): Promise<DeckSummary[]> {
    await this.ensureSeeded();

    const summaries: DeckSummary[] = [];
    for (const id of await this.ids()) {
      // One unparseable deck must not take the library down with it. `get` reports
      // the reason properly when that deck is actually opened.
      const stored = await this.get(id).catch(() => undefined);
      if (stored) summaries.push(summarise(stored));
    }

    return summaries.sort((a, b) => a.title.localeCompare(b.title));
  }

  async get(id: string): Promise<StoredDeck | undefined> {
    await this.ensureSeeded();

    const prefix = this.prefix(id);
    const blobs = await this.client.list(`${prefix}/`);
    const at = (name: string) => blobs.find((blob) => blob.pathname === `${prefix}/${name}`);

    const deckBlob = at('deck.json');
    if (!deckBlob) return undefined;

    const deckText = await this.client.read(deckBlob.url);
    if (deckText === null) return undefined;

    const parsed = parseDeck(deckText);
    if (!parsed.ok) throw new DeckInvalidError(id, parsed.errors);

    const metaBlob = at('meta.json');
    const metaText = metaBlob ? await this.client.read(metaBlob.url) : null;
    let meta: StoredMeta | null = null;
    try {
      meta = metaText ? (JSON.parse(metaText) as StoredMeta) : null;
    } catch {
      // Status and timestamps are recoverable; the deck itself is what matters.
      meta = null;
    }

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

    const prefix = this.prefix(record.meta.id);

    const existing = await this.client.list(`${prefix}/`);
    const metaBlob = existing.find((blob) => blob.pathname === `${prefix}/meta.json`);
    const previousText = metaBlob ? await this.client.read(metaBlob.url) : null;
    let previous: StoredMeta | null = null;
    try {
      previous = previousText ? (JSON.parse(previousText) as StoredMeta) : null;
    } catch {
      previous = null;
    }

    const now = new Date().toISOString();
    const meta: StoredMeta = { status, createdAt: previous?.createdAt ?? now, updatedAt: now };

    // The deck goes first. If the second write fails, the deck is still readable and
    // defaults to published, which is a better failure than a deck with metadata and
    // no content.
    await this.client.put(`${prefix}/deck.json`, serialiseDeck(record));
    await this.client.put(`${prefix}/meta.json`, JSON.stringify(meta, null, 2));

    return summarise({ record, ...meta, readOnly: false });
  }

  async remove(id: string): Promise<void> {
    await this.ensureSeeded();
    const blobs = await this.client.list(`${this.prefix(id)}/`);
    if (blobs.length > 0) await this.client.remove(blobs.map((blob) => blob.url));
  }
}

/**
 * The real client, over the Vercel SDK.
 *
 * `cacheControlMaxAge: 0` and a no-store read are both required. Blob URLs are
 * served through a CDN, and a deck read back through a cache after being saved is
 * how an edit appears to have done nothing.
 */
export function vercelBlobClient(token: string): BlobClient {
  return {
    async put(pathname, body) {
      const { put } = await import('@vercel/blob');
      const result = await put(pathname, body, {
        access: 'public',
        token,
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 0,
      });
      return { pathname: result.pathname, url: result.url };
    },

    async list(prefix) {
      const { list } = await import('@vercel/blob');
      const entries: BlobEntry[] = [];
      let cursor: string | undefined;

      // Paginated, because a deck's pages/ prefix will hold one object per slide and
      // a large library would otherwise silently stop at the first page.
      do {
        const page = await list({ prefix, token, cursor, limit: 1000 });
        entries.push(...page.blobs.map((blob) => ({ pathname: blob.pathname, url: blob.url })));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);

      return entries;
    },

    async remove(urls) {
      const { del } = await import('@vercel/blob');
      await del(urls, { token });
    },

    async read(url) {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return null;
      return response.text();
    },
  };
}

/**
 * The binary half of the same client.
 *
 * Separate from the text one because slide renders are bytes with a real content
 * type, and because nothing that handles decks should be able to write images by
 * accident. `cacheControlMaxAge` is generous here: a page render never changes
 * under a given key, unlike deck.json.
 */
export function vercelBinaryBlobClient(token: string): BinaryBlobClient {
  return {
    async put(pathname, bytes, contentType) {
      const { put } = await import('@vercel/blob');
      // The SDK takes a Buffer rather than a Uint8Array. Wrapping the same memory
      // rather than copying it: a 60-page deck is 60 of these.
      const result = await put(
        pathname,
        Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        {
          access: 'public',
          token,
          contentType,
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 31_536_000,
        },
      );
      return { url: result.url };
    },

    async list(prefix) {
      const { list } = await import('@vercel/blob');
      const entries: Array<{ pathname: string; url: string }> = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, token, cursor, limit: 1000 });
        entries.push(...page.blobs.map((blob) => ({ pathname: blob.pathname, url: blob.url })));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return entries;
    },

    async remove(urls) {
      const { del } = await import('@vercel/blob');
      await del(urls, { token });
    },

    async readBytes(url) {
      const response = await fetch(url);
      if (!response.ok) return null;
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
