import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readFileSync } from 'node:fs';

import { addUsage as apply, emptyUsage, monthOf, type Usage } from './types';

/**
 * Counting what a customer spends.
 *
 * The arithmetic is tested through `addUsage`, the accumulate step the store performs
 * inside its transaction, because the store is one `update` call and everything that can
 * be got wrong is in what that call computes: which fields add, which are left alone,
 * and whether two increments arriving together both land. The transaction around it is
 * Firestore's job and is not this test's to prove.
 *
 * This used to test a copy of the step written out here, because the store is
 * `server-only`. A copy can agree with itself while the real one drifts, so the step now
 * lives beside the types, and the store is checked to use it.
 */

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

  it('counts Hindi on its own line as well as in the total', () => {
    const after = apply(start(), { ttsCharacters: 900, hindiCharacters: 900 }, NOW);
    assert.equal(after.ttsCharacters, 900);
    assert.equal(after.hindiCharacters, 900);
  });

  it('starts Hindi from zero on a month recorded before Hindi existed', () => {
    // Those documents have no such field. Adding to undefined gives NaN, which would
    // then be stored, and every later addition would stay NaN for the rest of the month.
    const old: Usage = { ...start(), ttsCharacters: 5000 };
    delete old.hindiCharacters;
    const after = apply(old, { ttsCharacters: 300, hindiCharacters: 300 }, NOW);
    assert.equal(after.hindiCharacters, 300);
    assert.equal(after.ttsCharacters, 5300);
  });

  it('is the step the store really performs, not a copy of it', () => {
    const store = readFileSync('src/lib/usage/store.ts', 'utf8');
    assert.match(store, /addUsage\(current \?\? emptyUsage\(orgId, month, now\), delta, now\)/);
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
