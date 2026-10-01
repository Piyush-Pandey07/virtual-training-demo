/**
 * Live speech-to-text, as reported by the browser that sent it.
 *
 * The live transport is a socket straight from the browser to Deepgram, so the audio
 * never reaches this server and cannot be measured here the way the batch path's is.
 * The browser counts the samples it sent and reports seconds. That makes this an
 * estimate the client could under-report, and the reason it is bounded rather than
 * trusted: the exact figure lives only in Deepgram's own usage records.
 */

/**
 * The most one report may claim.
 *
 * Reports arrive every minute while the socket is open and once more when it closes.
 * A hidden tab can have its timers held back to roughly once a minute while the
 * microphone carries on, so five minutes leaves room for that without letting a single
 * request claim an hour.
 */
export const MAX_STREAM_REPORT_SECONDS = 300;

/**
 * The seconds to record for one report, or 0 if it should record nothing.
 *
 * Anything that is not a positive finite number records nothing. A claim above the
 * ceiling is held to it rather than refused, so a late report still counts and a wild
 * one cannot run away.
 */
export function streamedSeconds(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0;
  const bounded = Math.min(raw, MAX_STREAM_REPORT_SECONDS);
  // Millisecond precision, which is finer than anything billed and keeps the stored
  // total from accumulating float noise.
  return Math.round(bounded * 1000) / 1000;
}
