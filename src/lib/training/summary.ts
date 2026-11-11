/**
 * The closure summary of a trainer-led session (BRD v2.3, AI-33).
 *
 * One row per listed participant: whether they attended, their pre-session level, their
 * post-session score with pass or fail, and whether they have given feedback. Shown to
 * the facilitator, administrators and the company administrator, each of whom only ever
 * reaches their own company's sessions, and downloadable as a spreadsheet.
 */

import 'server-only';

import { resultsForDeck } from '../assessments/service';
import { LEVEL_LABELS } from '../assessments/types';
import type { SignedInPerson } from '../roster/types';
import { sessionFor } from './service';
import { dayInTrainingZone } from '../time';
import type { SummaryRow, TrainingSession } from './types';
import { attendanceWord, feedbackWord, resultWord } from './words';

export type { SummaryRow } from './types';

export interface ClosureSummary {
  session: TrainingSession;
  rows: SummaryRow[];
  totals: {
    listed: number;
    present: number;
    absent: number;
    passed: number;
    feedbackGiven: number;
  };
}

export async function closureSummary(
  viewer: SignedInPerson,
  sessionId: string,
): Promise<ClosureSummary> {
  const session = await sessionFor(viewer, sessionId);
  const results = await resultsForDeck(viewer, session.deckId, session.id).catch(() => null);
  const byPerson = new Map((results?.rows ?? []).map((row) => [row.personId, row]));

  const rows: SummaryRow[] = session.participantIds.map((personId) => {
    const result = byPerson.get(personId);
    return {
      personId,
      name: result?.name ?? 'Unknown',
      email: result?.email ?? '',
      attendance: session.attendance[personId] ?? 'not marked',
      preLevel: result?.pre?.level ? LEVEL_LABELS[result.pre.level] : null,
      postPercent: result?.post ? result.post.percent : null,
      passed: result?.post ? result.post.passed : null,
      feedback: result?.feedback ?? null,
    };
  });

  return {
    session,
    rows,
    totals: {
      listed: rows.length,
      present: rows.filter((row) => row.attendance === 'present').length,
      absent: rows.filter((row) => row.attendance === 'absent').length,
      passed: rows.filter((row) => row.passed === true).length,
      feedbackGiven: rows.filter((row) => row.feedback === 'submitted').length,
    },
  };
}

/** A cell, quoted when it needs to be, and never read as a formula by a spreadsheet. */
function cell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  // A tab or carriage return can start a formula too, once a spreadsheet trims it.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Lets Excel open the file as UTF-8, so names in any script survive. */
const BOM = String.fromCharCode(0xfeff);

/** The summary as CSV, with a byte-order mark so Excel opens it as UTF-8. */
export function summaryCsv(summary: ClosureSummary, deckTitle: string): string {
  const header = [
    'Deck',
    'Session date',
    'Participant',
    'Email',
    'Attendance',
    'Pre-session level',
    'Post-session score (%)',
    'Result',
    'Feedback',
  ];
  const when =
    summary.session.scheduledFor ?? summary.session.openedAt ?? summary.session.createdAt;
  const lines = summary.rows.map((row) =>
    [
      deckTitle,
      dayInTrainingZone(when),
      row.name,
      row.email,
      attendanceWord(row.attendance),
      row.preLevel ?? 'Not taken',
      row.postPercent ?? '',
      resultWord(row),
      feedbackWord(row.feedback),
    ]
      .map(cell)
      .join(','),
  );
  return `${BOM}${[header.map(cell).join(','), ...lines].join('\r\n')}\r\n`;
}
