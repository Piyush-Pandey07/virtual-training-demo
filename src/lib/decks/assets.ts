/**
 * The binary files that belong to a deck.
 *
 * Slide renders, and later their thumbnails. Kept separate from the deck record
 * because they are large, immutable once written, and served straight to the
 * browser rather than parsed, so nothing about them wants to go through JSON
 * validation.
 *
 * Same three tiers as the deck store, for the same reason: blob storage when
 * configured, the filesystem on a developer machine, and a refusal that says what
 * to configure when neither is available.
 */

import 'server-only';

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { pageAssetName, pageAssetUrl } from './asset-paths';
import { assertUsableDeckId, DeckStoreError } from './store';

// Re-exported so server code has one import for everything asset-shaped, while the
// path helpers themselves stay in a module a client component can reach.
export { pageAssetName, pageAssetUrl };

export interface DeckAsset {
  bytes: Uint8Array;
  contentType: string;
}

export interface AssetStore {
  readonly kind: 'blob' | 'filesystem' | 'none';
  readonly writable: boolean;

  put(deckId: string, name: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(deckId: string, name: string): Promise<DeckAsset | undefined>;
  /** Removes every asset belonging to a deck. */
  removeAll(deckId: string): Promise<void>;
}

/**
 * Asset names are built into storage keys and filesystem paths, so they are
 * constrained rather than trusted.
 *
 * One level of directory is allowed, because pages live under `pages/`. Traversal,
 * absolute paths, backslashes and leading dots are all refused: on the filesystem
 * store these would write outside the deck's own directory.
 */
export function assertUsableAssetName(name: string): void {
  const ok = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)?$/.test(name) && !name.includes('..');
  if (!ok) {
    throw new DeckStoreError(`"${name}" is not a usable asset name.`);
  }
}

/** Page renders are webp; this keeps the mapping in one place. */
export function contentTypeFor(name: string): string {
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

// ---------------------------------------------------------------- filesystem

export class FilesystemAssetStore implements AssetStore {
  readonly kind = 'filesystem' as const;
  readonly writable = true;

  constructor(private readonly root: string) {}

  private path(deckId: string, name: string): string {
    assertUsableDeckId(deckId);
    assertUsableAssetName(name);
    return join(this.root, deckId, name);
  }

  // The content type is not stored: it is derived from the name on the way out, so
  // the interface's fourth argument is simply unused here.
  async put(deckId: string, name: string, bytes: Uint8Array): Promise<void> {
    const target = this.path(deckId, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  async get(deckId: string, name: string): Promise<DeckAsset | undefined> {
    const bytes = await readFile(this.path(deckId, name)).catch(() => null);
    if (!bytes) return undefined;
    return { bytes: new Uint8Array(bytes), contentType: contentTypeFor(name) };
  }

  async removeAll(deckId: string): Promise<void> {
    assertUsableDeckId(deckId);
    // Only the assets. The deck record lives in the same directory and is the deck
    // store's business, so this removes the pages directory rather than the deck.
    await rm(join(this.root, deckId, 'pages'), { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------- blob

/** The binary half of blob storage. Injected so this is testable without a token. */
export interface BinaryBlobClient {
  put(pathname: string, bytes: Uint8Array, contentType: string): Promise<{ url: string }>;
  list(prefix: string): Promise<Array<{ pathname: string; url: string }>>;
  remove(urls: string[]): Promise<void>;
  readBytes(url: string): Promise<Uint8Array | null>;
}

export class BlobAssetStore implements AssetStore {
  readonly kind = 'blob' as const;
  readonly writable = true;

  constructor(private readonly client: BinaryBlobClient) {}

  private key(deckId: string, name: string): string {
    assertUsableDeckId(deckId);
    assertUsableAssetName(name);
    return `decks/${deckId}/${name}`;
  }

  async put(deckId: string, name: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.put(this.key(deckId, name), bytes, contentType);
  }

  async get(deckId: string, name: string): Promise<DeckAsset | undefined> {
    // Straight to the object. Listing first to discover its URL doubled the calls
    // behind every slide image, and a session asks for one of these per page.
    const bytes = await this.client.readBytes(this.key(deckId, name));
    if (!bytes) return undefined;
    return { bytes, contentType: contentTypeFor(name) };
  }

  async removeAll(deckId: string): Promise<void> {
    assertUsableDeckId(deckId);
    const blobs = await this.client.list(`decks/${deckId}/pages/`);
    if (blobs.length > 0) await this.client.remove(blobs.map((blob) => blob.url));
  }
}

// ---------------------------------------------------------------------- none

/**
 * What a deployment with no storage configured has.
 *
 * The built-in deck's images are committed under public/, so a session still works.
 * Uploading is what is unavailable, and saying so plainly beats a write that
 * appears to succeed.
 */
export class NoAssetStore implements AssetStore {
  readonly kind = 'none' as const;
  readonly writable = false;

  async put(): Promise<void> {
    throw new DeckStoreError(
      'This deployment has no deck storage configured, so slide images cannot be uploaded. Set BLOB_READ_WRITE_TOKEN to enable uploads.',
    );
  }

  async get(): Promise<DeckAsset | undefined> {
    return undefined;
  }

  async removeAll(): Promise<void> {
    // Nothing is stored, so nothing to remove. Not an error.
  }
}
