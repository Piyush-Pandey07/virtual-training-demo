/**
 * Two kinds of administrator, which must not become one field.
 *
 * A **customer administrator** runs training inside one company. They upload decks,
 * assign them, and see who attended — all of it confined to their own organisation by
 * the store they are handed. This is a role on a roster row, and a customer's own
 * administrators can grant it to each other.
 *
 * **Platform staff** are Technavious. They may look inside any customer, for support,
 * and that is the only deliberate cross-customer access in the system. It is not a
 * role on a row: it is an environment variable, so nobody can grant it from inside the
 * app — not a customer administrator, and not a compromised session.
 *
 * Keeping them apart is the whole point of this file. One `admin` flag covering both
 * would mean every customer's HR lead could read every other customer, and the only
 * thing standing between those two readings would be that nobody had thought about it.
 */

import { emailKeyOf } from '../roster/store';
import type { Person, Role } from '../roster/types';

/**
 * Technavious staff, by exact address.
 *
 * An environment variable rather than a database row on purpose. A row can be written
 * by anything that can write rows; this can only be changed by whoever deploys, which
 * is the property that makes it worth trusting for cross-customer access.
 *
 * Was `AUTH_ADMIN_EMAILS`, when there was one company and the two ideas were the same
 * thing. Both names are read so a deployment does not lose its administrators between
 * a config change and a deploy, and the old one should be removed once it has been.
 */
export function platformAdminEmails(): ReadonlySet<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? process.env.AUTH_ADMIN_EMAILS ?? '';
  return new Set(
    raw
      .split(',')
      .map((entry) => emailKeyOf(entry))
      .filter((entry) => entry.length > 0),
  );
}

/** Whether this address is Technavious rather than a customer. */
export function isPlatformAdmin(email: string): boolean {
  return platformAdminEmails().has(emailKeyOf(email));
}

/**
 * The role that actually applies.
 *
 * Not always the stored one: platform staff are administrators wherever they are
 * looking, whatever the row in that customer's roster says. Everything that reports or
 * checks a role goes through here, so a page and an API response cannot disagree.
 *
 * Note what this does *not* do. It does not decide which customer somebody may look
 * at — that is `actingOrgId`, and it is a separate question with a separate answer.
 * Being an administrator and being inside a customer are different facts, and the bug
 * this shape avoids is an administrator of one company quietly being treated as an
 * administrator of another.
 */
export function effectiveRole(person: Person): Role {
  return isPlatformAdmin(person.email) ? 'admin' : person.role;
}
