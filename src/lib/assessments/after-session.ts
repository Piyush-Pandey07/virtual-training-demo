/**
 * What a participant is told about the steps after an AI-led session while they are
 * still closed.
 *
 * The post-session assessment and feedback open once the session is completed, at the
 * deck's own completion point (AI-34), which is how `hasAttended` decides it. They used to
 * open as soon as the session was started, which a UAT run found (UAT issue 12). Every
 * screen that shows or links them says the same thing in the same words, with how far
 * through the session the participant is, so the home page, the end of the session and
 * the steps' own pages never disagree.
 *
 * Free of imports, so the session screen in the browser and the pages on the server
 * share it.
 */

/** The steps that follow a session, in the order they come. */
export type StepAfterSession = 'post' | 'feedback';

const STEP_NAMES: Record<StepAfterSession, string> = {
  post: 'The post-session assessment',
  feedback: 'Feedback',
};

/** "The post-session assessment opens once you have completed the session." */
export function opensOnceCompleted(step: StepAfterSession): string {
  return `${STEP_NAMES[step]} opens once you have completed the session.`;
}

/**
 * How far through the session somebody is, against the point where it counts as
 * completed. `percent` is null before they have started it.
 *
 * At or past the point without being recorded as completed happens only when the deck's
 * point was lowered after their last slide was taught. Completion is recorded as a slide
 * is taught, so the next one records it, and saying the point has been passed without
 * saying that would leave them wondering why nothing opened.
 */
export function howFarThrough(percent: number | null, completeAt: number): string {
  const point = `It counts as completed once ${completeAt}% of it has been taught.`;
  if (percent === null) return `You have not started the session yet. ${point}`;
  if (percent >= completeAt) {
    return `You are ${percent}% through the session. It is recorded as completed once the next slide has been taught.`;
  }
  return `You are ${percent}% through the session. ${point}`;
}
