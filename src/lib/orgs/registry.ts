/**
 * Where the customer list lives.
 *
 * Narrower than the roster registry on purpose. The roster descends through four
 * tiers because it predates Firestore and still has to read rows written to blob
 * storage before that existed; organisations have no history to be compatible with,
 * and a customer list that silently landed on a filesystem tier a serverless
 * deployment cannot keep would be a deployment with no customers and no error.
 *
 * So: Firestore or nothing, and "nothing" says so rather than pretending.
 */

import 'server-only';

import { firebaseAdminConfigured } from '../firebase/admin';
import { firestoreDocuments } from '../firebase/firestore';
import { InMemoryDocumentStore } from '../roster/documents';
import { OrgStore } from './store';

let cached: OrgStore | null = null;

/** Whether customers can be read and written at all in this deployment. */
export function orgsConfigured(): boolean {
  return firebaseAdminConfigured();
}

/**
 * The customer list.
 *
 * Falls back to an in-memory store when Firebase is not configured, which keeps a
 * local build and the tests working. That store is empty on every boot and forgets
 * everything, so a deployment that lands here has no customers rather than the wrong
 * ones — check `orgsConfigured()` before treating an empty list as meaningful.
 */
export function orgStore(): OrgStore {
  if (cached) return cached;

  cached = new OrgStore(orgsConfigured() ? firestoreDocuments() : new InMemoryDocumentStore());
  return cached;
}

/** For tests, which need a fresh store per case rather than a cached one. */
export function resetOrgStore(store?: OrgStore): void {
  cached = store ?? null;
}
