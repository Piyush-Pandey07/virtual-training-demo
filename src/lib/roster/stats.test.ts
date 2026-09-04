import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { duration, employeeStats } from './stats';
import type { ProgressRow } from './types';

/**
 * One employee's totals.
 *
 * These are the numbers a company administrator reads to decide whether to chase
 * somebody, so the distinctions matter: assigned-and-never-opened is not the same as
 * opened-and-unfinished, and a percentage that averages deck percentages would let a
 * five-minute deck cancel out a ninety-minute one.
 */

function row(over: Partial<ProgressRow> & { deckId: string }): ProgressRow {
  return {
    personId: 'p1',
    personName: 'Person',
    personEmail: 'person@example.com',
    deckTitle: over.deckId,
    assignedAt: '2026-01-01T00:00:00.000Z',
    dueAt: null,
    startedAt: null,
    lastSeenAt: null,
    completedAt: null,
    lastSlideId: null,
    coverage: { coveredSeconds: 0, totalSeconds: 600, coveredCount: 0, slideCount: 10 },
    percent: 0,
    deckChangedSince: false,
    ...over,
  };
}

const NOW = new Date('2026-06-15T12:00:00.000Z');

describe('what an employee has done', () => {
  it('tells never-opened apart from opened-and-unfinished', () => {
    // Two untouched and one begun, deliberately unequal. An earlier version of this
    // test used one of each, which passes just as happily with the two counters
    // swapped -- the assertions could not tell the branches apart at all.
    const stats = employeeStats(
      [
        row({ deckId: 'untouched' }),
        row({ deckId: 'also-untouched' }),
        row({ deckId: 'begun', startedAt: '2026-06-01T00:00:00.000Z' }),
        row({
          deckId: 'finished',
          startedAt: '2026-05-01T00:00:00.000Z',
          completedAt: '2026-05-02T00:00:00.000Z',
        }),
      ],
      NOW,
    );

    assert.equal(stats.assigned, 4);
    assert.equal(stats.completed, 1);
    assert.equal(stats.inProgress, 1, 'a started deck was not counted as part-way');
    assert.equal(stats.notStarted, 2, 'an unopened deck was not counted as not started');
  });

  it('weights progress by how long each deck runs', () => {
    // Half of a long deck and none of a short one is not fifty per cent. Averaging the
    // two percentages would say it was, and would let somebody look nearly done while
    // the bulk of the material was untouched.
    const stats = employeeStats(
      [
        row({
          deckId: 'long',
          coverage: { coveredSeconds: 900, totalSeconds: 1800, coveredCount: 5, slideCount: 10 },
        }),
        row({
          deckId: 'short',
          coverage: { coveredSeconds: 0, totalSeconds: 200, coveredCount: 0, slideCount: 4 },
        }),
      ],
      NOW,
    );

    assert.equal(stats.percent, 45, '900 of 2000 seconds is 45%, not an average of 50 and 0');
    assert.equal(stats.slidesTaught, 5);
    assert.equal(stats.slidesAssigned, 14);
    assert.equal(stats.secondsSpent, 900);
  });

  it('counts something late only while it is still unfinished', () => {
    const stats = employeeStats(
      [
        row({ deckId: 'late', dueAt: '2026-06-01' }),
        row({
          deckId: 'late-but-done',
          dueAt: '2026-06-01',
          completedAt: '2026-06-10T00:00:00.000Z',
        }),
        row({ deckId: 'due-later', dueAt: '2026-12-01' }),
      ],
      NOW,
    );

    assert.equal(stats.overdue, 1, 'a deck already completed was still counted as overdue');
    assert.equal(stats.nextDueAt, '2026-06-01', 'the soonest outstanding due date is wrong');
  });

  it('survives a deck whose slides carry no time budget', () => {
    // A deck can be uploaded and never analysed, in which case every target is zero.
    // Dividing by that total would put NaN% on somebody's profile.
    const stats = employeeStats(
      [
        row({
          deckId: 'unanalysed',
          coverage: { coveredSeconds: 0, totalSeconds: 0, coveredCount: 0, slideCount: 0 },
        }),
      ],
      NOW,
    );

    assert.equal(stats.percent, 0);
    assert.ok(Number.isFinite(stats.percent));
  });

  it('reads 100% once everything is finished, on a deck with a real budget', () => {
    // The case that matters, and the one the first version of this test missed by
    // using a zero budget: with seconds present the old guard never ran, and a
    // trainee who had completed everything read 56%.
    //
    // A deck is complete at COMPLETION_THRESHOLD (90), not 100, because the last
    // slide is usually a closing card. So coverage is legitimately short of the full
    // budget on a finished deck, and dividing seconds would contradict the "1 of 1
    // complete" sitting right next to it.
    const stats = employeeStats(
      [
        row({
          deckId: 'a',
          completedAt: '2026-06-02T00:00:00.000Z',
          coverage: { coveredSeconds: 500, totalSeconds: 900, coveredCount: 9, slideCount: 10 },
        }),
      ],
      NOW,
    );

    assert.equal(stats.percent, 100, 'a finished deck was reported as part-way');
  });

  it('reads 100% when a finished deck carries no budget at all', () => {
    // A deck uploaded and never analysed has no seconds. Dividing by that total would
    // print NaN%, so the zero branch stays underneath the finished check.
    const stats = employeeStats(
      [
        row({
          deckId: 'a',
          completedAt: '2026-06-02T00:00:00.000Z',
          coverage: { coveredSeconds: 0, totalSeconds: 0, coveredCount: 4, slideCount: 4 },
        }),
      ],
      NOW,
    );

    assert.equal(stats.percent, 100);
  });

  it('still shows real coverage while anything is unfinished', () => {
    // The finished check must not swallow the ordinary case: one deck done and one
    // untouched is not 100%.
    const stats = employeeStats(
      [
        row({
          deckId: 'done',
          completedAt: '2026-06-02T00:00:00.000Z',
          coverage: { coveredSeconds: 900, totalSeconds: 900, coveredCount: 10, slideCount: 10 },
        }),
        row({
          deckId: 'untouched',
          coverage: { coveredSeconds: 0, totalSeconds: 900, coveredCount: 0, slideCount: 10 },
        }),
      ],
      NOW,
    );

    assert.equal(stats.percent, 50, 'a half-finished programme was reported as complete');
  });

  it('reports nothing at all for somebody with nothing assigned', () => {
    const stats = employeeStats([], NOW);
    assert.deepEqual(
      { ...stats },
      {
        assigned: 0,
        completed: 0,
        inProgress: 0,
        notStarted: 0,
        overdue: 0,
        percent: 0,
        secondsSpent: 0,
        secondsAssigned: 0,
        slidesTaught: 0,
        slidesAssigned: 0,
        lastActiveAt: null,
        nextDueAt: null,
      },
    );
  });

  it('takes the latest moment they were in any session', () => {
    const stats = employeeStats(
      [
        row({ deckId: 'a', lastSeenAt: '2026-03-01T00:00:00.000Z' }),
        row({ deckId: 'b', lastSeenAt: '2026-05-09T00:00:00.000Z' }),
        row({ deckId: 'c', lastSeenAt: null }),
      ],
      NOW,
    );

    assert.equal(stats.lastActiveAt, '2026-05-09T00:00:00.000Z');
  });
});

describe('how long something took, written out', () => {
  it('says nothing rather than zero', () => {
    assert.equal(duration(0), '—');
    assert.equal(duration(-5), '—');
  });

  it('stays in minutes below an hour and drops an empty remainder', () => {
    assert.equal(duration(45 * 60), '45 m');
    assert.equal(duration(60 * 60), '1 h');
    assert.equal(duration(80 * 60), '1 h 20 m');
  });
});
