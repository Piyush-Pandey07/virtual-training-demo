import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { strFromU8, unzipSync } from 'fflate';

import { safeText, summaryWorkbook, type ClosureSummary } from './summary';
import type { SummaryRow } from './types';

/**
 * The downloadable closure summary of a trainer-led session (AI-33): an Excel workbook,
 * with the session's times in India time.
 *
 * Read back by unzipping it and reading its XML, which is what an .xlsx is, so the test
 * needs nothing that could also have written it.
 */

const summary: ClosureSummary = {
  session: {
    id: 's-1',
    deckId: 'd',
    facilitatorId: 'f',
    batchId: null,
    participantIds: ['a', 'b', 'c'],
    scheduledFor: '2026-11-13T09:30:00.000Z',
    status: 'closed',
    attendance: { a: 'present', b: 'absent', c: 'present' },
    attendanceAt: {
      a: '2026-11-13T09:25:00.000Z',
      b: '2026-11-13T09:25:00.000Z',
      c: '2026-11-13T09:50:00.000Z',
    },
    createdBy: 'f',
    createdAt: '2026-11-10T08:00:00.000Z',
    openedAt: '2026-11-13T09:31:00.000Z',
    closedAt: '2026-11-13T11:00:00.000Z',
    closedBy: 'f',
  },
  rows: [
    {
      personId: 'a',
      name: 'Asha Rao',
      email: 'asha@example.com',
      attendance: 'present',
      joinedLate: false,
      markedAt: '2026-11-13T09:25:00.000Z',
      preLevel: 'Intermediate',
      preVersion: '3',
      postPercent: 80,
      passed: true,
      postElsewhere: false,
      postWrong: null,
      postNotAttempted: null,
      postVersion: null,
      feedback: 'submitted',
    },
    {
      personId: 'b',
      name: '=HYPERLINK("http://example.com")',
      email: 'b@example.com',
      attendance: 'absent',
      joinedLate: false,
      markedAt: '2026-11-13T09:25:00.000Z',
      preLevel: null,
      preVersion: null,
      postPercent: null,
      passed: null,
      postElsewhere: false,
      postWrong: null,
      postNotAttempted: null,
      postVersion: null,
      feedback: 'pending',
    },
    {
      personId: 'c',
      name: 'Chen Li',
      email: 'chen@example.com',
      attendance: 'present',
      joinedLate: true,
      markedAt: '2026-11-13T09:50:00.000Z',
      preLevel: null,
      preVersion: null,
      postPercent: 60,
      passed: false,
      postElsewhere: false,
      postWrong: null,
      postNotAttempted: null,
      postVersion: null,
      feedback: 'pending',
    },
  ],
  totals: { listed: 3, present: 2, joinedLate: 1, absent: 1, passed: 1, feedbackGiven: 1 },
};

const decode = (xml: string) =>
  xml
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&');

/** The first sheet's rows, each cell as the text or number it holds. */
async function rowsOf(
  value: ClosureSummary,
  title = 'Data Centre Power, Day 1',
): Promise<string[][]> {
  const bytes = await summaryWorkbook(value, title, 'Fran Iyer');
  // An .xlsx is a zip, which starts "PK".
  assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK');
  const files = unzipSync(new Uint8Array(bytes));
  assert.ok(files['[Content_Types].xml'], 'not a workbook');
  const shared = [
    ...strFromU8(files['xl/sharedStrings.xml']!).matchAll(/<si>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/g),
  ].map((match) => decode(match[1]!));
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
  return [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>|<row[^>]*\/>/g)].map((row) => {
    const cells: string[] = [];
    for (const cell of (row[1] ?? '').matchAll(
      /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const column = cell[1]!.charCodeAt(0) - 65;
      const raw = /<v>([\s\S]*?)<\/v>/.exec(cell[3] ?? '')?.[1];
      cells[column] = raw === undefined ? '' : /t="s"/.test(cell[2]!) ? shared[Number(raw)]! : raw;
    }
    return Array.from(cells, (entry) => entry ?? '');
  });
}

/** The value beside a label in the session block at the top. */
function field(rows: string[][], label: string): string | undefined {
  return rows.find((row) => row[0] === label)?.[1];
}

