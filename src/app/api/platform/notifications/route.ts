/**
 * GET, POST /api/platform/notifications
 *
 * The email outbox (AI-35), for Technavious administrators only. GET lists this month's
 * and last month's notifications with their status, tries and last error, without their
 * bodies. POST `{ id }` is "retry now": it tries a held, waiting or failed notification
 * at once and answers with what happened.
 *
 * A 404 for anybody else, as the developer log is, so a customer's administrator cannot
 * learn it exists. The outbox is Technavious's own mail about every customer, so it is
 * not scoped to the customer the administrator happens to be looking at.
 */

import { checkAdministrator } from '@/lib/auth/guard';
import { resendApiKey } from '@/lib/config';
import { recentNotifications, retryNow, summaryOf } from '@/lib/notifications/outbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** The outbox's ids are a hash, so anything else is not one and is not looked up. */
const NOTIFICATION_ID = /^n-[0-9a-f]{32}$/;

export async function GET() {
  const gate = await checkAdministrator();
  if (!gate.ok) return gate.response;
  const records = await recentNotifications();
  return Response.json(
    { configured: Boolean(resendApiKey()), notifications: records.map(summaryOf) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const gate = await checkAdministrator();
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!NOTIFICATION_ID.test(id)) {
    return Response.json({ error: 'Name a notification by its id.' }, { status: 400 });
  }

  const result = await retryNow(id);
  if (!result?.record) return Response.json({ error: 'No such notification.' }, { status: 404 });
  return Response.json({ outcome: result.outcome, notification: summaryOf(result.record) });
}
