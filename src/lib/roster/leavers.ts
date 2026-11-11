/**
 * The people who have left a customer: their name and address, kept as part of the
 * training record for five years after they last trained (AI-42).
 *
 * Removing somebody takes their row out of the roster, so they cannot sign in and cannot
 * be given anything. But the owner's rule keeps their name, email, attendance,
 * completion, score and pass or fail for five years, and without a name an attempt or an
 * attendance mark says only that somebody with an id nobody can read trained once. So
 * the name and address are written here, one document per person, and the retention job
 * deletes the document five years after their last use, with the rest of the record.
 *
 * Nothing else: not their role history, not their profile, which goes the moment they
 * are removed. Kept in the customer's own prefix, so it goes with the customer too.
 */

import 'server-only';

import { firestoreDocuments } from '../firebase/firestore';
import { orgsConfigured } from '../orgs/registry';
import { scopedDocuments } from '../orgs/scope';
import { InMemoryDocumentStore, type DocumentStore } from './documents';
import type { Person } from './types';

/** The collection, which the purge also lists. */
export const LEAVERS = 'leavers';

export interface LeaverRecord {
  /** Their person id, which is also this document's id, so the purge can find it. */
  id: string;
  personId: string;
  name: string;
  email: string;
  emailKey: string;
  /** ISO 8601. When they were removed. */
  leftAt: string;
  /** Who removed them. */
  removedBy: string;
}

const fallback = new InMemoryDocumentStore();

/** One customer's leavers, and no other customer's. */
export function leaverDocuments(orgId: string, store?: DocumentStore): DocumentStore {
  return scopedDocuments(store ?? (orgsConfigured() ? firestoreDocuments() : fallback), orgId);
}

/** Keeps the name and address of somebody being removed, for the five-year record. */
export async function recordLeaver(
  orgId: string,
  person: Pick<Person, 'id' | 'name' | 'email' | 'emailKey'>,
  removedBy: string,
  options: { store?: DocumentStore; now?: Date } = {},
): Promise<LeaverRecord> {
  const record: LeaverRecord = {
    id: person.id,
    personId: person.id,
    name: person.name,
    email: person.email,
    emailKey: person.emailKey,
    leftAt: (options.now ?? new Date()).toISOString(),
    removedBy,
  };
  await leaverDocuments(orgId, options.store).set(LEAVERS, record.id, record);
  return record;
}
