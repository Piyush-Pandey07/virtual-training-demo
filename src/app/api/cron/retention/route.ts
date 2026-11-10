/**
 * GET /api/cron/retention
 *
 * The daily retention job (AI-41), called by Vercel Cron once a day as `vercel.json`
 * schedules it. Restricts profiles, assessment results and feedback 90 days after the
 * participant's last session, and deletes them a year after last use. The rules and the
 * reasoning are in src/lib/retention/.
 *
 * Nobody signs in to call this. Vercel sends `Authorization: Bearer <CRON_SECRET>`, and
 * anything else, a missing header, a wrong secret or a deployment with no secret set, is
 * a 404 indistinguishable from a route that does not exist.
 *
 * `?dryRun=1` reports what the job would do and changes nothing, for UAT. With it,
 * `&asOf=YYYY-MM-DD` judges the policy as of that day instead of today, so the effect on
 * a participant months from now can be seen today. A real run is always as of now: a
 * date that could be moved forward from outside would be a way to delete records early.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import { cronSecret } from '@/lib/config';
import { runRetention } from '@/lib/retention/job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The Hobby ceiling. The job stops itself at 45 seconds and resumes the next day. */
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

function flag(value: string | null): boolean {
  return value === '1' || value === 'true';
}

export async function GET(request: Request) {
  if (!authorised(request)) return notFound();

  const url = new URL(request.url);
  const dryRun = flag(url.searchParams.get('dryRun'));
  const asOfParam = url.searchParams.get('asOf');

  let asOf: Date | undefined;
  if (asOfParam) {
    if (!dryRun) {
      return Response.json({ error: 'asOf is for a dry run only.' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfParam) || Number.isNaN(Date.parse(asOfParam))) {
      return Response.json({ error: 'asOf must be a date, as YYYY-MM-DD.' }, { status: 400 });
    }
    asOf = new Date(`${asOfParam}T00:00:00Z`);
  }

  const report = await runRetention({ dryRun, asOf });
  // In the deployment's own logs as well, so a run nobody looked at still left a trace.
  console.info(
    `[retention] ${dryRun ? 'dry run' : 'run'} as of ${report.asOf}: ${JSON.stringify(report.totals)}, ${report.complete ? 'complete' : `resumes from ${report.resumeFrom}`}`,
  );
  return Response.json(report, { headers: { 'Cache-Control': 'no-store' } });
}
