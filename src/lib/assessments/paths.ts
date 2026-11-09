/**
 * Where each assessment screen lives, built in one place.
 *
 * Free of imports beyond the types, so the session screen in the browser and the pages
 * on the server link to the same addresses. A trainer-led session carries its id along,
 * because feedback is given per session and the result records which one it was for.
 */

import type { BankKind } from './types';

function query(deckId: string, sessionId?: string | null): string {
  const params = new URLSearchParams({ deck: deckId });
  if (sessionId) params.set('session', sessionId);
  return params.toString();
}

/** Where a participant takes the pre or post-session assessment. */
export function assessmentHref(kind: BankKind, deckId: string, sessionId?: string | null): string {
  return `/assessment/${kind}?${query(deckId, sessionId)}`;
}

/** Where a participant gives feedback. */
export function feedbackHref(deckId: string, sessionId?: string | null): string {
  return `/feedback?${query(deckId, sessionId)}`;
}

/** The results and feedback screen for a deck, or for one trainer-led session of it. */
export function resultsHref(deckId: string, sessionId?: string | null): string {
  const base = `/decks/${encodeURIComponent(deckId)}/results`;
  return sessionId ? `${base}?session=${encodeURIComponent(sessionId)}` : base;
}

/** The administrator's question bank screen for a deck. */
export function banksHref(deckId: string): string {
  return `/decks/${encodeURIComponent(deckId)}/questions`;
}

/** The AI-led session for a deck. */
export function sessionHref(deckId: string): string {
  return `/session?deck=${encodeURIComponent(deckId)}`;
}
