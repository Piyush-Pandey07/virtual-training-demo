/**
 * The refusals.
 *
 * Two shapes, because pages and routes fail differently: a page redirects or shows
 * a 404, an API route returns JSON. Both are here so the decision about *who* is
 * allowed lives in one file, and only the presentation differs.
 *
 * The status codes are deliberate. Signed out is 401. Signed in but not entitled is
 * 404 wherever the thing being refused is a particular deck, because deck ids are
 * `slug(title)` plus six random characters, so a 403 on `/session?deck=redundancy-
 * plan-2026-a7f3k2` confirms that deck exists to somebody who guessed the title. A
 * 404 confirms nothing. Where the resource is not secret — creating a deck at all —
 * 403 is fine and more honest.
 */

import 'server-only';

import { notFound, redirect } from 'next/navigation';

import { loadStoredDeck } from '../decks/registry';
import { consentAddress, needsConsent } from '../profiles/gate';
import { rosterStore } from '../roster/registry';
import { isAdministrator, isCompanyAdmin } from './permissions';
import { facilitatesDeck } from '../training/access';
import type { SignedInPerson } from '../roster/types';
import { currentPerson } from './session';

/** Thrown by the route guards, caught by the route, turned into a response. */
export class NotAuthorised extends Error {
  constructor(
    readonly status: 401 | 403 | 404,
    message: string,
  ) {
    super(message);
  }
}

export function unauthorisedResponse(error: unknown): Response | null {
  if (!(error instanceof NotAuthorised)) return null;
  return Response.json({ error: error.message }, { status: error.status });
}

// ------------------------------------------------------------------ for routes

export async function requireUser(): Promise<SignedInPerson> {
  const person = await currentPerson();
  if (!person) throw new NotAuthorised(401, 'Sign in to do that.');
  return person;
}

export async function requireAdmin(): Promise<SignedInPerson> {
  const person = await requireUser();
  if (person.role !== 'admin') {
    // 404 rather than 403: an administrator's tools are not something a trainee needs
    // to know exist.
    throw new NotAuthorised(404, 'Not found.');
  }
  return person;
}

/**
 * Technavious only: platform staff, including when looking inside a customer, and the
 * administrators of Technavious's own organisation (`isAdministrator`).
 *
 * For the deck tools: uploading, editing, analysing, publishing, approving and deleting
 * decks, and their question banks, are the Benchmark administrator's alone. A company
 * administrator gets the same 404 as anybody else, as for the other Technavious tools.
 */
export async function requireAdministrator(): Promise<SignedInPerson> {
  const person = await requireUser();
  if (!isAdministrator(person)) throw new NotAuthorised(404, 'Not found.');
  return person;
}

/**
 * Whether somebody may open a deck they have not been assigned.
 *
 * Technavious may open anything in the customer they are in. A company administrator
 * may open a published deck, to see what they are assigning, but not a draft: drafts are
 * Technavious's work in progress, and the company sees the library read-only. Everybody
 * else needs an assignment.
 */
async function opensUnassigned(person: SignedInPerson, deckId: string): Promise<boolean> {
  if (isAdministrator(person)) return true;
  if (!isCompanyAdmin(person)) return false;
  const stored = await loadStoredDeck(person.orgId, deckId).catch(() => undefined);
  return stored?.status === 'published';
}

/**
 * Whether this person may open this deck's session, as a value, for a page's metadata,
 * which runs outside the page's guard and must not name a deck the page would refuse.
 */
export async function mayOpenDeck(person: SignedInPerson, deckId: string): Promise<boolean> {
  if (await opensUnassigned(person, deckId)) return true;
  return rosterStore(person.orgId)
    .isAssigned(person.id, deckId)
    .catch(() => false);
}

/**
 * The check that stops a signed-in trainee attending a deck nobody gave them.
 *
 * This has to live in the route and not only on the page. `/api/chat` narrates
 * whatever deck id its body names, so a check on the session page alone protects
 * nothing: the browser can post another id and have the trainer read out a deck the
 * trainee was never assigned.
 */
export async function requireAssignedDeck(deckId: string): Promise<SignedInPerson> {
  const person = await requireUser();
  // Technavious may attend anything in the customer it is in, and a company
  // administrator any published deck there, without being assigned it; nothing outside
  // it: every route that loads a deck does so through a store built for this person's
  // organisation, so a deck id from elsewhere resolves to nothing whatever this returns.
  if (!(await opensUnassigned(person, deckId))) {
    const assigned = await rosterStore(person.orgId).isAssigned(person.id, deckId);
    if (!assigned) throw new NotAuthorised(404, 'Not found.');
  }
  await refuseWithoutConsent(person);
  return person;
}

