/**
 * The four kinds of person in BRD v2.3, section 6, and how to tell them apart.
 *
 * Safe to import anywhere: it reads only what a signed-in person already carries.
 *
 * - **Administrator** (the Benchmark administrator): Technavious. Full access, uploads
 *   question banks, manages the glossary, and sees the developer log. Platform staff,
 *   and the administrators of Technavious's own organisation.
 * - **Company administrator**: a customer's own administrator. Their company's whole
 *   setup, adding facilitators among it, but never learner profiles.
 * - **Facilitator**: runs trainer-led sessions for their own batches, and sees only
 *   those sessions and the people in them.
 * - **Participant**: attends, and sees their own record.
 *
 * Kept as functions over the person rather than as more roles on the roster row, because
 * "administrator" is not something a company can grant itself: it follows from being
 * Technavious, exactly as platform access does.
 */

import { HOME_ORG_ID } from '../orgs/types';
import type { Role } from '../roster/types';

export interface Permissioned {
  role: Role;
  platform: boolean;
  /** The organisation this person belongs to, as opposed to one they are looking inside. */
  homeOrgId?: string;
}

/** Technavious: platform staff, or an administrator of Technavious's own organisation. */
export function isAdministrator(person: Permissioned): boolean {
  return person.platform || (person.role === 'admin' && person.homeOrgId === HOME_ORG_ID);
}

/** A customer's own administrator, who is not also Technavious. */
export function isCompanyAdmin(person: Permissioned): boolean {
  return person.role === 'admin' && !isAdministrator(person);
}

export function isFacilitator(person: Permissioned): boolean {
  return person.role === 'facilitator';
}

/** Who may set up and run trainer-led sessions and batches at all. */
export function mayRunSessions(person: Permissioned): boolean {
  return person.role === 'admin' || person.role === 'facilitator' || person.platform;
}

/**
 * Who may see every session and batch in the company, rather than only their own.
 * Facilitators see their own; administrators and company administrators see all.
 */
export function seesAllSessions(person: Permissioned): boolean {
  return person.role === 'admin' || person.platform;
}
