/**
 * The shape of what the customer list shows, as types.
 *
 * Separate from overview.ts because both sides need these. That module reads the
 * roster and the deck store and is `server-only`; the list that renders the result is
 * a client component, and importing the reader for one type would fail the build --
 * which is what the client/server import test is there to say before the build does.
 *
 * Types and one number. No imports, no storage, nothing to run.
 */

/**
 * How recently an attempt must have moved to be called open.
 *
 * A slide runs to about three minutes and a trainee may sit on a question for longer,
 * so a shorter window would blink sessions in and out while somebody was mid-sentence.
 * Nothing tells the server that a tab was closed, so this is the honest limit of what
 * can be known -- hence "active in the last ten minutes" on the screen rather than a
 * claim that somebody is sitting there.
 */
export const OPEN_SESSION_MINUTES = 10;

export interface OpenSession {
  personName: string;
  personEmail: string;
  deckId: string;
  deckTitle: string | null;
  percent: number;
  startedAt: string;
  lastSeenAt: string;
}

export interface CustomerAdmin {
  name: string;
  email: string;
  /**
   * Technavious's own staff, who are administrators everywhere and are not the
   * customer's own contact. Marked so the list cannot imply a customer has somebody
   * running it when the only administrator they have is us.
   */
  platform: boolean;
  lastSeenAt: string | null;
}

export interface CustomerOverview {
  people: {
    total: number;
    trainees: number;
    /** Rows exist before anybody signs in, so this is worth saying separately. */
    neverSignedIn: number;
    admins: CustomerAdmin[];
  };
  decks: {
    total: number;
    published: number;
  };
  sessions: {
    open: OpenSession[];
    /** Started and not finished, at any age. */
    unfinished: number;
    completed: number;
    lastActivityAt: string | null;
  };
}
