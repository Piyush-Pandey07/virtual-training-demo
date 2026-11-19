/**
 * What a facilitator is asked before the steps on a session that cannot be taken back.
 *
 * Closing a session is final: a closed session cannot be reopened. Starting one is nearly
 * so, since a started session can no longer be cancelled and everybody marked present
 * after it starts reads as having joined late. A UAT dry run started and closed a session
 * due on 20 November on the 19th, with nothing asked at either step.
 *
 * Neither is refused, since a facilitator may genuinely run a session early. They are
 * asked, in the browser, and the words are kept here so that they can be tested and so
 * that the session page and the run screen say the same thing. Nothing here is
 * server-only: both questions are asked on the facilitator's own screen.
 */

import { formatSessionTime, hoursAhead } from '../time';
import type { TrainingSession } from './types';

/**
 * How long before its scheduled time a session may start without the facilitator being
 * asked first.
 *
 * Enough for a facilitator who starts a little ahead of time because the room is ready,
 * and nowhere near enough for a session started the day before it is due.
 */
export const EARLY_START_HOURS = 3;

/** "about 22 hours", "about 3 days": how far off a session is, for a question about it. */
function howFarOff(hours: number): string {
  // Only ever asked of more than EARLY_START_HOURS, so each is more than one.
  return hours < 48 ? `about ${Math.round(hours)} hours` : `about ${Math.round(hours / 24)} days`;
}

/**
 * The question to ask before starting a session now, or null when it is not early enough
 * to need asking: no time set, its time already come or close, or more than
 * EARLY_START_HOURS still to go.
 */
export function earlyStartQuestion(
  scheduledFor: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const ahead = hoursAhead(scheduledFor, now);
  if (!scheduledFor || ahead <= EARLY_START_HOURS) return null;
  return `Start this session now? It is scheduled for ${formatSessionTime(scheduledFor)}, ${howFarOff(ahead)} from now. Once started it cannot be cancelled, and anybody marked present from then on is shown as joined late.`;
}

/**
 * The question to ask before closing a session.
 *
 * Says plainly that closing is final, and what it opens for the participants. A session
 * closed without ever being started is recorded as held at that moment, so one closed
 * well before its time also says when it was due, as starting it early would.
 */
export function closeQuestion(
  session: Pick<TrainingSession, 'status' | 'scheduledFor'>,
  now: Date = new Date(),
): string {
  const final =
    'Close this session? A closed session cannot be reopened, and its attendance can no longer be changed. The post-session steps open for everybody marked present.';
  const ahead = session.status === 'scheduled' ? hoursAhead(session.scheduledFor, now) : 0;
  if (!session.scheduledFor || ahead <= EARLY_START_HOURS) return final;
  return `${final} It is scheduled for ${formatSessionTime(session.scheduledFor)}, ${howFarOff(ahead)} from now, and will be recorded as held now.`;
}
