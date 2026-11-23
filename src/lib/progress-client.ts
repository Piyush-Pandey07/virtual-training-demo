/**
 * Telling the server what has been taught.
 *
 * Client-safe and deliberately silent. A progress write that fails must never
 * surface in the session: the trainer's job is to teach, and an error banner
 * appearing mid-narration because a database hiccuped is a worse outcome for the
 * trainee than a row that did not get written.
 *
 * Losing a write is survivable by design. Every covered slide is reported on its
 * own, so one failure costs one slide rather than the session, and the server takes
 * the union of what it already had with what arrives, so a slide already recorded
 * cannot be un-recorded by a later call.
 */

export interface ProgressReport {
  deckId: string;
  kind: 'start' | 'covered' | 'end';
  slideId?: number;
}

/**
 * What the server says back about a covered slide: the share of the deck taught so far,
 * and when the session was recorded as completed, if it has been.
 */
export interface ProgressReply {
  percent?: number;
  completedAt?: string | null;
}

/**
 * Sends the report, and hands back the server's reply, or null for a write that failed.
 * The reply is only ever extra: nothing waits on it, and a null changes nothing.
 */
export async function reportProgress(report: ProgressReport): Promise<ProgressReply | null> {
  try {
    const response = await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      // The session may be closing as this goes out. keepalive lets the browser
      // finish it rather than cancelling it with the page.
      keepalive: true,
    });
    if (!response.ok) return null;
    return (await response.json()) as ProgressReply;
  } catch {
    // Deliberately nothing. See above.
    return null;
  }
}

/** How far through the session the screen believes the trainee is. */
export interface LiveStanding {
  percent: number;
  complete: boolean;
}

/**
 * The standing once a reply has arrived.
 *
 * Each covered slide is reported on its own, so replies can land out of order. The
 * server only ever adds slides and never takes a completion back, so neither figure here
 * goes backwards either: a late reply about an earlier slide cannot make the end of the
 * session say the steps after it have closed again.
 */
export function standingAfter(before: LiveStanding, reply: ProgressReply): LiveStanding {
  const percent =
    typeof reply.percent === 'number' && Number.isFinite(reply.percent)
      ? Math.max(before.percent, reply.percent)
      : before.percent;
  return { percent, complete: before.complete || Boolean(reply.completedAt) };
}
