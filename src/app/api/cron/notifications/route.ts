/**
 * GET /api/cron/notifications
 *
 * The email notifications run (AI-35): the day's digest of incomplete profiles in
 * upcoming sessions, then every notification that is due, retries and held ones alike.
 * The work is in src/lib/notifications/job.ts.
 *
 * Scheduled in `vercel.json` once a day, at 02:30 UTC (08:00 IST, give or take the hour
 * Vercel allows itself), so the digest lands before the training day starts. Once a day
 * because that is all the Hobby plan runs: an expression that runs more often fails the
 * deployment. The backoff of a minute, five, thirty, two hours and twelve is therefore
 * the earliest each retry may happen. In practice the next event's own send carries due
 * retries along with it, the administrator's "retry now" sends at once, and otherwise
 * this run picks them up the next morning. On the Pro plan, change the schedule to
 * `*\/5 * * * *` and the backoff is kept to within five minutes; nothing else changes,
 * since the digest is written once a day however often this runs.
 *
 * Secured exactly as the retention job is: Vercel sends `Authorization: Bearer
 * <CRON_SECRET>`, and anything else, including a deployment with no secret set, is a 404
 * indistinguishable from a route that does not exist.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import { cronSecret } from '@/lib/config';
import { runNotifications } from '@/lib/notifications/job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The Hobby ceiling. Sending stops itself at 35 seconds and the rest waits for the next run. */
export const maxDuration = 60;

function notFound(): Response {
  return Response.json({ error: 'Not found.' }, { status: 404 });
}

/** Compared as digests, so neither the length nor the content leaks through timing. */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

function authorised(request: Request): boolean {
  const secret = cronSecret();
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  return Boolean(match && sameSecret(match[1]!, secret));
}

export async function GET(request: Request) {
  if (!authorised(request)) return notFound();

  const report = await runNotifications();
  // In the deployment's own logs as well, so a run nobody looked at still left a trace.
  console.info(`[notifications] run: ${JSON.stringify(report)}`);
  return Response.json(report, { headers: { 'Cache-Control': 'no-store' } });
}
