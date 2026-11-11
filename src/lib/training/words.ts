/**
 * The words a closure summary uses, on the screen and in the download alike, so the two
 * never describe the same session differently.
 */

import type { SummaryRow, TrainingSession } from './types';

/**
 * Whether a participant joined late: marked present after the session opened (AI-26).
 *
 * A mark made before the session opened, or one made before marks were timed, is on
 * time. A session closed without ever being opened is given its start when it closes,
 * after every mark, so nobody in it reads as late.
 */
export function joinedLate(
  session: Pick<TrainingSession, 'attendance' | 'attendanceAt' | 'openedAt'>,
  personId: string,
): boolean {
  if (session.attendance[personId] !== 'present') return false;
  const markedAt = session.attendanceAt?.[personId];
  if (!markedAt || !session.openedAt) return false;
  return Date.parse(markedAt) > Date.parse(session.openedAt);
}

export function attendanceWord(
  mark: SummaryRow['attendance'] | undefined,
  late: boolean = false,
): string {
  if (mark === 'absent') return 'Absent';
  if (mark === 'present') return late ? 'Joined late' : 'Present';
  return 'Not marked';
}

/** A session's status, as the boards and the summary name it. */
export const STATUS_WORDS: Record<TrainingSession['status'], string> = {
  scheduled: 'Scheduled',
  open: 'In progress',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/** Said wherever a closed or cancelled session is shown, so nobody looks for a way back. */
export const NO_REOPENING =
  'A closed session cannot be reopened. To run it again, set up a new one.';
export const NO_RUNNING_CANCELLED =
  'A cancelled session cannot be run. To run it after all, set up a new one.';

export function feedbackWord(feedback: SummaryRow['feedback']): string {
  if (feedback === 'submitted') return 'Given';
  if (feedback === 'pending') return 'Pending';
  // Null: this viewer is not shown feedback at all.
  return 'Not shown';
}

export function resultWord(
  row: Pick<SummaryRow, 'postPercent' | 'passed'> & Partial<Pick<SummaryRow, 'postElsewhere'>>,
): string {
  if (row.postPercent === null) return 'Not taken';
  const result = row.passed ? 'Pass' : 'Fail';
  return row.postElsewhere ? `${result}, earlier sitting` : result;
}
