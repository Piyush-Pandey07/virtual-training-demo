/**
 * People, what they were asked to do, and how far they got.
 *
 * Types only, and deliberately free of imports, so both the server and the browser
 * can hold them. The deck side of the app keeps its whole record server-side and
 * ships a narrowed projection; this side is small enough that the same record is
 * safe to render, with one exception noted on `PersonRow`.
 */

export type Role = 'admin' | 'trainee';

/** Somebody who can sign in. Created on first sign-in, or by an admin assigning work. */
export interface Person {
  /** Stable identity. The auth provider's uid once sign-in exists. */
  id: string;
  /**
   * The customer company this person belongs to.
   *
   * Optional only while the deployment is being migrated: rows written before
   * organisations existed have none, and a row with none belongs to nobody and is
   * reachable by nobody. That is the right way for the gap to fail, and it is why
   * this is not defaulted to a home organisation at read time — a default here would
   * quietly hand every unmigrated row to whoever the default names.
   */
  orgId?: string;
  /** As the person spells it, for display. */
  email: string;
  /** Lower-cased and trimmed. The key everything joins on. */
  emailKey: string;
  name: string;
  role: Role;
  /** ISO 8601. */
  createdAt: string;
  lastSeenAt: string | null;
}

/** A deck somebody has been asked to attend. */
export interface Assignment {
  personId: string;
  /** Decks live in blob storage, so this is a plain id and not a foreign key. */
  deckId: string;
  assignedBy: string;
  assignedAt: string;
  dueAt: string | null;
}

/**
 * One slide the trainer actually finished teaching.
 *
 * `targetSeconds` is snapshotted at the moment it was covered rather than read back
 * from the deck. Re-analysing a deck moves its pacing, and a trainee who is halfway
 * through should not have the denominator shift under them.
 */
export interface CoveredSlide {
  slideId: number;
  targetSeconds: number;
  coveredAt: string;
}

/** One person's run at one deck. There is at most one per pair. */
export interface Attempt {
  personId: string;
  deckId: string;
  covered: CoveredSlide[];
  /** Where to resume. Null before the first slide finishes. */
  lastSlideId: number | null;
  /**
   * The deck as it was when the attempt opened.
   *
   * Snapshotted for the same reason as `targetSeconds`: so re-analysing a deck does
   * not silently change what a percentage means.
   */
  slideCount: number;
  totalSeconds: number;
  startedAt: string;
  lastSeenAt: string;
  completedAt: string | null;
}

/** What a percentage is worked out from. */
export interface Coverage {
  coveredSeconds: number;
  totalSeconds: number;
  coveredCount: number;
  slideCount: number;
}

/**
 * One row of a report: a person, a deck, and where they are.
 *
 * Built by joining an assignment to the attempt that may not exist yet — a person who
 * has never started is a row with a null attempt, and that is the row an admin most
 * wants to see.
 */
export interface ProgressRow {
  personId: string;
  personName: string;
  personEmail: string;
  deckId: string;
  /** Null when the deck has been deleted out from under the assignment. */
  deckTitle: string | null;
  assignedAt: string;
  dueAt: string | null;
  startedAt: string | null;
  lastSeenAt: string | null;
  completedAt: string | null;
  lastSlideId: number | null;
  coverage: Coverage;
  percent: number;
  /**
   * True when the deck has been re-analysed since this attempt opened, so the
   * percentage is against the deck as it was. Worth saying out loud in a report,
   * because it otherwise looks like a bug.
   */
  deckChangedSince: boolean;
}
