/**
 * The closure summary of a trainer-led session (BRD v2.3, AI-33).
 *
 * One row per listed participant: whether they attended, and whether they joined late,
 * their pre-session level, their post-session score with pass or fail, and whether they
 * have given feedback. Shown to the facilitator, administrators and the company
 * administrator, each of whom only ever reaches their own company's sessions, and
 * downloadable as an Excel workbook.
 */

import 'server-only';

import writeExcelFile, { type SheetData } from 'write-excel-file/node';

import { resultsForDeck, type ServiceOptions } from '../assessments/service';
import { outcomeCounts } from '../assessments/scoring';
import { assessmentStore } from '../assessments/store';
import { LEVEL_LABELS, type AssessmentResult, type Level } from '../assessments/types';
import { visibleTo } from '../retention/restricted';
import type { SignedInPerson } from '../roster/types';
import { sessionFor } from './service';
import { dayInTrainingZone, formatMoment } from '../time';
import type { SummaryRow, TrainingSession } from './types';
import { attendanceWord, feedbackWord, joinedLate, resultWord, STATUS_WORDS } from './words';

export type { SummaryRow } from './types';

export interface ClosureSummary {
  session: TrainingSession;
  rows: SummaryRow[];
  totals: {
    listed: number;
    present: number;
    /** Of those present, how many were marked after the session opened. */
    joinedLate: number;
    absent: number;
    passed: number;
    feedbackGiven: number;
  };
}

/**
 * A participant's pre-session level for this session, as the results screen gives it:
 * worked out with the session's own level bands (AI-04), not the level stored when the
 * result was submitted, since an administrator may have changed the bands since.
 */
export function preLevelOf(level: Level | null | undefined): string | null {
  return level ? LEVEL_LABELS[level] : null;
}

/**
 * How many post-session answers were wrong and how many left blank, worked out as the
 * result card works them out (from the stored counts, or from the answers of a result
 * scored before counts were stored). Null without a result, so the cell stays blank.
 */
function countOf(
  result: AssessmentResult | undefined,
  field: 'wrong' | 'notAttempted',
): number | null {
  return result ? outcomeCounts(result)[field] : null;
}

/** The bank's version as people number it, when the result records one. */
function versionOf(result: AssessmentResult | undefined): string | null {
  return result?.bankVersionNumber !== undefined ? String(result.bankVersionNumber) : null;
}

export async function closureSummary(
  viewer: SignedInPerson,
  sessionId: string,
  options: ServiceOptions = {},
): Promise<ClosureSummary> {
  const session = await sessionFor(viewer, sessionId, { store: options.store });
  // Not caught: a summary that could not read the results would list everybody as
  // unknown and not taken, which reads as a fact. Better that it fails and says so.
  const [results, stored] = await Promise.all([
    resultsForDeck(viewer, session.deckId, session.id, options),
    assessmentStore(viewer.orgId, options.store).resultsForDeck(session.deckId),
  ]);
  const byPerson = new Map(results.rows.map((row) => [row.personId, row]));
  // The stored results themselves, for what the results screen does not carry. Only
  // those the screen showed this viewer, restricted ones left out as it leaves them out.
  const record = (personId: string, kind: 'pre' | 'post', shown: unknown) =>
    shown
      ? visibleTo(
          viewer,
          stored.find((entry) => entry.personId === personId && entry.kind === kind),
        )
      : undefined;

  const rows: SummaryRow[] = session.participantIds.map((personId) => {
    const result = byPerson.get(personId);
    const pre = record(personId, 'pre', result?.pre);
    const post = record(personId, 'post', result?.post);
    return {
      personId,
      name: result?.name ?? 'Unknown',
      email: result?.email ?? '',
      attendance: session.attendance[personId] ?? 'not marked',
      joinedLate: joinedLate(session, personId),
      markedAt: session.attendanceAt?.[personId] ?? null,
      preLevel: pre ? preLevelOf(result?.pre?.level) : null,
      preVersion: versionOf(pre),
      postPercent: result?.post ? result.post.percent : null,
      passed: result?.post ? result.post.passed : null,
      postElsewhere: Boolean(result?.post && result.post.sessionId !== session.id),
      postWrong: countOf(post, 'wrong'),
      postNotAttempted: countOf(post, 'notAttempted'),
      postVersion: versionOf(post),
      feedback: result?.feedback ?? null,
    };
  });

  return {
    session,
    rows,
    totals: {
      listed: rows.length,
      present: rows.filter((row) => row.attendance === 'present').length,
      joinedLate: rows.filter((row) => row.joinedLate).length,
      absent: rows.filter((row) => row.attendance === 'absent').length,
      // Only passes earned after this session.
      passed: rows.filter((row) => row.passed === true && !row.postElsewhere).length,
      feedbackGiven: rows.filter((row) => row.feedback === 'submitted').length,
    },
  };
}

