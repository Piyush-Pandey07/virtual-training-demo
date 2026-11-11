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

function clock(at: Date): string {
  return at.toLocaleTimeString('en-GB', {
    timeZone: TRAINING_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
