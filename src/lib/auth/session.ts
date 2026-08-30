/**
 * Who is making this request.
 *
 * One place, so every page and every route asks the same question the same way, and
 * so swapping the answer's source is a change to this file rather than to fifty call
 * sites. Firebase is what will answer it: the browser signs in, posts its ID token
 * once, and gets back a session cookie this reads and verifies on every request.
 *
 * Until those credentials exist there is a development sign-in, which trusts a
 * cookie naming a person in the roster. That is obviously not authentication, so it
 * refuses to work anywhere it could be mistaken for it: not on Vercel, and not in a
 * production build. A deployment with no auth configured has no signed-in users at
 * all, which is the honest answer and the safe one.
 */

import 'server-only';

import { cookies } from 'next/headers';

import { firebaseAdminConfigured, verifySessionCookie } from '../firebase/admin';
import { rosterStore } from '../roster/registry';
import { effectiveRole } from './roles';
import type { Person } from '../roster/types';

/** The cookie the real sign-in will set. Read here so the swap is one function. */
export const SESSION_COOKIE = 'session';

/** The development stand-in. Deliberately a different name, so neither can be mistaken. */
export const DEV_SESSION_COOKIE = 'dev-person';

/**
 * Whether the development sign-in may be used at all.
 *
 * Both conditions matter. `VERCEL` catches the deployed app even in a preview build,
 * and `NODE_ENV` catches a production build served from somewhere else. A single
 * check would leave the other door open, and this is a door that must not be open.
 */
export function devAuthEnabled(): boolean {
  // Off wherever real sign-in works, not merely hidden there. The sign-in page stops
  // offering it, but the page is not the control: a route that still answers is a
  // second way in that takes anybody's word for who they are, sitting behind a
  // deployment that has a real one.
  if (firebaseAdminConfigured()) return false;
  return !process.env.VERCEL && process.env.NODE_ENV !== 'production';
}

/** Whether real sign-in is configured. */
export function firebaseConfigured(): boolean {
  return firebaseAdminConfigured();
}

/**
 * The person making this request, or null when nobody is signed in.
 *
 * Never throws. A page that wants a refusal asks the guard for one; a page that
 * merely wants to know reads this.
 */
export async function currentPerson(): Promise<Person | null> {
  const jar = await cookies();

  // The real one. Verified against Firebase on every request, including its
  // revocation state, so disabling somebody or revoking their tokens takes effect on
  // their next request rather than whenever the cookie happens to expire.
  const session = jar.get(SESSION_COOKIE)?.value;
  if (session && firebaseAdminConfigured()) {
    const decoded = await verifySessionCookie(session);
    if (!decoded) return null;

    const person = await rosterStore()
      .getPerson(decoded.uid)
      .catch(() => undefined);

    // Signed in with Firebase but absent from the roster: the sign-in route creates
    // that row, so this is a deployment whose roster storage went away underneath a
    // live cookie. Treating it as nobody is the safe reading.
    if (!person) return null;

    return { ...person, role: effectiveRole(person) };
  }

  if (!devAuthEnabled()) return null;

  const id = jar.get(DEV_SESSION_COOKIE)?.value;
  if (!id) return null;

  const person = await rosterStore()
    .getPerson(id)
    .catch(() => undefined);
  if (!person) return null;

  return { ...person, role: effectiveRole(person) };
}
