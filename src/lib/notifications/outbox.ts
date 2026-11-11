/**
 * The outbox: every email notification, written before it is sent (AI-35).
 *
 * "Log failed notification sends and retry them" is the product owner's update, and it
 * needs the notification to exist somewhere other than the request that caused it. So an
 * event writes a record here first, then a send is tried once after the response, and
 * anything that failed for a reason that may clear is tried again later on a backoff, by
 * the cron route and by the next event's send. Every failure goes to the developer log,
 * where the administrator's banner (AI-11) picks up the ones that need a person.
 *
 * One Firestore collection for the whole platform, outside every customer's prefix, as
 * the developer log is, and for the same reasons. The emails are Technavious's own
 * operational mail to Technavious's own inbox, not the customer's data, and they are read
 * by Technavious only. The retry run has to find what is due across every customer, and
 * the document port has no query across customers' prefixes, so a per-customer outbox
 * would mean listing every customer on every run to find, usually, nothing. Each record
 * carries the customer it is about, and deleting a customer deletes their records
 * (`forgetNotificationsOf`), because a digest names their participants.
 *
 * The same event never emails twice. A record's id is a hash of its dedupe key, which
 * names the event (the session's id, say), and writing one that already exists changes
 * nothing. Sending claims the record atomically first, so the send after the event and a
 * cron run that arrive together cannot both send it, and Resend is given the record's id
 * as the idempotency key, so a retry of a send whose answer was lost is not sent twice
 * either, within the 24 hours Resend remembers a key.
 *
 * Kept 30 days, which is ample to see what was sent and long past the last retry. Each
 * record carries `expireAt` for a Firestore TTL policy, and the daily run deletes old
 * ones itself as well, since a digest names people.
 */

import 'server-only';

import { createHash } from 'node:crypto';
import { after } from 'next/server';

import { notifyFrom, notifyTo, resendApiKey } from '../config';
import { recordFailure } from '../failures/devlog';
import { firestoreDocuments } from '../firebase/firestore';
import { orgsConfigured } from '../orgs/registry';
import { InMemoryDocumentStore, type DocumentStore } from '../roster/documents';
import { resendProvider, type EmailProvider } from './provider';
import type {
  NotificationKind,
  NotificationRecord,
  NotificationStatus,
  NotificationSummary,
} from './types';

export const NOTIFICATIONS = 'notifications';

export const NOTIFICATION_RETENTION_DAYS = 30;

/**
 * How long to wait after each failed try before the next: after the first, a minute;
 * after the fifth, twelve hours. A sixth failure is final. Each is the earliest the next
 * try may happen, not a promise it will: see `RETRY_SCHEDULE` in the cron route.
 */
export const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  12 * 3_600_000,
] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** How long a claim lasts. Longer than a send's own timeout, so it never lapses mid-send. */
const CLAIM_MS = 2 * 60_000;

export const HELD_REASON = 'RESEND_API_KEY is not set, so nothing was sent.';

const fallback = new InMemoryDocumentStore();

export interface OutboxOptions {
  /** The document store underneath. For the tests. */
  store?: DocumentStore;
  /** The provider to send with, or null for none. Defaults to Resend when a key is set. */
  provider?: EmailProvider | null;
  now?: () => number;
}

function documents(options: OutboxOptions): DocumentStore {
  return options.store ?? (orgsConfigured() ? firestoreDocuments() : fallback);
}

function clock(options: OutboxOptions): number {
  return (options.now ?? Date.now)();
}

/** Resend when a key is set, and nothing otherwise. Read per call, so a new key needs no restart. */
export function configuredProvider(): EmailProvider | null {
  const key = resendApiKey();
  return key ? resendProvider(key) : null;
}

function providerFor(options: OutboxOptions): EmailProvider | null {
  return options.provider === undefined ? configuredProvider() : options.provider;
}

export function notificationIdFor(dedupeKey: string): string {
  return `n-${createHash('sha256').update(dedupeKey).digest('hex').slice(0, 32)}`;
}

