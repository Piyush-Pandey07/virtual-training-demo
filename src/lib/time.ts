/**
 * Times for people, in one time zone.
 *
 * Trainer-led sessions happen in a room at a time of day, so the time has to read the
 * same wherever it is shown. Formatted without a zone, a server component prints UTC
 * (which is what the servers run on, five and a half hours behind India) and a client
 * component prints the browser's zone, so a 10:00 session read as 04:30 on the
 * participant's home and as 10:00 on the administrator's board. Everything here names
 * the zone and says which it is, and gives the same text on the server and the browser.
 *
 * India time, because that is where Technavious and its customers in this release run
 * their sessions. A customer elsewhere would need a zone of its own, set per customer.
 *
 * A day on its own is held to the same rule (D-04). Formatted without a zone it has the
 * fault a time has, only harder to notice: it is right for most of the day and a day out
 * for the five and a half hours after midnight in India, while the servers are still on
 * the day before. A deck approved early on 19 November read "19 Nov" in the heading the
 * browser drew and "18 Nov" in the sentence the server wrote beneath it. A day carries
 * no "IST" after it, because it has no time of day for the label to explain.
 */

export const TRAINING_TIME_ZONE = 'Asia/Kolkata';
const ZONE_LABEL = 'IST';

/** "Thu 13 Nov, 10:00 IST": a session's time, short enough for a card. */
export function formatSessionTime(iso: string): string {
  const at = new Date(iso);
  const date = at.toLocaleDateString('en-GB', {
    timeZone: TRAINING_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `${date}, ${clock(at)} ${ZONE_LABEL}`;
}

/** "13 November 2026, 23:49 IST": when something happened, for a record. */
export function formatMoment(iso: string): string {
  const at = new Date(iso);
  const date = at.toLocaleDateString('en-GB', {
    timeZone: TRAINING_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `${date}, ${clock(at)} ${ZONE_LABEL}`;
}

/** The calendar day in India, as `YYYY-MM-DD`, for a download that sorts by date. */
export function dayInTrainingZone(iso: string): string {
  // en-CA writes dates year first, as ISO 8601 does.
  return new Date(iso).toLocaleDateString('en-CA', {
    timeZone: TRAINING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** "19 Nov 2026": the day something happened, short enough for a row in a list. */
export function formatDay(iso: string): string {
  return dayText(iso, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "19 November 2026": the day written out, for a sentence somebody may quote. */
export function formatDayLong(iso: string): string {
  return dayText(iso, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "19 Nov": the day without its year, for a row on a page about one run of training. */
export function formatDayShort(iso: string): string {
  return dayText(iso, { day: 'numeric', month: 'short' });
}

/**
 * Whether a day is over in India, which is when something due on it becomes late.
 *
 * A due date is a day with no time on it. Read as a moment it is midnight UTC, half past
 * five that morning in India, so set against the clock a deck due on the 20th turned
 * late at breakfast on the 20th. Set day against day, it is late from the 21st.
 */
export function dayHasPassed(iso: string, now: Date = new Date()): boolean {
  if (Number.isNaN(new Date(iso).getTime())) return false;
  return dayInTrainingZone(iso) < dayInTrainingZone(now.toISOString());
}

/**
 * One day as text, or nothing for a value that is not a date.
 *
 * Nothing rather than the words "Invalid Date", so each caller can say what suits its
 * own sentence in that place: "unknown", "never", or nothing at all.
 *
 * A date stored with no time, as a due date is, reads as midnight UTC. India is ahead of
 * UTC, so that is still the day that was typed. A zone behind UTC would need such a date
 * read as the day it names rather than as a moment.
 */
function dayText(iso: string, parts: Intl.DateTimeFormatOptions): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString('en-GB', { ...parts, timeZone: TRAINING_TIME_ZONE });
}

function clock(at: Date): string {
  return at.toLocaleTimeString('en-GB', {
    timeZone: TRAINING_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
