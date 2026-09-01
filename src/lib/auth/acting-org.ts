import 'server-only';

import { cookies } from 'next/headers';

import { orgStore } from '../orgs/registry';
import { isUsableOrgId } from '../orgs/types';
import { isPlatformAdmin } from './roles';

/**
 * Which customer Technavious staff are currently looking at.
 *
 * Support means being able to see what a customer sees, and a customer's data lives
 * behind a store built from an organisation id. So platform staff need a way to say
 * which one — and it has to be a way that grants nothing to anybody else.
 *
 * A cookie, checked against the platform list on every read. The cookie is not the
 * authority and cannot become one: a customer administrator who sets it by hand gets
 * exactly nothing, because the check is `is this person Technavious`, not `did this
 * request ask nicely`. That ordering is the whole security property here, and it is
 * why the cookie is read through this function and nowhere else.
 *
 * Deliberately not part of the session cookie or the Firebase claim. Those are minted
 * at sign-in and would need re-minting to change, and switching which customer you are
 * looking at is a thing done many times in one support session.
 */

export const ACTING_ORG_COOKIE = 'acting_org';

/**
 * The organisation whose data this request should see.
 *
 * For everybody who is not Technavious this is their own, always, and the cookie is
 * not even read. For platform staff it is whichever customer they have selected, or
 * their own when they have selected none.
 */
export async function actingOrgId(email: string, ownOrgId: string): Promise<string> {
  if (!isPlatformAdmin(email)) return ownOrgId;

  const jar = await cookies();
  const chosen = jar.get(ACTING_ORG_COOKIE)?.value;
  if (!chosen || !isUsableOrgId(chosen) || chosen === ownOrgId) return ownOrgId;

  // Checked against the real list rather than trusted from the cookie. A deleted or
  // misspelled customer falls back to their own rather than to a store pointed at a
  // prefix nothing lives under, which would look like a customer with no data at all.
  const organisation = await orgStore()
    .get(chosen)
    .catch(() => undefined);
  if (!organisation) return ownOrgId;

  // Worth saying out loud in the log: this is the one place in the app where somebody
  // reads data belonging to a customer they are not part of. A support action that
  // leaves no trace is the kind a customer's security review asks about.
  console.info(`[platform] ${email} is acting as "${chosen}"`);

  return chosen;
}

/** Whether this person is looking at somebody else's customer right now. */
export function isActingElsewhere(person: {
  email: string;
  orgId: string;
  homeOrgId: string;
}): boolean {
  return isPlatformAdmin(person.email) && person.orgId !== person.homeOrgId;
}