/** Everything but the body and the TTL date, for the page's API. */
export function summaryOf(record: NotificationRecord): NotificationSummary {
  const summary: Partial<NotificationRecord> = { ...record };
  delete summary.text;
  delete summary.html;
  delete summary.expireAt;
  return summary as NotificationSummary;
}

// ----------------------------------------------------------------------- writing

export interface NotificationInput {
  kind: NotificationKind;
  dedupeKey: string;
  orgId?: string;
  subject: string;
  text: string;
  html: string;
}

export interface Enqueued {
  record: NotificationRecord;
  /** False when the same event had already been written, which then changes nothing. */
  created: boolean;
}

/**
 * Writes a notification unless the same event already has one.
 *
 * Held from the start when no provider is configured, so the page says so at once
 * rather than after a try that was never going to happen.
 */
export async function enqueue(
  input: NotificationInput,
  options: OutboxOptions = {},
): Promise<Enqueued> {
  const now = clock(options);
  const iso = new Date(now).toISOString();
  const held = providerFor(options) === null;
  const fresh: NotificationRecord = {
    id: notificationIdFor(input.dedupeKey),
    dedupeKey: input.dedupeKey,
    kind: input.kind,
    ...(input.orgId ? { orgId: input.orgId } : {}),
    to: notifyTo(),
    subject: input.subject.slice(0, 200),
    text: input.text,
    html: input.html,
    createdAt: iso,
    month: iso.slice(0, 7),
    status: held ? 'held' : 'pending',
    attempts: 0,
    lastError: held ? HELD_REASON : null,
    lastAttemptAt: null,
    nextAttemptAt: held ? null : iso,
    claimedUntil: null,
    sentAt: null,
    providerId: null,
    expireAt: new Date(now + NOTIFICATION_RETENTION_DAYS * 86_400_000),
  };

  // The change may run more than once when writers collide, so whether this call
  // created the record is read from the run that committed, which is the last.
  let created = false;
  const record = await documents(options).update<NotificationRecord>(
    NOTIFICATIONS,
    fresh.id,
    (current) => {
      created = !current;
      return current ?? fresh;
    },
  );
  return { record, created };
}

// ----------------------------------------------------------------------- sending

export type AttemptResult =
  | { outcome: 'sent' | 'retrying' | 'failed' | 'held'; record: NotificationRecord }
  | { outcome: 'skipped'; record: NotificationRecord | undefined };

class NotClaimable extends Error {
  constructor(readonly record: NotificationRecord | undefined) {
    super('Not claimable.');
  }
}

/** Whether a record may be tried now: by its status, and nobody else already sending it. */
function claimable(
  record: NotificationRecord,
  now: number,
  statuses: readonly NotificationStatus[],
): boolean {
  if (!statuses.includes(record.status)) return false;
  return !record.claimedUntil || Date.parse(record.claimedUntil) <= now;
}

/**
 * Tries to send one notification, once, and records what happened.
 *
 * Claims it first, so two servers cannot send it at the same time. `statuses` is which
 * records may be tried: pending and held normally, and a failed one too when an
 * administrator asks.
 */
