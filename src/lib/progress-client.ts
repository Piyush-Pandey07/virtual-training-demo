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
 * the union of what it already had with what arrives — a slide already recorded
 * cannot be un-recorded by a later call.
 */

export interface ProgressReport {
  deckId: string;
  kind: 'start' | 'covered' | 'end';
  slideId?: number;
}

export async function reportProgress(report: ProgressReport): Promise<void> {
  try {
    await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      // The session may be closing as this goes out. keepalive lets the browser
      // finish it rather than cancelling it with the page.
      keepalive: true,
    });
  } catch {
    // Deliberately nothing. See above.
  }
}
