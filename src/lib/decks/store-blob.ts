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
  /**
   * Reads by pathname. Null when the object is absent.
   *
   * By pathname rather than by URL on purpose. A URL has to be discovered, and the
   * only way to discover one is to list the prefix first, which made every read two
   * sequential network calls instead of one. Pathnames are deterministic here
   * because nothing is written with a random suffix, and the SDK resolves the store
   * host from the token.
   */
  read(pathname: string): Promise<string | null>;
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

/**
 * Which decks exist, as an object rather than a question asked of the API.
 *
 * Listing a prefix is a control-plane call, and unlike reading an object it does not
 * run in the store's region: from Mumbai it cost about 750ms flat, which was the
 * whole remaining cost of the front page once the reads were fixed. A session, which
 * reads one deck by id and never lists, was already at 100ms.
 *
 * Treated as a cache and never as the authority. Anything that cannot be read, or
 * does not parse, falls back to a real listing and writes the result back, so the
 * worst a damaged index can do is cost one slow request.
 */
const INDEX = `${ROOT}/index.json`;

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

    const existing = await this.client.read(SEED_MARKER);
    if (existing !== null) {
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

  /** Deck ids present under the root, by asking the API. The slow, authoritative way. */
  private async listedIds(): Promise<string[]> {
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

  /** The index, or null when it is absent or unreadable. */
  private async indexedIds(): Promise<string[] | null> {
    const text = await this.client.read(INDEX);
    if (text === null) return null;
    try {
      const parsed = JSON.parse(text) as { ids?: unknown };
      if (!Array.isArray(parsed.ids)) return null;
      return parsed.ids.filter((id): id is string => typeof id === 'string');
    } catch {
      return null;
    }
  }

  private async writeIndex(ids: string[]): Promise<void> {
    await this.client.put(INDEX, JSON.stringify({ ids: [...new Set(ids)].sort() }, null, 2));
  }

  /** Deck ids, from the index when it is usable and from the API when it is not. */
  private async ids(): Promise<string[]> {
    const indexed = await this.indexedIds();
    if (indexed !== null) return indexed;

    const listed = await this.listedIds();
    await this.writeIndex(listed);
    return listed;
  }

  async list(): Promise<DeckSummary[]> {
    await this.ensureSeeded();

    // Concurrently. Sequentially, a library of five decks was five round trips deep
    // before the page could render, and the front page reads the library on every
    // request. One unparseable deck must not take the library down with it either;
    // `get` reports the reason properly when that deck is actually opened.
    const ids = await this.ids();
    const stored = await Promise.all(ids.map((id) => this.get(id).catch(() => undefined)));

    return stored
      .filter((deck): deck is StoredDeck => deck !== undefined)
      .map(summarise)
      .sort((a, b) => a.title.localeCompare(b.title));
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

    const prefix = this.prefix(id);

    // Both at once. They are independent objects and the deck is unreadable without
    // the first, so waiting for it before asking for the second only adds latency.
    let [deckText, metaText] = await Promise.all([
      this.client.read(`${prefix}/deck.json`),
      this.client.read(`${prefix}/meta.json`),
    ]);

    if (deckText === null) {
      await this.reseedIfEmptied();
      [deckText, metaText] = await Promise.all([
        this.client.read(`${prefix}/deck.json`),
        this.client.read(`${prefix}/meta.json`),
      ]);
    }

    if (deckText === null) return undefined;

    const parsed = parseDeck(deckText);
    if (!parsed.ok) throw new DeckInvalidError(id, parsed.errors);

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

    const previousText = await this.client.read(`${prefix}/meta.json`);
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

    // Only when this deck is not already known. Analysis saves the same deck once per
    // step, and re-listing on every one of those would put the slow call back into the
    // path it was taken out of. Rebuilt from a real listing rather than by appending,
    // so two uploads landing together converge instead of losing one of each other.
    const indexed = await this.indexedIds();
    if (indexed === null || !indexed.includes(record.meta.id)) {
      await this.writeIndex([...(await this.listedIds()), record.meta.id]);
    }

    return summarise({ record, ...meta, readOnly: false });
  }

  async remove(id: string): Promise<void> {
    await this.ensureSeeded();
    const blobs = await this.client.list(`${this.prefix(id)}/`);
    if (blobs.length > 0) await this.client.remove(blobs.map((blob) => blob.url));

    const indexed = await this.indexedIds();
    if (indexed !== null) await this.writeIndex(indexed.filter((entry) => entry !== id));
  }
}

/**
 * The real client, over the Vercel SDK.
 *
 * `cacheControlMaxAge: 0` and an uncached read are both required. Blob URLs are
 * served through a CDN, and a deck read back through a cache after being saved is
 * how an edit appears to have done nothing.
 *
 * Everything is written private. Nothing in this app ever hands a blob URL to a
 * browser, because assets are proxied through `/api/decks/{id}/assets/{name}`, so
 * public access buys nothing and costs something real: deck.json carries
 * `internalNotes`, the author-only notes that must never reach a trainee, and a
 * public store would put them at a URL anyone who learned it could read. Vercel
 * also creates stores private by default now, and a private store rejects a public
 * write outright rather than quietly downgrading it.
 */
export function vercelBlobClient(token: string): BlobClient {
  return {
    async put(pathname, body) {
      const { put } = await import('@vercel/blob');
      const result = await put(pathname, body, {
        access: 'private',
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
      const { get } = await import('@vercel/blob');
      // useCache: false for the same reason the write sets cacheControlMaxAge to 0.
      // A private blob cannot be read with a bare fetch: the request has to carry
      // the token, which is what get does.
      const result = await get(url, { access: 'private', token, useCache: false });
      if (!result || result.statusCode !== 200) return null;
      return new Response(result.stream).text();
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
          access: 'private',
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
      const { get } = await import('@vercel/blob');
      // Cached, unlike the deck read: a page render never changes under a given key.
      const result = await get(url, { access: 'private', token });
      if (!result || result.statusCode !== 200) return null;
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
  };
}
