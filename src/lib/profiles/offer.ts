/**
 * Whether the session lobby should offer the profile form, and which parts of it.
 *
 * Null, and no storage touched, whenever PROFILES_ENABLED is off. Null as well when
 * there is nothing left to ask, and when the profile cannot be read: offering a form
 * that asks again for what somebody already gave, because a read failed, would be a
 * nuisance rather than a help.
 */

import 'server-only';

import { profilesEnabled } from '../config';
import { getProfile, type ProfileOwner, type ProfileStoreOptions } from './store';
import { hasPersonalDetails, isExpertiseLevel, type ProfileOfferState } from './types';

export async function profileOfferFor(
  person: ProfileOwner,
  deckId: string,
  options: ProfileStoreOptions = {},
): Promise<ProfileOfferState | null> {
  if (!profilesEnabled()) return null;

  let profile;
  try {
    profile = await getProfile(person, options);
  } catch {
    return null;
  }

  const askExpertise = !isExpertiseLevel(profile?.expertise?.[deckId]);
  const askPersonal = !hasPersonalDetails(profile);
  return askExpertise || askPersonal ? { deckId, askExpertise, askPersonal } : null;
}
