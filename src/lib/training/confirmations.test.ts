import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { closeQuestion, EARLY_START_HOURS, earlyStartQuestion } from './confirmations';

/**
 * What a facilitator is asked before starting or closing a session, neither of which can
 * be undone. A UAT dry run started and closed a session due on 20 November on the 19th,
 * and closed it with one click, nothing asked.
 */

/** 10:00 on Friday 20 November in India. */
const SESSION = '2026-11-20T04:30:00.000Z';
/** Noon the day before, in India: 22 hours ahead of it. */
const DAY_BEFORE = new Date('2026-11-19T06:30:00.000Z');

const FINAL =
  'Close this session? A closed session cannot be reopened, and its attendance can no longer be changed. The post-session steps open for everybody marked present.';

describe('starting a session early', () => {
  it('asks the day before, naming the time in India and how far off it is', () => {
    assert.equal(
      earlyStartQuestion(SESSION, DAY_BEFORE),
      'Start this session now? It is scheduled for Fri 20 Nov, 10:00 IST, about 22 hours from now. Once started it cannot be cancelled, and anybody marked present from then on is shown as joined late.',
    );
  });

  it('gives days for a session further off', () => {
    assert.match(
      earlyStartQuestion(SESSION, new Date('2026-11-17T04:30:00.000Z')) ?? '',
      /scheduled for Fri 20 Nov, 10:00 IST, about 3 days from now\./,
    );
  });

  it(`asks only more than ${EARLY_START_HOURS} hours ahead`, () => {
    // 06:50 on the day, three hours and ten minutes ahead.
    assert.match(
      earlyStartQuestion(SESSION, new Date('2026-11-20T01:20:00.000Z')) ?? '',
      /about 3 hours from now/,
    );
    // 07:00, exactly three hours ahead, and 09:30, half an hour ahead.
    assert.equal(earlyStartQuestion(SESSION, new Date('2026-11-20T01:30:00.000Z')), null);
    assert.equal(earlyStartQuestion(SESSION, new Date('2026-11-20T04:00:00.000Z')), null);
  });

  it('asks nothing on time, late, or with no time set', () => {
    assert.equal(earlyStartQuestion(SESSION, new Date(SESSION)), null);
    assert.equal(earlyStartQuestion(SESSION, new Date('2026-11-20T08:00:00.000Z')), null);
    assert.equal(earlyStartQuestion(null, DAY_BEFORE), null);
    assert.equal(earlyStartQuestion('not a date', DAY_BEFORE), null);
  });
});

describe('closing a session', () => {
  it('says that it cannot be reopened, and that the post-session steps open', () => {
    assert.equal(
      closeQuestion({ status: 'open', scheduledFor: SESSION }, new Date(SESSION)),
      FINAL,
    );
    assert.equal(closeQuestion({ status: 'scheduled', scheduledFor: null }, DAY_BEFORE), FINAL);
  });

  it('says when one never started is due, if that is well ahead, since it is held now', () => {
    assert.equal(
      closeQuestion({ status: 'scheduled', scheduledFor: SESSION }, DAY_BEFORE),
      `${FINAL} It is scheduled for Fri 20 Nov, 10:00 IST, about 22 hours from now, and will be recorded as held now.`,
    );
    // Within a few hours of its time, as for starting it, nothing more is said.
    assert.equal(
      closeQuestion(
        { status: 'scheduled', scheduledFor: SESSION },
        new Date('2026-11-20T03:00:00.000Z'),
      ),
      FINAL,
    );
  });

  it('says nothing more of one already started early, which was asked about then', () => {
    assert.equal(closeQuestion({ status: 'open', scheduledFor: SESSION }, DAY_BEFORE), FINAL);
  });
});
