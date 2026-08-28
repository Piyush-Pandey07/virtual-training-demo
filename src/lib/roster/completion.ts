/**
 * How much of a deck a trainee has actually been taught.
 *
 * Pure arithmetic, no imports, no `server-only`, so the number a trainee sees on
 * their own dashboard and the number an admin sees in a report come out of the same
 * function and cannot disagree.
 *
 * What is being counted matters more than the arithmetic. A slide counts as covered
 * only when the trainer finished narrating it: the session hook adds it after the
 * audio has finished playing and only if the turn was not cut short by a question,
 * by navigation, or by the trainee leaving. So this measures teaching delivered, not
 * slides looked at. A trainee who clicks to the last slide has covered nothing.
 */

import type { Attempt, Coverage } from './types';

/**
 * The share of a deck that has been taught, 0 to 100.
 *
 * Weighted by each slide's spoken budget rather than counting slides, because slides
 * are not equal: the hand-authored deck ranges from a forty second title card to a
 * hundred and fifty second content slide, and counting them would call a trainee who
 * sat through two short slides more than a third of the way through a session that
 * had barely started.
 *
 * Falls back to counting slides when the deck carries no seconds at all, which only
 * happens for a deck stored before pacing existed. Better a rough number than a
 * division by zero.
 */
export function percentComplete(coverage: Coverage): number {
  const { coveredSeconds, totalSeconds, coveredCount, slideCount } = coverage;

  if (totalSeconds > 0) {
    return clampPercent(Math.round((coveredSeconds / totalSeconds) * 100));
  }
  if (slideCount > 0) {
    return clampPercent(Math.round((coveredCount / slideCount) * 100));
  }
  return 0;
}

/**
 * Where a session is considered done.
 *
 * Not 100. The last slide of a deck is usually a closing card, and a trainee who has
 * heard everything that teaches anything has finished the training whether or not
 * they sat through the thank-you slide. Requiring the full hundred would leave people
 * marked incomplete for stopping at exactly the point the material ran out, and an
 * admin would then be chasing them for nothing.
 */
export const COMPLETION_THRESHOLD = 90;

export function isComplete(coverage: Coverage, threshold = COMPLETION_THRESHOLD): boolean {
  return percentComplete(coverage) >= threshold;
}

/** What an attempt adds up to. */
export function coverageOf(attempt: Attempt): Coverage {
  return {
    coveredSeconds: attempt.covered.reduce((total, slide) => total + slide.targetSeconds, 0),
    totalSeconds: attempt.totalSeconds,
    coveredCount: attempt.covered.length,
    slideCount: attempt.slideCount,
  };
}

/** Nothing attempted yet, against a deck of a known size. */
export function emptyCoverage(slideCount: number, totalSeconds: number): Coverage {
  return { coveredSeconds: 0, totalSeconds, coveredCount: 0, slideCount };
}

/**
 * Where a trainee should be put when they come back.
 *
 * The first slide that has not been taught yet, so resuming does not repeat a slide
 * they sat through and does not skip one they missed by leaving mid-narration. Falls
 * back to the slide they were last on, and then to the deck's first slide.
 */
export function resumeSlideId(attempt: Attempt | null, slideIds: number[]): number | null {
  const first = slideIds.length > 0 ? slideIds[0] : null;
  if (!attempt) return first;

  const covered = new Set(attempt.covered.map((slide) => slide.slideId));
  const uncovered = slideIds.find((id) => !covered.has(id));

  return uncovered ?? attempt.lastSlideId ?? first;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}
