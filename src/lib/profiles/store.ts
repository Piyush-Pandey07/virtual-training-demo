/**
 * Where learner profiles are kept: one document per person, in their own organisation's
 * `profiles` collection.
 *
 * Built on the same document port as the roster and the rate limits, scoped to one
 * customer when it is built, so a query for somebody's profile cannot reach into another
 * customer. Without Firebase it falls back to memory, which is what local development
 * and the tests run against, exactly as the rate limits do.
 *
 * Keyed on the person's own organisation, never the one they are looking inside.
 * Technavious staff supporting a customer act in that customer's organisation, and
 * their own profile has no business being written there.
 *
 * Nothing in here checks PROFILES_ENABLED. The routes and pages that call it do, so that
 * the switch is decided where a request arrives. The exceptions are the deletions made
 * when somebody leaves a customer, which run whatever the switch says: a profile saved
 * while it was on must still go when its owner does.
 */

import 'server-only';

import { firestoreDocuments } from '../firebase/firestore';
import { orgsConfigured } from '../orgs/registry';
import { scopedDocuments } from '../orgs/scope';
import { InMemoryDocumentStore, type DocumentStore } from '../roster/documents';
import type { LearnerProfileRecord } from './types';
import { applyChange, type ProfileChange } from './validate';

/** The collection name, which the purge also lists. */
export const PROFILES = 'profiles';

const fallback = new InMemoryDocumentStore();

/** Who a profile belongs to. Only ever a signed-in person, never an id from a request. */
export interface ProfileOwner {
  id: string;
  orgId: string;
  homeOrgId?: string;
}

export interface ProfileStoreOptions {
  /** The store to use, before it is scoped to the organisation. For the tests. */
  store?: DocumentStore;
}

function documents(owner: ProfileOwner, options: ProfileStoreOptions): DocumentStore {
  const base = options.store ?? (orgsConfigured() ? firestoreDocuments() : fallback);
  return scopedDocuments(base, owner.homeOrgId ?? owner.orgId);
}

export async function getProfile(
  owner: ProfileOwner,
  options: ProfileStoreOptions = {},
): Promise<LearnerProfileRecord | undefined> {
  return documents(owner, options).get<LearnerProfileRecord>(PROFILES, owner.id);
}

/**
 * Applies a change and returns what is now stored, or null if nothing is.
 *
 * A read and then a write, rather than the store's atomic update, because a change that
 * empties a profile deletes it and an update cannot. Nothing is lost by that: only its
 * owner ever writes a profile, from one form at a time, and if they save from two tabs
 * at once the later save winning is what anybody would expect of a form.
 */
export async function saveProfile(
  owner: ProfileOwner,
  change: ProfileChange,
  options: ProfileStoreOptions = {},
  now: Date = new Date(),
): Promise<LearnerProfileRecord | null> {
  const docs = documents(owner, options);
  const current = await docs.get<LearnerProfileRecord>(PROFILES, owner.id);
  const next = applyChange(current, change, owner.id, now.toISOString());
  if (next) await docs.set(PROFILES, owner.id, next);
  else await docs.remove(PROFILES, owner.id);
  return next;
}

/** Removes the document completely. Nothing is archived. */
export async function deleteProfile(
  owner: ProfileOwner,
  options: ProfileStoreOptions = {},
): Promise<void> {
  await documents(owner, options).remove(PROFILES, owner.id);
}
