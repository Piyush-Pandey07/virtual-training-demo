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

/**
 * "23:49:05 IST": the time of day alone, to the second, for a record listed under its day.
 *
 * The audit history and the developer log show one entry a line with its day beside it,
 * and their times were cut out of the ISO string, which is UTC, with nothing on the line to
 * say so (UAT issue 20). To the second because two entries a few seconds apart are often
 * the point of reading a log at all. Nothing for a value that is not a date.
 */
export function formatTimeOfDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const time = at.toLocaleTimeString('en-GB', {
    timeZone: TRAINING_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return `${time} ${ZONE_LABEL}`;
}

/** Today in India, as `YYYY-MM-DD`, which is the day the pages read by default. */
export function todayInTrainingZone(now: Date = new Date()): string {
  return dayInTrainingZone(now.toISOString());
}

/**
 * A `YYYY-MM-DD` day moved by some whole days, for the Previous day and Next day links.
 *
 * Counting on the calendar alone, so it has no zone to name: the day after 31 October is
 * 1 November wherever one is standing, and India keeps no summer time to skip an hour.
 */
export function shiftDay(day: string, by: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
}

/**
 * The UTC days a day in India overlaps, earliest first, for reading records filed under
 * their UTC day, as the audit history and the developer log are.
 *
 * India is five and a half hours ahead of UTC all year, so its day runs from 18:30 UTC the
 * evening before to 18:30 UTC on the day itself: part of each of two UTC days. The reader
 * asks for both and keeps the entries whose own day in India is the one asked for. Filed
 * entries are left as they are, so the history written before this reads the same way.
 */
export function utcDaysOverlapping(day: string): string[] {
  return [shiftDay(day, -1), day];
}

/**
 * The same for a month in India: the UTC month itself, and the last UTC day before it,
 * whose final five and a half hours are the first of this month in India. The last five and
 * a half hours of the UTC month belong to the next month in India, so the reader drops them.
 */
export function utcFilingOfMonth(month: string): { month: string; dayBefore: string } {
  return { month, dayBefore: shiftDay(`${month}-01`, -1) };
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

/**
 * How many hours from now a moment is: 0 once it has come, and for no time or one that
 * cannot be read.
 *
 * Asked of a session's scheduled time, to tell a session started a little ahead of time
 * from one started the day before (see training/confirmations.ts). It is the difference
 * between two moments, which is the same in every zone, so unlike the rest of this file
 * it has no zone to name.
 */
export function hoursAhead(iso: string | null | undefined, now: Date = new Date()): number {
  if (!iso) return 0;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return 0;
  return Math.max(0, (at - now.getTime()) / 3_600_000);
}

/**
 * The moment a "date and time" box names, read as India time whatever zone the browser
 * is in, or undefined for an empty or unreadable value.
 *
 * The box gives a wall-clock time with no zone, "2026-11-20T10:00". Handed to `Date` as
 * it is, it is read in the browser's own zone, so an administrator in Dubai setting a
 * session for 10:00 scheduled it for 11:30 IST and then saw 11:30 on every screen. India
 * keeps one offset all year, so the offset is written out and no zone database is needed.
 */
export function momentFromTrainingZoneInput(local: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?/.exec(local.trim());
  if (!match) return undefined;
  const at = new Date(`${match[1]}T${match[2]}:${match[3] ?? '00'}+05:30`);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

function clock(at: Date): string {
  return at.toLocaleTimeString('en-GB', {
    timeZone: TRAINING_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
