/**
 * What the end of an AI-led session says when it ended short of completion (UAT issue 13).
 *
 * The end of a session reads "Session complete" once the deck counts as complete and
 * "Session ended" otherwise, and the steps after it wait for completion (UAT issue 12).
 * Stop part way through used to read "Session complete. You covered 4 of 12 slides", with
 * the post-session assessment offered beneath it. Beyond not saying "complete", somebody
 * who stopped needs to be told that they stopped, how far through they are, that nothing
 * taught is lost, and how to carry on, whether or not a step is waiting for them.
 *
 * Free of anything but words, so it can be tested without a browser.
 */

import {
  howFarThrough,
  opensOnceCompleted,
  type StepAfterSession,
} from './assessments/after-session';
import { TRAINER_NAME } from './trainer';

/** How the session ended: the trainer wrapped up after the last slide, or Stop was pressed. */
export type SessionEnding = 'wrapped-up' | 'stopped';

export interface ShortOfCompletion {
  endedBy: SessionEnding;
  /** The step after the session still to do, which opens only on completion, if any. */
  step: StepAfterSession | null;
  /** How far through the deck the server last said this person is, 0 to 100. */
  percent: number;
  /** The deck's completion point. See `completionPercentOf`. */
  completeAt: number;
  /** Slides taught, over every sitting. */
  taught: number;
}

/**
 * The sentences beneath "Session ended", in order: that they stopped, when they did; the
 * step that is waiting, if one is; how far through they are; and how to carry on.
 *
 * The middle two are the words every other screen uses for the same thing, from
 * after-session.ts. "Progress is saved" is said only once something has been taught: a
 * session stopped on its first slide has nothing to save, and is simply started again.
 */
export function shortOfCompletion(facts: ShortOfCompletion): string[] {
  return [
    ...(facts.endedBy === 'stopped' ? ['You stopped the session part way through.'] : []),
    ...(facts.step ? [opensOnceCompleted(facts.step)] : []),
    howFarThrough(facts.percent, facts.completeAt),
    facts.taught > 0
      ? `Your progress is saved. Resume from the home page, or from this page, and ${TRAINER_NAME} picks up at the first slide you have not heard.`
      : 'Start again from the home page, or from this page, whenever you are ready.',
  ];
}
