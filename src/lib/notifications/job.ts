/**
 * The notifications run (AI-35), called by Vercel Cron through GET /api/cron/notifications.
 *
 * Writes the day's digests of incomplete profiles in upcoming sessions, then sends
 * everything due: retries whose backoff has passed, and anything held for want of a key
 * once a key is set. While no key is set it says so in the developer log, once a run, so
 * the administrator's banner (AI-11) shows email is not going out for as long as that
 * lasts. Last, it deletes notifications past their 30 days.
 *
 * Idempotent: a digest is written once a day per customer whatever the number of runs,
 * a notification is claimed before it is sent, and a sent one is never sent again.
 */

import 'server-only';

import { recordFailure } from '../failures/devlog';
import { writeUpcomingDigests, type EventOptions } from './events';
import {
  configuredProvider,
  heldCount,
  pruneOld,
  sendDue,
  HELD_REASON,
  type DueReport,
} from './outbox';

export interface NotificationRunReport extends DueReport {
  /** Whether a provider is configured, so anything was sent at all. */
  configured: boolean;
  digests: number;
  /** Held for want of a key, after the run. */
  stillHeld: number;
  pruned: number;
}

/** Stops well inside the route's 60 seconds, leaving room for the digests and the prune. */
const SEND_BUDGET_MS = 35_000;

export async function runNotifications(
  options: EventOptions & { orgIds?: string[] } = {},
): Promise<NotificationRunReport> {
  const provider = options.provider === undefined ? configuredProvider() : options.provider;
  const run = { ...options, provider };

  const digests = await writeUpcomingDigests(run);
  const due = await sendDue({ ...run, budgetMs: SEND_BUDGET_MS });
  const stillHeld = provider ? 0 : await heldCount(run);
  if (!provider && stillHeld > 0) {
    await recordFailure(
      {
        source: 'server',
        provider: 'resend',
        kind: 'not_configured',
        code: 'unavailable',
        detail: `${HELD_REASON} ${stillHeld} ${stillHeld === 1 ? 'notification is' : 'notifications are'} held until it is.`,
        route: 'notifications',
      },
      { immediate: true },
    );
  }
  const pruned = await pruneOld(run).catch(() => 0);

  return { ...due, configured: Boolean(provider), digests, stillHeld, pruned };
}
