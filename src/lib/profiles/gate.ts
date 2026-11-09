/**
 * Whether somebody must agree to the privacy notice before going any further.
 *
 * Asked by the page guards on every page, and by the route guard that lets somebody
 * attend, so it is one place and one answer. Nobody whom PROFILES_ENABLED leaves out is
 * ever asked, and storage is not read for them: off is exactly what it was before.
 *
 * A read that fails counts as no agreement. That is the cautious way round for something
 * that decides whether personal data may be used, and it is not a dead end: the consent
 * page reads again, and agreeing again only adds a record.
 */

import 'server-only';

import { cache } from 'react';

import { profilesEnabledFor, type ProfilesSubject } from '../config';
import { hasCurrentConsent } from './consent';
import type { ProfileOwner, ProfileStoreOptions } from './store';

/** Where the consent page lives. The guards send people here and never guard it. */
export const CONSENT_PATH = '/consent';

export type ConsentSubject = ProfileOwner & ProfilesSubject;

/** The uncached question, for the tests. Everything else asks `needsConsent`. */
export async function mustConsent(
  person: ConsentSubject,
  options: ProfileStoreOptions = {},
): Promise<boolean> {
  if (!profilesEnabledFor(person)) return false;
  try {
    return !(await hasCurrentConsent(person, options));
  } catch {
    return true;
  }
}

/**
 * Once per request, like who is signed in. The layout, the metadata and the guard can
 * all ask on one page load, and the answer does not change in between.
 */
const consentedOnce = cache(
  async (id: string, orgId: string, homeOrgId: string, platform: boolean): Promise<boolean> =>
    !(await mustConsent({ id, orgId, homeOrgId, platform })),
);

export async function needsConsent(person: {
  id: string;
  orgId: string;
  homeOrgId: string;
  platform: boolean;
}): Promise<boolean> {
  // Checked before the cache as well, so with the switch off nothing at all is set up.
  if (!profilesEnabledFor(person)) return false;
  return !(await consentedOnce(person.id, person.orgId, person.homeOrgId, person.platform));
}

/**
 * The consent page, remembering where they were going.
 *
 * Only ever a path on this site: `next` comes from the guard's own caller, but it is
 * checked again on the consent page before it is followed, as the sign-in page does.
 */
export function consentAddress(next?: string): string {
  return next && !next.startsWith(CONSENT_PATH)
    ? `${CONSENT_PATH}?next=${encodeURIComponent(next)}`
    : CONSENT_PATH;
}
