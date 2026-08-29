/**
 * Which roster storage this deployment has.
 *
 * The same env-descending rule the deck registry uses, and cached the same way, so
 * the two cannot disagree about which deployment they are in.
 *
 *   Firebase configured       → Firestore
 *   else BLOB_READ_WRITE_TOKEN → Vercel Blob
 *   else not on Vercel        → the filesystem, under .data/roster
 *   else                      → none, which refuses writes and says why
 *
 * Firestore comes first because it is the only one of them that can change a
 * document atomically, which is what stops two trainees finishing slides at the same
 * moment from losing one of them. The blob tier stays as the fallback for a
 * deployment that has storage but no Firebase, and because it holds the rows that
 * were written before Firestore existed.
 */

import 'server-only';

import { vercelBlobClient } from '../decks/store-blob';
import { firebaseAdminConfigured } from '../firebase/admin';
import { firestoreDocuments } from '../firebase/firestore';
import { BlobRosterStore } from './store-blob';
import { DocumentRosterStore } from './store-documents';
import { FilesystemRosterStore, defaultRosterRoot } from './store-fs';
import { NoRosterStore } from './store-none';
import type { RosterStore } from './store';

let cached: RosterStore | null = null;

export function rosterStore(): RosterStore {
  if (cached) return cached;

  // Firestore needs no credentials of its own: it uses the service account the app
  // already has for sign-in. ROSTER_STORE=blob forces the older tier, which is what
  // the migration script uses to read the rows it is moving.
  if (firebaseAdminConfigured() && process.env.ROSTER_STORE !== 'blob') {
    cached = new DocumentRosterStore(firestoreDocuments());
    return cached;
  }

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
