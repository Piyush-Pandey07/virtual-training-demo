/**
 * The words a closure summary uses, on the screen and in the download alike, so the two
 * never describe the same session differently.
 */

import type { SummaryRow } from './types';

export function attendanceWord(mark: SummaryRow['attendance'] | undefined): string {
  if (mark === 'absent') return 'Absent';
  if (mark === 'present') return 'Present';
  return 'Not marked';
}

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
