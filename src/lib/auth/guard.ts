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

import { rosterStore } from '../roster/registry';
import type { Person } from '../roster/types';
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

export async function requireUser(): Promise<Person> {
  const person = await currentPerson();
  if (!person) throw new NotAuthorised(401, 'Sign in to do that.');
  return person;
}

export async function requireAdmin(): Promise<Person> {
  const person = await requireUser();
  if (person.role !== 'admin') {
    // 404 rather than 403: an administrator's tools are not something a trainee needs
    // to know exist.
    throw new NotAuthorised(404, 'Not found.');
  }
  return person;
}

/**
 * The check that stops a signed-in trainee attending a deck nobody gave them.
 *
 * This has to live in the route and not only on the page. `/api/chat` narrates
 * whatever deck id its body names, so a check on the session page alone protects
 * nothing: the browser can post another id and have the trainer read out a deck the
 * trainee was never assigned.
 */
export async function requireAssignedDeck(deckId: string): Promise<Person> {
  const person = await requireUser();
  if (person.role === 'admin') return person;

  const assigned = await rosterStore().isAssigned(person.id, deckId);
  if (!assigned) throw new NotAuthorised(404, 'Not found.');
  return person;
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
export type Gate = { ok: true; person: Person } | { ok: false; response: Response };

async function gate(get: () => Promise<Person>): Promise<Gate> {
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

export function checkAssignedDeck(deckId: string): Promise<Gate> {
  return gate(() => requireAssignedDeck(deckId));
}

// ------------------------------------------------------------------- for pages

/** Sends a signed-out visitor to sign in, remembering where they were going. */
export async function requireUserPage(next?: string): Promise<Person> {
  const person = await currentPerson();
  if (person) return person;
  redirect(next ? `/signin?next=${encodeURIComponent(next)}` : '/signin');
}

export async function requireAdminPage(next?: string): Promise<Person> {
  const person = await requireUserPage(next);
  if (person.role !== 'admin') notFound();
  return person;
}

export async function requireAssignedDeckPage(deckId: string, next?: string): Promise<Person> {
  const person = await requireUserPage(next);
  if (person.role === 'admin') return person;
  if (!(await rosterStore().isAssigned(person.id, deckId))) notFound();
  return person;
}