function participants(rows: string[][]): string[][] {
  const header = rows.findIndex((row) => row[0] === 'Participant');
  assert.ok(header > 0, 'no participant table');
  return rows.slice(header + 1);
}

describe('the closure summary download', () => {
  it('is an Excel workbook with one row per participant', async () => {
    const rows = await rowsOf(summary);
    const header = rows.find((row) => row[0] === 'Participant');
    assert.deepEqual(header, [
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
    ]);
    assert.equal(participants(rows).length, 3);
  });

  it('writes attendance, joined late included, level, score and pass or fail', async () => {
    const [asha, , chen] = participants(await rowsOf(summary));
    assert.deepEqual(asha, [
      'Asha Rao',
      'asha@example.com',
      'Present',
      '13 November 2026, 14:55 IST',
      'Intermediate',
      '80',
      'Pass',
      'Given',
      '',
      '',
      '3',
    ]);
    assert.equal(chen![2], 'Joined late');
    assert.equal(chen![3], '13 November 2026, 15:20 IST');
    assert.equal(chen![6], 'Fail');
    assert.equal(chen![7], 'Pending');
  });

  it('gives the session, its date and times in India time, with the zone named', async () => {
    const rows = await rowsOf(summary);
    assert.equal(field(rows, 'Deck'), 'Data Centre Power, Day 1');
    assert.equal(field(rows, 'Facilitator'), 'Fran Iyer');
    assert.equal(field(rows, 'Status'), 'Closed');
    assert.equal(field(rows, 'Session date (IST)'), '2026-11-13');
    assert.equal(field(rows, 'Scheduled for'), '13 November 2026, 15:00 IST');
    assert.equal(field(rows, 'Opened'), '13 November 2026, 15:01 IST');
    assert.equal(field(rows, 'Closed'), '13 November 2026, 16:30 IST');
    assert.equal(field(rows, 'Of whom joined late'), '1');
    assert.ok(rows.some((row) => /India Standard Time \(IST, UTC\+05:30\)/.test(row[0] ?? '')));
  });

  it('dates the session by the day in India, not in UTC', async () => {
    const late = await rowsOf({
      ...summary,
      session: { ...summary.session, scheduledFor: '2026-11-12T20:00:00.000Z' },
    });
    assert.equal(field(late, 'Session date (IST)'), '2026-11-13');
  });

  it('never lets a name run as a formula', async () => {
    const [, bad] = participants(await rowsOf(summary));
    assert.equal(bad![0], `'=HYPERLINK("http://example.com")`);
    assert.equal(safeText('\t=1+1'), "'\t=1+1");
    assert.equal(safeText('+91 98'), "'+91 98");
    assert.equal(safeText('-'), "'-");
    assert.equal(safeText('@risk'), "'@risk");
    assert.equal(safeText('Asha'), 'Asha');
    // No cell in the workbook is a formula at all.
    const bytes = await summaryWorkbook(summary, 'Deck', 'Fran');
    const sheet = strFromU8(unzipSync(new Uint8Array(bytes))['xl/worksheets/sheet1.xml']!);
    assert.doesNotMatch(sheet, /<f>/);
  });

  it('gives wrong and not attempted counts and the bank version when the result records them', async () => {
    const [asha] = participants(
      await rowsOf({
        ...summary,
        rows: [{ ...summary.rows[0]!, postWrong: 2, postNotAttempted: 1, postVersion: '4' }],
      }),
    );
    assert.deepEqual(asha!.slice(8), ['2', '1', '3', '4']);
  });

  it('says when a post-session result came from an earlier sitting of the deck', async () => {
    const [asha] = participants(
      await rowsOf({ ...summary, rows: [{ ...summary.rows[0]!, postElsewhere: true }] }),
    );
    assert.equal(asha![6], 'Pass, earlier sitting');
  });

  it('holds a room of fifty (AI-28)', async () => {
    const fifty: SummaryRow[] = Array.from({ length: 50 }, (_, index) => ({
      ...summary.rows[0]!,
      personId: `p${index}`,
      name: `Person ${index}`,
      email: `p${index}@example.com`,
    }));
    const rows = participants(await rowsOf({ ...summary, rows: fifty }));
    assert.equal(rows.length, 50);
    assert.equal(rows[49]![0], 'Person 49');
  });
});
