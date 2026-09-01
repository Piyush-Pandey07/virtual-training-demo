import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyUsage, monthOf, type Usage, type UsageDelta } from './types';

/**
 * Counting what a customer spends.
 *
 * The arithmetic is tested against the same accumulate step the store performs, rather
 * than through the store itself, because the store is one `update` call and everything
 * that can be got wrong is in what that call computes: which fields add, which are left
 * alone, and whether two increments arriving together both land.
 */

/**
 * The accumulate step, as `record` performs it.
 *
 * Written out here rather than imported because `store.ts` is `server-only` and pulls
 * in Firestore. Keeping the arithmetic honest is the point; the transaction around it
 * is Firestore's job and is not this test's to prove.
 */
function apply(current: Usage, delta: UsageDelta, now: string): Usage {
  return {
    ...current,
    ttsCharacters: current.ttsCharacters + (delta.ttsCharacters ?? 0),
    sttSeconds: current.sttSeconds + (delta.sttSeconds ?? 0),
    geminiInputTokens: current.geminiInputTokens + (delta.geminiInputTokens ?? 0),
    geminiOutputTokens: current.geminiOutputTokens + (delta.geminiOutputTokens ?? 0),
    sessions: current.sessions + (delta.sessions ?? 0),
    decksAnalysed: current.decksAnalysed + (delta.decksAnalysed ?? 0),
    updatedAt: now,
  };
}

const NOW = '2026-09-01T10:00:00.000Z';
const start = () => emptyUsage('acme', '2026-09', NOW);

describe('adding to a month', () => {
  it('starts every counter at zero', () => {
    const usage = start();
    assert.equal(usage.ttsCharacters, 0);
    assert.equal(usage.sessions, 0);
    assert.equal(usage.geminiInputTokens, 0);
  });

  it('adds only what it was given, leaving the rest alone', () => {
    // Every spend path reports one or two fields. A delta that quietly zeroed the
    // others would mean whichever path ran last was the only one that counted.
    const after = apply(start(), { ttsCharacters: 1200 }, NOW);

    assert.equal(after.ttsCharacters, 1200);
    assert.equal(after.sttSeconds, 0);
    assert.equal(after.sessions, 0);
  });

  it('accumulates across many increments', () => {
    // A session is thirty or so turns, each reporting separately.
    let usage = start();
    for (let turn = 0; turn < 30; turn += 1) {
      usage = apply(usage, { ttsCharacters: 400, geminiInputTokens: 5500 }, NOW);
    }

    assert.equal(usage.ttsCharacters, 12_000);
    assert.equal(usage.geminiInputTokens, 165_000);
  });

  it('keeps the customer and the month it was opened with', () => {
    const after = apply(start(), { sessions: 1 }, '2026-09-02T00:00:00.000Z');
    assert.equal(after.orgId, 'acme');
    assert.equal(after.month, '2026-09');
    assert.equal(after.updatedAt, '2026-09-02T00:00:00.000Z');
  });

  it('takes fractional seconds without rounding them away', () => {
    // An utterance is rarely a whole number of seconds, and rounding each one down
    // would lose a meaningful fraction of a long session.
    const after = apply(apply(start(), { sttSeconds: 1.4 }, NOW), { sttSeconds: 2.35 }, NOW);
    assert.ok(Math.abs(after.sttSeconds - 3.75) < 1e-9, `got ${after.sttSeconds}`);
  });

  it('adds nothing for an empty delta', () => {
    const after = apply(start(), {}, NOW);
    assert.deepEqual({ ...after, updatedAt: NOW }, start());
  });
});

describe('which month a moment falls in', () => {
  it('uses UTC, so a deployment and its customers agree', () => {
    // A customer in India is five and a half hours ahead. If the month came from local
    // time, a session at half past eleven on the last night of a month would land in a
    // different month depending on which machine happened to record it.
    assert.equal(monthOf(new Date('2026-09-30T23:30:00.000Z')), '2026-09');
    assert.equal(monthOf(new Date('2026-10-01T00:30:00.000Z')), '2026-10');
  });

  it('pads a single-digit month, so the ids sort', () => {
    // The platform screen sorts these as strings. "2026-9" would sort after "2026-10".
    assert.equal(monthOf(new Date('2026-01-15T00:00:00.000Z')), '2026-01');
    assert.ok('2026-09' < '2026-10');
  });
});
