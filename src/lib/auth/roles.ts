/**
 * Who is an administrator, as a matter of configuration.
 *
 * Separate from `session.ts`, which answers who is making a request. These are
 * different questions and conflating them is how a route ends up resolving identity
 * for itself instead of asking the guard: everything here is a pure function of an
 * address and the environment, and none of it knows or cares who is signed in.
 *
 * The bootstrap this exists for: the first administrator cannot be promoted by an
 * administrator who does not exist yet. Kept as a floor rather than a one-time seed,
 * so an empty roster, a database that has moved, or an administrator who demoted
 * themselves is recoverable by an environment variable rather than by a console.
 */

import { emailKeyOf } from '../roster/store';
import type { Person, Role } from '../roster/types';

export function bootstrapAdminEmails(): ReadonlySet<string> {
  const raw = process.env.AUTH_ADMIN_EMAILS ?? '';
  return new Set(
    raw
      .split(',')
      .map((entry) => emailKeyOf(entry))
      .filter((entry) => entry.length > 0),
  );
}

export function isBootstrapAdmin(email: string): boolean {
  return bootstrapAdminEmails().has(emailKeyOf(email));
}

/**
 * The domains an address may sign in from, if the deployment restricts them at all.
 *
 * Empty means unrestricted, which is the right default for a deployment that has not
 * said otherwise -- the roster is the gate in that case, and it is a real one.
 */
export function allowedEmailDomains(): ReadonlySet<string> {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS ?? '';
  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

/**
 * Whether an address may sign in at all, before anything is known about the person.
 *
 * An address named in AUTH_ADMIN_EMAILS passes whatever its domain. That reads like a
 * hole and is not one: the same list already makes that exact address an administrator
 * with access to everything, so refusing it here would deny nothing it cannot reach by
 * being on the list at all. What it fixes is a real trap -- naming an outside address
 * as the bootstrap administrator appeared to work, and then failed at sign-in with
 * "not part of this organisation", which is the wrong explanation for the wrong reason
 * and leaves the deployment with no administrator and no obvious way to get one.
 *
 * The exemption is per exact address and never per domain. Adding a whole public
 * domain to ALLOWED_EMAIL_DOMAINS to let one person in would let in everybody holding
 * an address there, and that is the mistake this exists to make unnecessary.
 */
export function emailAllowed(email: string): boolean {
  const domains = allowedEmailDomains();
  if (domains.size === 0) return true;
  if (bootstrapAdminEmails().has(emailKeyOf(email))) return true;

  return domains.has(emailKeyOf(email).split('@')[1] ?? '');
}

/**
 * The role that actually applies.
 *
 * Not always the stored one: an address named in the deployment configuration is an
 * administrator whatever the row says. Everything that reports or checks a role goes
 * through here, so a page and an API response cannot disagree about somebody.
 */
export function effectiveRole(person: Person): Role {
  return isBootstrapAdmin(person.email) ? 'admin' : person.role;
}