export async function attempt(
  id: string,
  options: OutboxOptions & { statuses?: readonly NotificationStatus[] } = {},
): Promise<AttemptResult> {
  const docs = documents(options);
  const statuses = options.statuses ?? ['pending', 'held'];
  const now = clock(options);

  let before: NotificationRecord;
  try {
    before = await docs.update<NotificationRecord>(NOTIFICATIONS, id, (current) => {
      if (!current || !claimable(current, now, statuses)) throw new NotClaimable(current);
      return { ...current, claimedUntil: new Date(now + CLAIM_MS).toISOString() };
    });
  } catch (error) {
    // Thrown rather than returned unchanged, so nothing is written for a record that is
    // missing, already settled, or being sent by somebody else.
    if (error instanceof NotClaimable) return { outcome: 'skipped', record: error.record };
    throw error;
  }

  const provider = providerFor(options);
  if (!provider) {
    const record = await settle(docs, id, (current) => ({
      ...current,
      status: 'held',
      lastError: HELD_REASON,
      nextAttemptAt: null,
    }));
    return { outcome: 'held', record };
  }

  const result = await provider.send({
    from: notifyFrom(),
    to: before.to,
    subject: before.subject,
    text: before.text,
    html: before.html,
    idempotencyKey: before.id,
  });
  const at = clock(options);
  const attemptedAt = new Date(at).toISOString();

  if (result.ok) {
    const record = await settle(docs, id, (current) => ({
      ...current,
      status: 'sent',
      attempts: current.attempts + 1,
      lastAttemptAt: attemptedAt,
      nextAttemptAt: null,
      sentAt: attemptedAt,
      providerId: result.providerId,
      lastError: null,
    }));
    return { outcome: 'sent', record };
  }

  const record = await settle(docs, id, (current) => {
    const attempts = current.attempts + 1;
    const again = result.retry && attempts < MAX_ATTEMPTS;
    return {
      ...current,
      status: again ? 'pending' : 'failed',
      attempts,
      lastAttemptAt: attemptedAt,
      nextAttemptAt: again ? new Date(at + RETRY_DELAYS_MS[attempts - 1]!).toISOString() : null,
      lastError: result.detail,
    };
  });

  // Every failed send is logged, the transient ones too, so a pattern of them shows.
  // The developer log folds identical ones within a minute into one entry.
  await recordFailure(
    {
      source: 'server',
      provider: provider.name,
      kind: result.kind,
      // Nobody was shown anything: an email failing is not a trainee's problem.
      code: 'unavailable',
      status: result.status,
      detail: `${record.kind} ${record.id}, try ${record.attempts}: ${result.detail}`,
      route: 'notifications',
      orgId: record.orgId,
    },
    { immediate: true },
  );

  return { outcome: record.status === 'failed' ? 'failed' : 'retrying', record };
}

/** Writes the outcome of a try and releases the claim. */
async function settle(
  docs: DocumentStore,
  id: string,
  change: (current: NotificationRecord) => NotificationRecord,
): Promise<NotificationRecord> {
  return docs.update<NotificationRecord>(NOTIFICATIONS, id, (current) => {
    // Only a deleted customer removes a record, and then there is nothing to settle.
    if (!current) throw new Error(`Notification ${id} disappeared while it was being sent.`);
    return { ...change(current), claimedUntil: null };
  });
}

/** Runs after the response when there is one, and straight away otherwise. */
function later(work: () => Promise<unknown>): void {
  const guarded = () =>
    work().catch((error: unknown) => {
      console.error(`[notifications] ${(error as Error)?.message ?? error}`);
    });
  try {
    after(guarded);
  } catch {
    // Outside a request, as in the tests and scripts. `after` refuses there.
    void guarded();
  }
}

/** How many other due notifications an event's send also tries. */
const PIGGYBACK = 5;

/**
 * Sends a new notification after the response, and a few others that are due.
 *
 * The others are there because a Hobby deployment's cron runs once a day, so without
 * this a send that failed at ten in the morning waits until the next morning however
 * short its backoff. Any later event in the meantime carries the retries along with it.
 */
export function sendSoon(record: NotificationRecord, options: OutboxOptions = {}): void {
  if (record.status === 'held') return;
  later(async () => {
    await attempt(record.id, options);
    await sendDue({ ...options, limit: PIGGYBACK });
  });
}

/** What a run of due notifications did. */
export interface DueReport {
  sent: number;
  retrying: number;
  failed: number;
  held: number;
  /** Due but not tried, because the run's limit or time ran out. */
  left: number;
}

/**
 * Tries every notification that is due: pending ones whose time has come, and held ones
 * once a provider is configured. Oldest first, up to `limit` or `budgetMs`.
 */
