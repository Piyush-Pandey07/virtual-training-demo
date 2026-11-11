/**
 * The shape of an email notification as the outbox keeps it (AI-35).
 *
 * Types and constants only, with no imports, so the administrator's page, its retry
 * button in the browser and the server all read the same statuses and the same words.
 */

/** What the email is about. */
export type NotificationKind = 'session-set-up' | 'profiles-incomplete';

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  'session-set-up': 'Session set up',
  'profiles-incomplete': 'Incomplete profiles',
};

/**
 * Where a notification stands.
 *
 * - pending: waiting for its first try or its next retry, at `nextAttemptAt`.
 * - sent: Resend accepted it. Whether it then reached the inbox is Resend's to report.
 * - failed: refused in a way retrying cannot fix, or still failing after every retry.
 * - held: nothing was sent because no provider is configured. Sent by the first run
 *   after RESEND_API_KEY is set.
 */
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'held';

export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  pending: 'Waiting to send',
  sent: 'Sent',
  failed: 'Failed',
  held: 'Held, no key',
};

export interface NotificationRecord {
  /** Derived from `dedupeKey`, so the same event can only ever be written once. */
  id: string;
  /**
   * What makes two events the same event, such as the session's id. Ids and a hash only,
   * never names or addresses, so the key can be logged and shown freely.
   */
  dedupeKey: string;
  kind: NotificationKind;
  /** The customer it is about, so it goes when they are deleted. */
  orgId?: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  /** ISO 8601. */
  createdAt: string;
  /** `YYYY-MM` in UTC, which is how the administrator's page reads recent ones. */
  month: string;
  status: NotificationStatus;
  /** Sends tried so far. A held notification has tried none. */
  attempts: number;
  /** What went wrong last, in the provider's words, or why it is held. */
  lastError: string | null;
  lastAttemptAt: string | null;
  /** When the next try is due, while pending. */
  nextAttemptAt: string | null;
  /**
   * Set while one server is sending it, so a cron run and the send after the event
   * cannot both send it at once. A send that died leaves it, and it lapses by itself.
   */
  claimedUntil: string | null;
  sentAt: string | null;
  /** Resend's id for the email, once sent. */
  providerId: string | null;
  /** For Firestore's TTL policy on `expireAt`, as the developer log has. */
  expireAt: Date;
}

/** What the page and its API show of one: everything but the body. */
export type NotificationSummary = Omit<NotificationRecord, 'text' | 'html' | 'expireAt'>;