/**
 * Nobody attends before agreeing to the privacy notice (BRD v2.3, AI-27).
 *
 * The pages already send them to the consent page, but the page is not the control: the
 * session talks to `/api/chat`, which would otherwise teach whoever posts to it. Asked
 * after the assignment, so a deck somebody was not given is still a 404 that confirms
 * nothing. A 403 here is honest: the session is theirs, the agreement is what is missing.
 * Nobody PROFILES_ENABLED leaves out is ever asked.
 */
async function refuseWithoutConsent(person: SignedInPerson): Promise<void> {
  if (await needsConsent(person)) {
    throw new NotAuthorised(
      403,
      'Read and agree to the privacy notice before you attend. Reload the page to see it.',
    );
  }
}

/**
 * The same three checks, as a value rather than an exception.
 *
 * Routes with a long body read better guarding at the top with an early return than
 * wrapped in a try that has to tell an authorisation failure apart from a real one.
 *
 *   const gate = await checkAdmin();
 *   if (!gate.ok) return gate.response;
 */
export type Gate = { ok: true; person: SignedInPerson } | { ok: false; response: Response };

async function gate(get: () => Promise<SignedInPerson>): Promise<Gate> {
  try {
    return { ok: true, person: await get() };
  } catch (error) {
    const response = unauthorisedResponse(error);
    if (response) return { ok: false, response };
    throw error;
  }
}

export function checkUser(): Promise<Gate> {
  return gate(requireUser);
}

export function checkAdmin(): Promise<Gate> {
  return gate(requireAdmin);
}

export function checkAdministrator(): Promise<Gate> {
  return gate(requireAdministrator);
}

export function checkAssignedDeck(deckId: string): Promise<Gate> {
  return gate(() => requireAssignedDeck(deckId));
}

/**
 * For a deck's slide images: whoever may attend it, and also the facilitator of a
 * trainer-led session on it, who puts the slides on the screen in the room without being
 * assigned the deck. Only the images: a facilitator still cannot attend it alone or
 * record progress on it, which `requireAssignedDeck` keeps for the routes that do.
 */
export async function requireDeckViewer(deckId: string): Promise<SignedInPerson> {
  const person = await requireUser();
  if (!(await opensUnassigned(person, deckId))) {
    const allowed =
      (await rosterStore(person.orgId).isAssigned(person.id, deckId)) ||
      (await facilitatesDeck(person, deckId));
    if (!allowed) throw new NotAuthorised(404, 'Not found.');
  }
  await refuseWithoutConsent(person);
  return person;
}

export function checkDeckViewer(deckId: string): Promise<Gate> {
  return gate(() => requireDeckViewer(deckId));
}

// ------------------------------------------------------------------- for pages

/**
 * Sends a signed-out visitor to sign in, and somebody who has not agreed to the current
 * privacy notice to agree to it, remembering where they were going either way.
 *
 * Every guarded page comes through here, so the notice is shown before anything else to
 * everybody PROFILES_ENABLED covers, administrators and facilitators included. For
 * everybody else `needsConsent` answers at once without reading anything.
 */
export async function requireUserPage(next?: string): Promise<SignedInPerson> {
  const person = await requireUserPageBeforeConsent(next);
  if (await needsConsent(person)) redirect(consentAddress(next));
  return person;
}

/**
 * Signed in, whether or not they have agreed to the notice yet.
 *
 * For the consent page alone. Anything else guarded with this is a page somebody can use
 * without agreeing, which is exactly what the notice exists to prevent.
 */
export async function requireUserPageBeforeConsent(next?: string): Promise<SignedInPerson> {
  const person = await currentPerson();
  if (person) return person;
  redirect(next ? `/signin?next=${encodeURIComponent(next)}` : '/signin');
}

export async function requireAdminPage(next?: string): Promise<SignedInPerson> {
  const person = await requireUserPage(next);
  if (person.role !== 'admin') notFound();
  return person;
}

/** Technavious only, as `requireAdministrator`, for pages. A 404 for anybody else. */
export async function requireAdministratorPage(next?: string): Promise<SignedInPerson> {
  const person = await requireUserPage(next);
  if (!isAdministrator(person)) notFound();
  return person;
}

export async function requireAssignedDeckPage(
  deckId: string,
  next?: string,
): Promise<SignedInPerson> {
  const person = await requireUserPage(next);
  if (await opensUnassigned(person, deckId)) return person;
  if (!(await rosterStore(person.orgId).isAssigned(person.id, deckId))) notFound();
  return person;
}
