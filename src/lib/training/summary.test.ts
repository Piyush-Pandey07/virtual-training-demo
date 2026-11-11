import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { summaryCsv, type ClosureSummary } from './summary';

/** The downloadable closure summary of a trainer-led session (AI-33). */

const summary: ClosureSummary = {
  session: {
    id: 's-1',
    deckId: 'd',
    facilitatorId: 'f',
    batchId: null,
    participantIds: ['a', 'b'],
    scheduledFor: '2026-11-13T09:30:00.000Z',
    status: 'closed',
    attendance: { a: 'present', b: 'absent' },
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
      preLevel: 'Intermediate',
      postPercent: 80,
      passed: true,
      postElsewhere: false,
      feedback: 'submitted',
    },
    {
      personId: 'b',
      name: '=HYPERLINK("http://example.com")',
      email: 'b@example.com',
      attendance: 'absent',
      preLevel: null,
      postPercent: null,
      passed: null,
      postElsewhere: false,
      feedback: 'pending',
    },
  ],
  totals: { listed: 2, present: 1, absent: 1, passed: 1, feedbackGiven: 1 },
};

describe('the closure summary download', () => {
  const csv = summaryCsv(summary, 'Data Centre Power, Day 1');

  it('opens as UTF-8 in Excel and has one row per participant', () => {
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.equal(csv.trim().split('\r\n').length, 3);
  });

  it('writes attendance, level, score and pass or fail', () => {
    assert.match(
      csv,
      /"Data Centre Power, Day 1",2026-11-13,Asha Rao,asha@example\.com,Present,Intermediate,80,Pass,Given/,
    );
  });

  it('dates the session by the day in India, not in UTC', () => {
    const late = summaryCsv(
      { ...summary, session: { ...summary.session, scheduledFor: '2026-11-12T20:00:00.000Z' } },
      'Late',
    );
    assert.match(late, /^Late,2026-11-13,/m);
  });

  it('neutralises a tab or carriage return at the start, and quotes a bare one', () => {
    const tricky = summaryCsv(
      { ...summary, rows: [{ ...summary.rows[0]!, name: '\t=1+1', email: 'a\rb@example.com' }] },
      'Deck',
    );
    assert.match(tricky, /,'\t=1\+1,"a\rb@example\.com",/);
  });

  it('says when a post-session result came from an earlier sitting of the deck', () => {
    const earlier = summaryCsv(
      { ...summary, rows: [{ ...summary.rows[0]!, postElsewhere: true }] },
      'Deck',
    );
    assert.match(earlier, /,80,"Pass, earlier sitting",Given/);
  });

  it('never lets a name run as a formula', () => {
    assert.match(csv, /"'=HYPERLINK\(""http:\/\/example\.com""\)"/);
  });
});
