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
 * The role that actually applies.
 *
 * Not always the stored one: an address named in the deployment configuration is an
 * administrator whatever the row says. Everything that reports or checks a role goes
 * through here, so a page and an API response cannot disagree about somebody.
 */
export function effectiveRole(person: Person): Role {
  return isBootstrapAdmin(person.email) ? 'admin' : person.role;
}
