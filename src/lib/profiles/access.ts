/**
 * Who may upload participants, and who may see a learner profile.
 *
 * The rules of BRD v2.3, AI-28 and AI-06, written once, so the routes, the pages and the
 * navigation all ask here rather than working it out for themselves.
 *
 * Uploading (AI-28): the administrator, a company administrator, and a facilitator. All
 * three set up the people who attend, which is all an upload does.
 *
 * Seeing a profile (AI-06): the participant, their own; the facilitator of a session or
 * batch they are in; and the administrator, which is Technavious. Not a company
 * administrator, and not another participant. The trainer reads it as well, on the
 * server, for the participant's own sessions; that is `profileForTrainer`, not this.
 *
 * Everything here assumes the switch has already been checked for the viewer and their
 * organisation. It decides who, not whether the feature exists.
 */

import 'server-only';

import {
  isAdministrator,
  isCompanyAdmin,
  isFacilitator,
  type Permissioned,
} from '../auth/permissions';
import type { DocumentStore } from '../roster/documents';
import type { SignedInPerson } from '../roster/types';
import { facilitatesPerson } from '../training/access';

/** Whether this person may download the template and upload participants. */
export function mayUploadParticipants(person: Permissioned): boolean {
  return isAdministrator(person) || isCompanyAdmin(person) || isFacilitator(person);
}

/**
 * Whether this viewer may see the profile of this person, in the organisation the
 * viewer is in.
 *
 * The caller must already have found the person in the viewer's own organisation's
 * roster. This decides between people in one customer; it does not, and must not be
 * asked to, decide anything across customers.
 *
 * A facilitator lookup that fails is a refusal, not an error. Somebody who cannot be
 * shown to facilitate the person is not shown the profile.
 */
export async function mayViewProfile(
  viewer: SignedInPerson,
  personId: string,
  options: { store?: DocumentStore } = {},
): Promise<boolean> {
  if (viewer.id === personId) return true;
  if (isAdministrator(viewer)) return true;
  if (isFacilitator(viewer)) {
    return facilitatesPerson(viewer, personId, options).catch(() => false);
  }
  // A company administrator and every other participant. The company owns the training
  // record, not what the participant said about themselves.
  return false;
}
