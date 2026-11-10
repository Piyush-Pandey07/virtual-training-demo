/**
 * How long a participant's profile, assessment results and feedback are kept (AI-41).
 *
 * The rule, as the privacy notice states it: in use for 90 days after the participant's
 * last session, then restricted so that only Technavious administrators can see it, then
 * deleted one year after it was last used. Training progress, attendance and consent
 * records are kept for at least five years, and nothing here touches them.
 *
 * Pure functions over dates and records, free of storage, so the tests can walk a
 * participant through a year in a few lines and the daily job and the screens read the
 * same arithmetic.
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

/** Days after last use before a record is deleted. */
export const DELETE_AFTER_DAYS = 365;

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
}

/** Anything the job may restrict. */
export interface Retained {
  retention?: RetentionMark;
}

/** What happens to a record now. */
export type RetentionStep = 'keep' | 'restrict' | 'delete';

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
      .map((attempt) => latest(timeOf(attempt.lastSeenAt), timeOf(attempt.startedAt))),
    ...sessions.map((session) => attendedAt(session, personId)),
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
  const age = now - lastUse;
  if (age >= DELETE_AFTER_DAYS * DAY_MS) return 'delete';
  if (age >= RESTRICT_AFTER_DAYS * DAY_MS) return 'restrict';
  return 'keep';
}

/** The day a record restricted on this last use will be deleted, as ISO 8601. */
export function deletionDue(mark: RetentionMark): string | null {
  const lastUse = timeOf(mark.lastUsedAt);
  return lastUse === null ? null : new Date(lastUse + DELETE_AFTER_DAYS * DAY_MS).toISOString();
}

/** Whether a record's own date alone is recent enough that it cannot be due for anything. */
export function recentEnough(ownDate: number | null, now: number): boolean {
  return ownDate !== null && now - ownDate < RESTRICT_AFTER_DAYS * DAY_MS;
}
