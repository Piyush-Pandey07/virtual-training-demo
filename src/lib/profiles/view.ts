/**
 * One person's profile, for somebody allowed to see it (BRD v2.3, AI-06).
 *
 * The read-only view on /people/{id}/profile and its route both come through here, so
 * the rule in `mayViewProfile` is asked in one place before anything is read, and the
 * person is always found in the viewer's own organisation first. An id from another
 * customer finds nobody, and nobody is a refusal.
 *
 * Refusals and absences are the same answer, null, which the callers turn into a 404:
 * a company administrator asking about a participant learns no more than somebody asking
 * about an id that does not exist.
 *
 * Every view by somebody other than the owner is recorded in the audit history (AI-40),
 * after the rule has allowed it and the person has been found, so the history holds the
 * profiles somebody actually saw and not the ones they were refused.
 */

import 'server-only';

import { recordAudit } from '../audit/log';
import type { DocumentStore } from '../roster/documents';
import { rosterStore } from '../roster/registry';
import type { RosterStore } from '../roster/store';
import type { Role, SignedInPerson } from '../roster/types';
import { mayViewProfile } from './access';
import { findProfile } from './store';
import type { LearnerProfileRecord } from './types';

export interface ProfileView {
  person: { id: string; name: string; email: string; role: Role };
  profile: LearnerProfileRecord | null;
}

export interface ViewOptions {
  roster?: RosterStore;
  /** The document store for profiles and for the facilitator check. For the tests. */
  store?: DocumentStore;
}

export async function viewProfile(
  viewer: SignedInPerson,
  personId: string,
  options: ViewOptions = {},
): Promise<ProfileView | null> {
  if (personId === viewer.id) {
    const profile = await findProfile(viewer, { store: options.store });
    return {
      person: { id: viewer.id, name: viewer.name, email: viewer.email, role: viewer.role },
      profile: profile ?? null,
    };
  }

  // The rule before the read, so a company administrator's request touches no roster.
  if (!(await mayViewProfile(viewer, personId, { store: options.store }))) return null;

  const roster = options.roster ?? rosterStore(viewer.orgId);
  const person = await roster.getPerson(personId).catch(() => undefined);
  if (!person) return null;

  const profile = await findProfile(
    { id: person.id, orgId: viewer.orgId, emailKey: person.emailKey },
    { store: options.store },
  );
  await recordAudit(
    viewer,
    {
      action: 'viewed',
      subjectType: 'profile',
      subjectId: person.id,
      detail: profile
        ? `Viewed the profile of ${person.email}`
        : `Opened ${person.email}, who has no profile`,
    },
    { store: options.store },
  );
  return {
    person: { id: person.id, name: person.name, email: person.email, role: person.role },
    profile: profile ?? null,
  };
}
