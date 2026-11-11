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
 * One wrinkle, from the bulk upload. A participant uploaded before they have ever signed
 * in has a placeholder id, and signing in replaces it with the real one. The roster
 * carries their assignments across when that happens; it knows nothing of profiles, so
 * an uploaded profile also carries the address it was uploaded against, and is found by
 * that when nothing is stored under the real id. Saving it moves it to the real id.
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
import type { LearnerDetails, LearnerProfileRecord } from './types';
import { confirmedProfile, uploadedProfile } from './validate';

/** The collection name, which the purge also lists. */
export const PROFILES = 'profiles';

const fallback = new InMemoryDocumentStore();

/**
 * Whose profile. Only ever a signed-in person, or somebody the caller has already found
 * in its own organisation's roster, never an id from a request on its own.
 */
export interface ProfileOwner {
  id: string;
  orgId: string;
  homeOrgId?: string;
  /** Their address, lower-cased, so an uploaded profile is found after their id changes. */
  emailKey?: string;
}

export interface ProfileStoreOptions {
  /** The store to use, before it is scoped to the organisation. For the tests. */
  store?: DocumentStore;
}

/** Shared with the consent log, which lives beside the profiles. */
export function profileDocuments(
  owner: Pick<ProfileOwner, 'orgId' | 'homeOrgId'>,
  options: ProfileStoreOptions,
): DocumentStore {
  const base = options.store ?? (orgsConfigured() ? firestoreDocuments() : fallback);
  return scopedDocuments(base, owner.homeOrgId ?? owner.orgId);
}

/** The profile stored under this person's own id, and nothing else. For the trainer. */
export async function getProfile(
  owner: ProfileOwner,
  options: ProfileStoreOptions = {},
): Promise<LearnerProfileRecord | undefined> {
  return profileDocuments(owner, options).get<LearnerProfileRecord>(PROFILES, owner.id);
}

/** Every uploaded profile carrying this address, under whatever id it was written. */
async function uploadedFor(
  docs: DocumentStore,
  emailKey: string | undefined,
): Promise<LearnerProfileRecord[]> {
  if (!emailKey) return [];
  return docs.where<LearnerProfileRecord>(PROFILES, 'emailKey', emailKey);
}

/**
 * The profile to show this person, or about them: their own, or failing that one their
 * organisation uploaded before signing in gave them their real id.
 */
export async function findProfile(
  owner: ProfileOwner,
  options: ProfileStoreOptions = {},
): Promise<LearnerProfileRecord | undefined> {
  const docs = profileDocuments(owner, options);
  const own = await docs.get<LearnerProfileRecord>(PROFILES, owner.id);
  if (own) return own;
  const uploaded = await uploadedFor(docs, owner.emailKey);
  // The newest, should two uploads have landed under two ids.
  return uploaded.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/**
 * Saves the participant's own, confirmed profile under their real id, and removes any
 * uploaded copy left under the placeholder id they had before signing in.
 */
export async function saveProfile(
  owner: ProfileOwner,
  details: LearnerDetails,
  options: ProfileStoreOptions = {},
  now: Date = new Date(),
): Promise<LearnerProfileRecord> {
  const docs = profileDocuments(owner, options);
  const current = await findProfile(owner, options);
  const next = confirmedProfile(current, details, owner.id, now.toISOString());
  await docs.set(PROFILES, owner.id, next);
  for (const stale of await uploadedFor(docs, owner.emailKey)) {
    if (stale.personId !== owner.id) await docs.remove(PROFILES, stale.personId);
  }
  return next;
}

/** What an upload did to one person's profile. */
export type UploadOutcome = 'prefilled' | 'kept';

/**
 * Stores a profile an uploader filled in for somebody, unconfirmed, unless the person has
 * already confirmed their own, which is kept as it is.
 */
export async function saveUploadedProfile(
  owner: ProfileOwner & { emailKey: string },
  details: LearnerDetails,
  uploadedBy: string,
  options: ProfileStoreOptions = {},
  now: Date = new Date(),
): Promise<UploadOutcome> {
  const docs = profileDocuments(owner, options);
  const current = await findProfile(owner, options);
  const next = uploadedProfile(
    current,
    details,
    { personId: owner.id, emailKey: owner.emailKey, uploadedBy },
    now.toISOString(),
  );
  if (!next) return 'kept';
  await docs.set(PROFILES, owner.id, next);
  if (current && current.personId !== owner.id) await docs.remove(PROFILES, current.personId);
  return 'prefilled';
}

/**
 * Removes the profile completely, including an uploaded copy under an earlier id.
 * Nothing is archived.
 */
export async function deleteProfile(
  owner: ProfileOwner,
  options: ProfileStoreOptions = {},
): Promise<void> {
  const docs = profileDocuments(owner, options);
  await docs.remove(PROFILES, owner.id);
  for (const uploaded of await uploadedFor(docs, owner.emailKey)) {
    await docs.remove(PROFILES, uploaded.personId);
  }
}