export async function sendDue(
  options: OutboxOptions & { limit?: number; budgetMs?: number } = {},
): Promise<DueReport> {
  const docs = documents(options);
  const now = clock(options);
  const started = Date.now();
  const sending = providerFor(options) !== null;

  const [pending, held] = await Promise.all([
    docs.where<NotificationRecord>(NOTIFICATIONS, 'status', 'pending'),
    sending ? docs.where<NotificationRecord>(NOTIFICATIONS, 'status', 'held') : [],
  ]);
  const due = [
    ...pending.filter((record) => !record.nextAttemptAt || Date.parse(record.nextAttemptAt) <= now),
    ...held,
  ]
    .filter((record) => claimable(record, now, ['pending', 'held']))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const report: DueReport = { sent: 0, retrying: 0, failed: 0, held: 0, left: 0 };
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  for (const [index, record] of due.entries()) {
    if (index >= limit || Date.now() - started > (options.budgetMs ?? 40_000)) {
      report.left = due.length - index;
      break;
    }
    const result = await attempt(record.id, options);
    if (result.outcome === 'sent') report.sent += 1;
    else if (result.outcome === 'retrying') report.retrying += 1;
    else if (result.outcome === 'failed') report.failed += 1;
    else if (result.outcome === 'held') report.held += 1;
  }
  return report;
}

/** How many notifications are held for want of a key. */
export async function heldCount(options: OutboxOptions = {}): Promise<number> {
  return (await documents(options).where(NOTIFICATIONS, 'status', 'held')).length;
}

/**
 * An administrator's "retry now": tries a held, pending or failed notification at once.
 *
 * A failed one starts a fresh round of retries, since somebody has presumably fixed what
 * made it fail. Returns undefined for an id that does not exist.
 */
export async function retryNow(
  id: string,
  options: OutboxOptions = {},
): Promise<AttemptResult | undefined> {
  const docs = documents(options);
  const now = clock(options);
  const current = await docs.get<NotificationRecord>(NOTIFICATIONS, id);
  if (!current) return undefined;
  if (current.status === 'failed') {
    await docs.update<NotificationRecord>(NOTIFICATIONS, id, (record) => {
      if (!record) throw new Error(`Notification ${id} disappeared.`);
      return record.status === 'failed'
        ? {
            ...record,
            status: 'pending',
            attempts: 0,
            nextAttemptAt: new Date(now).toISOString(),
          }
        : record;
    });
  }
  return attempt(id, options);
}

// ----------------------------------------------------------------------- reading

function monthsBack(now: number, count: number): string[] {
  const at = new Date(now);
  return Array.from({ length: count }, (_, back) =>
    new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - back, 1)).toISOString().slice(0, 7),
  );
}

/**
 * This month's and last month's notifications, newest first, up to `limit`.
 *
 * Read a month at a time by the `month` field, which the automatic index serves, so the
 * page never reads the whole collection.
 */
export async function recentNotifications(
  options: OutboxOptions & { limit?: number } = {},
): Promise<NotificationRecord[]> {
  const docs = documents(options);
  const months = monthsBack(clock(options), 2);
  const found = await Promise.all(
    months.map((month) => docs.where<NotificationRecord>(NOTIFICATIONS, 'month', month)),
  );
  return found
    .flat()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, options.limit ?? 200);
}

/**
 * Deletes what is past its 30 days, from the last few months, so a digest naming people
 * does not outlive its use if the TTL policy was never switched on.
 */
export async function pruneOld(options: OutboxOptions = {}): Promise<number> {
  const docs = documents(options);
  const now = clock(options);
  const cutoff = new Date(now - NOTIFICATION_RETENTION_DAYS * 86_400_000).toISOString();
  let removed = 0;
  for (const month of monthsBack(now, 4).slice(1)) {
    for (const record of await docs.where<NotificationRecord>(NOTIFICATIONS, 'month', month)) {
      // Never one still being worked on, however old.
      if (record.createdAt >= cutoff || record.status === 'pending') continue;
      await docs.remove(NOTIFICATIONS, record.id);
      removed += 1;
    }
  }
  return removed;
}

/** Deletes every notification about a customer, when the customer is deleted. */
export async function forgetNotificationsOf(
  orgId: string,
  options: OutboxOptions = {},
): Promise<number> {
  const docs = documents(options);
  const records = await docs.where<NotificationRecord>(NOTIFICATIONS, 'orgId', orgId);
  for (const record of records) await docs.remove(NOTIFICATIONS, record.id);
  return records.length;
}
