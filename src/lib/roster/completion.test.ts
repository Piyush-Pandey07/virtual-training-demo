import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMPLETION_THRESHOLD,
  coverageOf,
  emptyCoverage,
  isComplete,
  percentComplete,
  resumeSlideId,
} from './completion';
import type { Attempt, CoveredSlide } from './types';

const AT = '2026-03-03T10:00:00.000Z';

function attempt(covered: Array<[number, number]>, overrides: Partial<Attempt> = {}): Attempt {
  const slides: CoveredSlide[] = covered.map(([slideId, targetSeconds]) => ({
    slideId,
    targetSeconds,
    coveredAt: AT,
  }));
  return {
    personId: 'p1',
    deckId: 'fire-safety',
    covered: slides,
    lastSlideId: slides.length > 0 ? slides[slides.length - 1]!.slideId : null,
    slideCount: 5,
    totalSeconds: 500,
    startedAt: AT,
    lastSeenAt: AT,
    completedAt: null,
    ...overrides,
  };
}

describe('how much of a deck has been taught', () => {
  it('is nothing before anything is covered', () => {
    assert.equal(percentComplete(emptyCoverage(5, 500)), 0);
  });

  it('is everything when the whole deck has been taught', () => {
    const covered = coverageOf(
      attempt([
        [1, 100],
        [2, 100],
        [3, 100],
        [4, 100],
        [5, 100],
      ]),
    );
    assert.equal(percentComplete(covered), 100);
  });

  it('weights by spoken budget rather than counting slides', () => {
    // Two of five slides, but they are the two long ones. Counting slides would say
    // 40%; what the trainee actually sat through is three quarters of the session.
    const deck = attempt(
      [
        [1, 150],
        [2, 150],
      ],
      { slideCount: 5, totalSeconds: 400 },
    );
    assert.equal(percentComplete(coverageOf(deck)), 75);
  });

  it('does not let a short slide count as much as a long one', () => {
    const short = coverageOf(attempt([[1, 40]], { totalSeconds: 400 }));
    const long = coverageOf(attempt([[2, 150]], { totalSeconds: 400 }));
    assert.ok(percentComplete(short) < percentComplete(long));
  });

  it('falls back to counting slides when a deck carries no pacing at all', () => {
    // Only reachable for a deck stored before pacing existed. A rough number beats a
    // division by zero.
    const covered = coverageOf(
      attempt(
        [
          [1, 0],
          [2, 0],
        ],
        { totalSeconds: 0, slideCount: 4 },
      ),
    );
    assert.equal(percentComplete(covered), 50);
  });

  it('is zero rather than NaN for a deck with no slides', () => {
    assert.equal(percentComplete(emptyCoverage(0, 0)), 0);
  });

  it('never exceeds a hundred, even if a deck shrank under an attempt', () => {
    // Re-analysis can drop slides. The attempt keeps its snapshot, but a hand-edited
    // record could still add up to more than the whole.
    const covered = coverageOf(
      attempt(
        [
          [1, 300],
          [2, 300],
        ],
        { totalSeconds: 400 },
      ),
    );
    assert.equal(percentComplete(covered), 100);
  });
});

describe('when a session counts as finished', () => {
  it('does not require the closing slide', () => {
    // The last slide of a deck is usually a thank-you card. Someone who has heard
    // everything that teaches anything has done the training.
    const covered = coverageOf(
      attempt(
        [
          [1, 100],
          [2, 150],
          [3, 150],
          [4, 90],
        ],
        { slideCount: 5, totalSeconds: 530 },
      ),
    );
    assert.ok(percentComplete(covered) < 100);
    assert.equal(isComplete(covered), true);
  });

  it('is not satisfied by half a deck', () => {
    const covered = coverageOf(attempt([[1, 250]], { totalSeconds: 500 }));
    assert.equal(isComplete(covered), false);
  });

  it('sits below a hundred, so the closing slide is never required', () => {
    assert.ok(COMPLETION_THRESHOLD < 100);
    assert.ok(COMPLETION_THRESHOLD >= 75, 'too low would call a half-attended session done');
  });
});

describe('where a trainee picks up', () => {
  const slides = [1, 2, 3, 4, 5];

  it('starts at the beginning when there is no attempt', () => {
    assert.equal(resumeSlideId(null, slides), 1);
  });

  it('goes to the first slide that has not been taught', () => {
    assert.equal(
      resumeSlideId(
        attempt([
          [1, 100],
          [2, 100],
        ]),
        slides,
      ),
      3,
    );
  });

  it('does not skip a slide missed by leaving mid-narration', () => {
    // Slide 3 was interrupted, so it never counted as covered. Resuming at 5 because
    // that is where they were standing would silently lose it.
    const partial = attempt(
      [
        [1, 100],
        [2, 100],
        [4, 100],
      ],
      { lastSlideId: 5 },
    );
    assert.equal(resumeSlideId(partial, slides), 3);
  });

  it('falls back to where they were standing once everything is covered', () => {
    const done = attempt(
      [
        [1, 100],
        [2, 100],
        [3, 100],
        [4, 100],
        [5, 100],
      ],
      { lastSlideId: 4 },
    );
    assert.equal(resumeSlideId(done, slides), 4);
  });

  it('is null for a deck with no slides rather than guessing', () => {
    assert.equal(resumeSlideId(null, []), null);
  });
});
