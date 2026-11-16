/**
 * The HTTP status /api/health answers with (AI-56).
 *
 * The body says everything in detail, but an uptime monitor reads the status code and
 * nothing else. It always used to be 200, so a deployment with the database down looked
 * healthy to anything polling it, which is the one thing a monitor is for.
 *
 * Kept apart from the route so it can be tested without one, and so the route file
 * exports only what Next.js expects of it.
 */

import type { FirebaseProbe } from '../firebase/admin';

export interface HealthVerdict {
  ready: boolean;
  /** Null where Firebase is not configured, as on a developer machine. */
  firebase: FirebaseProbe | null;
}

/**
 * 503 when the deployment cannot do its job, 200 otherwise.
 *
 * - Not `ready`: a variable the app needs is missing, so no session can start.
 * - The database probe failed or timed out: every page that reads a deck, a person or
 *   progress fails with it.
 * - The sign-in probe failed: counted as down as well. Sessions are verified against it
 *   on every request, and a failure there reads as "nobody is signed in", so from the
 *   outside the site refuses everybody while looking up. That is exactly the outage this
 *   was asked to catch, and it is not one that a page load would reveal to a monitor.
 *
 * Firebase not being configured at all is not a failure here. `ready` decides whether a
 * deployment without it is complete, and a developer machine without it is normal.
 */
export function healthStatus({ ready, firebase }: HealthVerdict): 200 | 503 {
  if (!ready) return 503;
  if (firebase && (!firebase.firestore.ok || !firebase.auth.ok)) return 503;
  return 200;
}
