/**
 * Which roster storage this deployment has.
 *
 * The same env-descending rule the deck registry uses, and cached the same way, so
 * the two cannot disagree about which deployment they are in.
 *
 *   BLOB_READ_WRITE_TOKEN set → Vercel Blob, which is what a deployment has
 *   else not on Vercel        → the filesystem, under .data/roster
 *   else                      → none, which refuses writes and says why
 */

import 'server-only';

import { vercelBlobClient } from '../decks/store-blob';
import { BlobRosterStore } from './store-blob';
import { FilesystemRosterStore, defaultRosterRoot } from './store-fs';
import { NoRosterStore } from './store-none';
import type { RosterStore } from './store';

let cached: RosterStore | null = null;

export function rosterStore(): RosterStore {
  if (cached) return cached;

  // Postgres lands here once a database is provisioned, ahead of blob storage. Until
  // then blob is what a deployment actually has, and it is what the deck store
  // already uses, so this needs no service nobody has set up.
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    cached = new BlobRosterStore(vercelBlobClient(token));
    return cached;
  }

  const onVercel = Boolean(process.env.VERCEL);
  if (!onVercel) {
    cached = new FilesystemRosterStore(process.env.ROSTER_STORE_DIR ?? defaultRosterRoot());
    return cached;
  }

  // Nothing configured on a host with no writable disk. Refusing honestly beats
  // pretending to save a trainee's progress.
  cached = new NoRosterStore();
  return cached;
}

/** For tests, which need a fresh store per case rather than a cached one. */
export function resetRosterStore(store?: RosterStore): void {
  cached = store ?? null;
}
