/**
 * Where a white paper's original PDF is kept, beside its text (AI-46).
 *
 * The trainer reads the text, which lives in Firestore; the original is kept so that
 * whoever approves a paper can open exactly what was uploaded, and so a paper can be
 * read again if the text extraction ever improves. Resolved by the same rule as a deck's
 * slide renders: blob storage when a token is configured, the filesystem on a developer
 * machine, and nothing at all on a deployment with neither, in which case the paper
 * keeps its text and the screen says the original was not kept.
 *
 * Its own small store rather than the deck asset store, because that one is shaped
 * around a deck's pages and removes only them. Under the customer's own prefix,
 * `orgs/acme/white-papers/{id}/original.pdf`, so a purge can find every one of them.
 */

import 'server-only';

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { BinaryBlobClient } from '../decks/assets';
import { vercelBinaryBlobClient } from '../decks/store-blob';
import { defaultDataRoot } from '../decks/store-fs';
import { orgPrefix } from '../orgs/scope';

const ORIGINAL = 'original.pdf';

/** A paper id as the store makes them. Checked again here, since it becomes a path. */
export function isUsableWhitePaperId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

function assertUsable(id: string): void {
  if (!isUsableWhitePaperId(id)) throw new Error(`"${id}" is not a usable white paper id.`);
}

export interface WhitePaperFileStore {
  readonly kind: 'blob' | 'filesystem' | 'none';
  readonly writable: boolean;
  put(paperId: string, bytes: Uint8Array): Promise<void>;
  get(paperId: string): Promise<Uint8Array | undefined>;
  remove(paperId: string): Promise<void>;
  /** Every original this customer has. For a purge. */
  removeAll(): Promise<void>;
}

class FilesystemPaperFiles implements WhitePaperFileStore {
  readonly kind = 'filesystem' as const;
  readonly writable = true;
  constructor(private readonly root: string) {}

  async put(paperId: string, bytes: Uint8Array): Promise<void> {
    assertUsable(paperId);
    await mkdir(join(this.root, paperId), { recursive: true });
    await writeFile(join(this.root, paperId, ORIGINAL), bytes);
  }

  async get(paperId: string): Promise<Uint8Array | undefined> {
    assertUsable(paperId);
    const bytes = await readFile(join(this.root, paperId, ORIGINAL)).catch(() => null);
    return bytes ? new Uint8Array(bytes) : undefined;
  }

  async remove(paperId: string): Promise<void> {
    assertUsable(paperId);
    await rm(join(this.root, paperId), { recursive: true, force: true });
  }

  async removeAll(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }
}

export class BlobPaperFiles implements WhitePaperFileStore {
  readonly kind = 'blob' as const;
  readonly writable = true;
  /** @param base the customer's prefix for papers, e.g. `orgs/acme/white-papers`. */
  constructor(
    private readonly client: BinaryBlobClient,
    private readonly base: string,
  ) {}

  private key(paperId: string): string {
    assertUsable(paperId);
    return `${this.base}/${paperId}/${ORIGINAL}`;
  }

  async put(paperId: string, bytes: Uint8Array): Promise<void> {
    await this.client.put(this.key(paperId), bytes, 'application/pdf');
  }

  async get(paperId: string): Promise<Uint8Array | undefined> {
    return (await this.client.readBytes(this.key(paperId))) ?? undefined;
  }

  async remove(paperId: string): Promise<void> {
    assertUsable(paperId);
    const blobs = await this.client.list(`${this.base}/${paperId}/`);
    if (blobs.length > 0) await this.client.remove(blobs.map((blob) => blob.url));
  }

  async removeAll(): Promise<void> {
    const blobs = await this.client.list(`${this.base}/`);
    if (blobs.length > 0) await this.client.remove(blobs.map((blob) => blob.url));
  }
}

class NoPaperFiles implements WhitePaperFileStore {
  readonly kind = 'none' as const;
  readonly writable = false;
  async put(): Promise<void> {
    throw new Error('No file storage is configured, so the original cannot be kept.');
  }
  async get(): Promise<Uint8Array | undefined> {
    return undefined;
  }
  async remove(): Promise<void> {}
  async removeAll(): Promise<void> {}
}

/** One customer's white paper originals, and no other customer's. */
export function whitePaperFiles(orgId: string): WhitePaperFileStore {
  const base = `${orgPrefix(orgId)}/white-papers`;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) return new BlobPaperFiles(vercelBinaryBlobClient(token), base);
  if (!process.env.VERCEL) {
    return new FilesystemPaperFiles(join(process.env.DECK_STORE_DIR ?? defaultDataRoot(), base));
  }
  return new NoPaperFiles();
}

/** Removes every original a customer has, when the customer is deleted. */
export async function removeWhitePaperFiles(orgId: string): Promise<void> {
  await whitePaperFiles(orgId).removeAll();
}
