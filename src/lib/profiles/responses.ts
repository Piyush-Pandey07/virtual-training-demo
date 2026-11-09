/**
 * The answers every profile, consent and upload route gives in common.
 *
 * Kept together so "off" looks the same from every one of them: the body any hidden
 * route gives, whatever the reason it is hidden.
 */

import 'server-only';

import { profilesSwitch } from '../config';

/** The same body as every other hidden route. */
export function notFound(): Response {
  return Response.json({ error: 'Not found.' }, { status: 404 });
}

/**
 * Personal data, so nothing between here and the browser may keep a copy. Built per
 * call: a Response shared between requests can only be read once.
 */
export function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * A refusal from the sign-in guard, as these routes give it.
 *
 * With profiles on for everybody, a signed-out caller is told to sign in, as on any
 * route. With them on for Technavious only, the route does not exist for anybody outside
 * it, and a signed-out caller is somebody nobody has placed yet, so they get the 404.
 */
export function signedOut(response: Response): Response {
  return profilesSwitch() === 'everyone' ? response : notFound();
}
