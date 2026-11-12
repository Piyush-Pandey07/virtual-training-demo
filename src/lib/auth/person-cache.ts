/**
 * The roster rows of people signed in, held for a minute per server.
 *
 * Who is signed in is worked out on every request, and every spoken sentence and every
 * transcription is a request. Reading the roster row each time cost a Firestore read
 * per sentence, a few hundred a session, which on the free Spark plan helped use up the
 * project's daily allowance in a day of testing. The session cookie is still verified
 * against Firebase, revocation included, on every request; only the row is held, so a
 * role change on another server takes up to a minute to reach this one, and a change or
 * removal made on this server is seen at once.
 */

import 'server-only';

import type { Person } from '../roster/types';

const HOLD_MS = 60_000;
const LIMIT = 5_000;

const held = new Map<string, { person: Person; until: number }>();

const keyOf = (orgId: string, uid: string) => `${orgId}/${uid}`;

export function heldPerson(orgId: string, uid: string): Person | undefined {
  const entry = held.get(keyOf(orgId, uid));
  if (!entry) return undefined;
  if (entry.until <= Date.now()) {
    held.delete(keyOf(orgId, uid));
    return undefined;
  }
  return entry.person;
}

export function holdPerson(orgId: string, person: Person): void {
  if (held.size >= LIMIT) held.clear();
  held.set(keyOf(orgId, person.id), { person, until: Date.now() + HOLD_MS });
}

/** Forgets one person everywhere on this server, after a change to their row. */
export function forgetPerson(uid: string): void {
  for (const key of held.keys()) if (key.endsWith(`/${uid}`)) held.delete(key);
}
