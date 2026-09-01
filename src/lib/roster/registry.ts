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
import { filesystemRoot, rosterPrefix, scopedDocuments } from '../orgs/scope';
import { firebaseAdminConfigured } from '../firebase/admin';
import { firestoreDocuments } from '../firebase/firestore';
import { BlobRosterStore } from './store-blob';
import { DocumentRosterStore } from './store-documents';
import { FilesystemRosterStore, defaultRosterRoot } from './store-fs';
import { NoRosterStore } from './store-none';
import type { RosterStore } from './store';

const cached = new Map<string, RosterStore>();

/**
 * One customer's people, and no other customer's.
 *
 * The organisation is required, and that is the isolation. A store handed back here
 * cannot see anybody outside the customer it was built for, so `listPeople()` above
 * this line cannot return another customer's employees however it is called.
 */
export function rosterStore(orgId: string): RosterStore {
  const existing = cached.get(orgId);
  if (existing) return existing;

  const store = buildRosterStore(orgId);
  cached.set(orgId, store);
  return store;
}

/** Which storage tier this deployment would use. See `deckStorage`. */
export function rosterStorage(): { kind: RosterStore['kind']; writable: boolean } {
  const probe = buildRosterStore('health');
  return { kind: probe.kind, writable: probe.writable };
}

function buildRosterStore(orgId: string): RosterStore {
  // Firestore needs no credentials of its own: it uses the service account the app
  // already has for sign-in. ROSTER_STORE=blob forces the older tier, which is what
  // the migration script uses to read the rows it is moving.
  if (firebaseAdminConfigured() && process.env.ROSTER_STORE !== 'blob') {
    return new DocumentRosterStore(scopedDocuments(firestoreDocuments(), orgId));
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) return new BlobRosterStore(vercelBlobClient(token), rosterPrefix(orgId));

  if (!process.env.VERCEL) {
    const base = process.env.ROSTER_STORE_DIR ?? defaultRosterRoot();
    return new FilesystemRosterStore(filesystemRoot(base, orgId, 'roster'));
  }

  // Nothing configured on a host with no writable disk. Refusing honestly beats
  // pretending to save a trainee's progress.
  return new NoRosterStore();
}

/** For tests, which need a fresh store per case rather than a cached one. */
export function resetRosterStore(store?: RosterStore, orgId = 'test-org'): void {
  cached.clear();
  if (store) cached.set(orgId, store);
}
