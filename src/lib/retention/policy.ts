/**
 * How long a participant's training data is kept (AI-27, AI-41, AI-42).
 *
 * The rule the product owner decided, in three steps measured from last use:
 *
 * - **90 days**: profiles, assessment results and feedback are restricted, so that only
 *   Technavious administrators can see them.
 * - **1 year**: the learner profile is deleted, and so are the assessment answers: the
 *   per-question answers on a result, and any free text written in feedback. The score,
 *   pass or fail, level and dates on the result stay, as do the feedback ratings.
 * - **5 years**: everything else goes. The rest of the result and the feedback, the
 *   attempts that record completion, trainer-led sessions with their attendance, and the
 *   name and address of anybody who has left.
 *
 * Name, email, attendance, completion, score and pass or fail are therefore kept for five
 * years, and the personal detail around them for one. Consent records are not touched:
 * the notice keeps them for at least five years, and they record what was agreed rather
 * than anything about the training.
 *
 * Pure functions over dates and records, free of storage, so the tests can walk a
 * participant through five years in a few lines and the daily job and the screens read
 * the same arithmetic.
 *
 * "Last session" is per person: the latest of their AI-led attempt activity and any
 * trainer-led session they attended. "Last use" is per record: the later of that and the
 * record's own date. A participant who changed their profile yesterday has used it
 * yesterday, whenever they last sat a session, and one who has never sat a session still
 * has a record whose own date says when it was last touched. Taking the later of the two
 * means the job can only ever err towards keeping something a little longer, never
 * towards deleting something that is still in use.
 */

import type { Attempt } from '../roster/types';
import type { TrainingSession } from '../training/types';

/** Days after last use before a record is restricted to administrators. */
export const RESTRICT_AFTER_DAYS = 90;

/** Days after last use before the profile and the assessment answers are deleted. */
export const DELETE_AFTER_DAYS = 365;

/**
 * Years after last use before the rest of the training record is deleted.
 *
 * Years rather than days, counted on the calendar, so that "five years" means the same
 * date five years on whatever leap days fall in between, rather than a number of days
 * that is a day short in some spans.
 */
export const RECORD_KEPT_YEARS = 5;

const DAY_MS = 86_400_000;

/**
 * What the daily job writes on a record it restricts.
 *
 * One field, so the read paths have one thing to honour, carrying the last use the job
 * worked from so an administrator can be told when the record will go.
 */
export interface RetentionMark {
  /** ISO 8601. When the job restricted it. */
  restrictedAt: string;
  /** ISO 8601. The last use the job measured from. */
  lastUsedAt: string;
  /**
   * ISO 8601. When the job deleted the answers from a result, or the free text from
   * feedback, a year after last use. Absent until then.
   */
  erasedAt?: string;
}

/** Anything the job may restrict. */
export interface Retained {
  retention?: RetentionMark;
}

/**
 * What happens to a record now.
 *
 * `erase` is the one-year step: a profile is deleted, and a result or feedback loses its
 * answers or free text and keeps the rest. `delete` is the five-year step, for anything.
 */
export type RetentionStep = 'keep' | 'restrict' | 'erase' | 'delete';

/** A valid time in milliseconds, or null for anything absent or unreadable. */
export function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : at;
}

/** The latest of some times, ignoring the ones that are missing. Null when there are none. */
export function latest(...times: Array<number | null | undefined>): number | null {
  const known = times.filter((time): time is number => typeof time === 'number');
  return known.length > 0 ? Math.max(...known) : null;
}

/** The same moment some years later, on the calendar, in UTC. */
export function yearsAfter(time: number, years: number): number {
  const at = new Date(time);
  at.setUTCFullYear(at.getUTCFullYear() + years);
  return at.getTime();
}

/**
 * When a trainer-led session counts as attended by this person, or null.
 *
 * They must have been on its list, not marked absent, and the session must have been
 * opened: a session that was only ever scheduled is not one anybody sat. It counts from
 * when it closed, or from when it opened if it is still open.
 */
export function attendedAt(session: TrainingSession, personId: string): number | null {
  if (!session.participantIds.includes(personId)) return null;
  if (session.attendance[personId] === 'absent') return null;
  if (!session.openedAt && session.status === 'scheduled') return null;
  return latest(timeOf(session.closedAt), timeOf(session.openedAt));
}

/** The person's last session: AI-led activity and trainer-led attendance, whichever is later. */
export function lastSessionAt(
  personId: string,
  attempts: readonly Attempt[],
  sessions: readonly TrainingSession[],
): number | null {
  return latest(
    ...attempts
      .filter((attempt) => attempt.personId === personId)
      .map((attempt) => attemptDate(attempt)),
    ...sessions.map((session) => attendedAt(session, personId)),
  );
}

/** An attempt's own date: the last time it was touched or finished. */
export function attemptDate(attempt: Attempt): number | null {
  return latest(timeOf(attempt.lastSeenAt), timeOf(attempt.startedAt), timeOf(attempt.completedAt));
}

/**
 * A trainer-led session's own date: when it closed, opened, was scheduled for or was set
 * up, whichever is latest. Its attendance is a record of that day.
 */
export function sessionDate(session: TrainingSession): number | null {
  return latest(
    timeOf(session.closedAt),
    timeOf(session.openedAt),
    timeOf(session.scheduledFor),
    timeOf(session.createdAt),
  );
}

/**
 * What the policy says should happen to a record last used at `lastUse`, as of `now`.
 *
 * Without a last use there is nothing to measure from, and the answer is to keep it. A
 * record is never deleted because a date could not be read.
 */
export function stepFor(lastUse: number | null, now: number): RetentionStep {
  if (lastUse === null) return 'keep';
  if (now >= yearsAfter(lastUse, RECORD_KEPT_YEARS)) return 'delete';
  const age = now - lastUse;
  if (age >= DELETE_AFTER_DAYS * DAY_MS) return 'erase';
  if (age >= RESTRICT_AFTER_DAYS * DAY_MS) return 'restrict';
  return 'keep';
}

/**
 * The day a record restricted on this last use loses its personal detail, as ISO 8601:
 * a profile is deleted then, and a result or feedback loses its answers or free text.
 */
export function deletionDue(mark: RetentionMark): string | null {
  const lastUse = timeOf(mark.lastUsedAt);
  return lastUse === null ? null : new Date(lastUse + DELETE_AFTER_DAYS * DAY_MS).toISOString();
}

/** The day what remains of a record measured from this last use is deleted, as ISO 8601. */
export function recordDeletionDue(mark: RetentionMark): string | null {
  const lastUse = timeOf(mark.lastUsedAt);
  return lastUse === null ? null : new Date(yearsAfter(lastUse, RECORD_KEPT_YEARS)).toISOString();
}

/** Whether a record's own date alone is recent enough that it cannot be due for anything. */
export function recentEnough(ownDate: number | null, now: number): boolean {
  return ownDate !== null && now - ownDate < RESTRICT_AFTER_DAYS * DAY_MS;
}
