import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { standingAfter } from '../progress-client';
import { howFarThrough, opensOnceCompleted } from './after-session';

/**
 * What a participant is told before the steps after an AI-led session open (UAT issue 12),
 * and how the end of the session keeps track of whether they have.
 *
 * The words are shared by the home page, the end of the session, and the post-session
 * assessment and feedback pages, so they are pinned once here rather than on each screen.
 */

describe('the steps after an AI-led session, before they open', () => {
  it('say they open once the session is completed', () => {
    assert.equal(
      opensOnceCompleted('post'),
      'The post-session assessment opens once you have completed the session.',
    );
    assert.equal(
      opensOnceCompleted('feedback'),
      'Feedback opens once you have completed the session.',
    );
  });

  it("say how far through the session somebody is, against the deck's own point", () => {
    assert.equal(
      howFarThrough(40, 90),
      'You are 40% through the session. It counts as completed once 90% of it has been taught.',
    );
    assert.equal(
      howFarThrough(0, 75),
      'You are 0% through the session. It counts as completed once 75% of it has been taught.',
    );
  });

  it('say so when the session has not been started', () => {
    assert.equal(
      howFarThrough(null, 90),
      'You have not started the session yet. It counts as completed once 90% of it has been taught.',
    );
  });

  it('do not tell somebody past a lowered point that they still have to reach it', () => {
    // Completion is recorded as a slide is taught, so a point lowered since their last
    // slide is passed but not yet recorded until the next one.
    assert.equal(
      howFarThrough(80, 75),
      'You are 80% through the session. It is recorded as completed once the next slide has been taught.',
    );
  });
});

describe('the end of an AI-led session, as the progress replies arrive', () => {
  const start = { percent: 40, complete: false };

  it('takes the percentage and the completion from each reply', () => {
    assert.deepEqual(standingAfter(start, { percent: 60, completedAt: null }), {
      percent: 60,
      complete: false,
    });
    assert.deepEqual(standingAfter(start, { percent: 92, completedAt: '2026-11-23T10:00:00Z' }), {
      percent: 92,
      complete: true,
    });
  });

  it('never goes backwards when replies land out of order', () => {
    const done = { percent: 92, complete: true };
    assert.deepEqual(standingAfter(done, { percent: 80, completedAt: null }), done);
  });

  it('keeps what it had from a reply without the figures', () => {
    assert.deepEqual(standingAfter(start, {}), start);
    assert.deepEqual(standingAfter(start, { percent: Number.NaN }), start);
  });
});