/**
 * Text that a spreadsheet will never run as a formula.
 *
 * A workbook stores text as text, so Excel does not evaluate it as it opens the file,
 * but the cell is one edit away from it: somebody clicking into a name such as
 * `=HYPERLINK(...)` and pressing Enter turns it into a live formula, and the same text
 * copied out to a CSV runs as soon as that is opened. So a value starting with anything
 * a formula can start with is given a leading apostrophe, as the CSV download did. A tab
 * or carriage return counts, since a spreadsheet trims it and finds the formula behind.
 */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** A text cell, held as text even when it looks like a number or a date. */
function text(value: string, bold = false) {
  return {
    value: safeText(value),
    type: String,
    format: '@',
    ...(bold ? { fontWeight: 'bold' as const } : {}),
  };
}

function moment(iso: string | null | undefined, otherwise: string): string {
  return iso ? formatMoment(iso) : otherwise;
}

const COLUMNS = [
  'Participant',
  'Email',
  'Attendance',
  'Marked at (IST)',
  'Pre-session level',
  'Post-session score (%)',
  'Result',
  'Feedback',
  'Post-session wrong',
  'Post-session not attempted',
  'Pre-session bank version',
  'Post-session bank version',
];

/** A number, or a blank cell where the result does not record it. */
const count = (value: number | null) => (value === null ? null : { value, type: Number });

/** The cells of the workbook: the session first, then one row per participant. */
export function summarySheet(
  summary: ClosureSummary,
  deckTitle: string,
  facilitatorName: string,
): SheetData {
  const { session, totals } = summary;
  const when = session.scheduledFor ?? session.openedAt ?? session.createdAt;
  const field = (label: string, value: string | number) => [
    text(label, true),
    typeof value === 'number' ? { value, type: Number } : text(value),
  ];

  return [
    [text('Closure summary', true)],
    field('Deck', deckTitle),
    field('Facilitator', facilitatorName),
    field('Status', STATUS_WORDS[session.status]),
    field('Session date (IST)', dayInTrainingZone(when)),
    field('Scheduled for', moment(session.scheduledFor, 'No time set')),
    field('Opened', moment(session.openedAt, 'Not opened')),
    field('Closed', moment(session.closedAt, 'Not closed')),
    ...(session.status === 'cancelled'
      ? [field('Cancelled', moment(session.cancelledAt, ''))]
      : []),
    field('Listed', totals.listed),
    field('Present', totals.present),
    field('Of whom joined late', totals.joinedLate),
    field('Absent', totals.absent),
    field('Passed the post-session assessment', totals.passed),
    field('Gave feedback', totals.feedbackGiven),
    [text('All times are India Standard Time (IST, UTC+05:30).')],
    [],
    COLUMNS.map((heading) => text(heading, true)),
    ...summary.rows.map((row) => [
      text(row.name),
      text(row.email),
      text(attendanceWord(row.attendance, row.joinedLate)),
      text(row.attendance === 'not marked' ? '' : moment(row.markedAt, 'Not recorded')),
      text(row.preLevel ?? 'Not taken'),
      count(row.postPercent),
      text(resultWord(row)),
      text(feedbackWord(row.feedback)),
      count(row.postWrong),
      count(row.postNotAttempted),
      row.preVersion === null ? null : text(row.preVersion),
      row.postVersion === null ? null : text(row.postVersion),
    ]),
  ];
}

/** The summary as an Excel workbook (.xlsx), for the download. */
export async function summaryWorkbook(
  summary: ClosureSummary,
  deckTitle: string,
  facilitatorName: string,
): Promise<Buffer> {
  return writeExcelFile(summarySheet(summary, deckTitle, facilitatorName), {
    sheet: 'Summary',
    columns: [
      { width: 34 },
      { width: 32 },
      { width: 14 },
      { width: 28 },
      { width: 18 },
      { width: 22 },
      { width: 22 },
      { width: 12 },
      { width: 18 },
      { width: 26 },
      { width: 24 },
      { width: 24 },
    ],
  }).toBuffer();
}
