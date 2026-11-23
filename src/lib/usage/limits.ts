import 'server-only';

import { orgStore, orgsConfigured } from '../orgs/registry';
import { usageFor } from './store';

/**
 * Whether a customer may start another session this month.
 *
 * Checked when a session begins rather than on every turn. A cap that read two extra
 * documents before each sentence would be a meaningful tax on the thing it is meant to
 * protect, and stopping somebody halfway through a deck is worse than not letting them
 * start: they would lose the session they were in the middle of, and the spend that
 * caused the refusal has already happened.
 *
 * A customer with no cap is the normal case and costs one read to establish. That read
 * is worth it: the alternative is finding out a customer ran up an unbounded bill when
 * the invoice arrives, a month later, with nothing to point at.
 */

export interface CapVerdict {
  allowed: boolean;
  /** Present when refused, and written to be shown to a trainee rather than logged. */
  reason?: string;
  used: number;
  limit: number | null;
}

/**
 * A customer's training sessions this month, for the customer to see (UAT, issue 19).
 *
 * The cap was shown only on Technavious's Customers page, so a company found out it had
 * one at the moment a session was refused. Null when there is nothing honest to show:
 * no customer list on this deployment, or the customer or its usage cannot be read.
 */
export interface MonthlyAllowance {
  used: number;
  /** Null when the customer has no monthly cap. */
  limit: number | null;
  /** The first moment of next month, ISO 8601, when the count starts again. */
  resetsAt: string;
}

export async function monthlyAllowance(
  orgId: string,
  now: Date = new Date(),
): Promise<MonthlyAllowance | null> {
  if (!orgsConfigured()) return null;
  const [organisation, usage] = await Promise.all([
    orgStore()
      .get(orgId)
      .catch(() => undefined),
    usageFor(orgId, now).catch(() => undefined),
  ]);
  if (!organisation || !usage) return null;
  return {
    used: usage.sessions,
    limit: organisation.limits.sessionsPerMonth,
    // The count is kept per calendar month in UTC (`monthOf`), so it starts again at
    // midnight UTC on the first, half past five in the morning in India.
    resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
}

export async function mayStartSession(orgId: string): Promise<CapVerdict> {
  if (!orgsConfigured()) return { allowed: true, used: 0, limit: null };

  const organisation = await orgStore()
    .get(orgId)
    .catch(() => undefined);

  // A customer that cannot be read is allowed through. Refusing everybody because a
  // lookup failed would turn a transient storage problem into an outage for every
  // customer at once, which is a worse failure than a month running slightly over.
  if (!organisation) return { allowed: true, used: 0, limit: null };

  if (organisation.status === 'suspended') {
    return {
      allowed: false,
      reason: 'Training for this organisation is currently suspended.',
      used: 0,
      limit: null,
    };
  }

  const limit = organisation.limits.sessionsPerMonth;
  if (limit === null) return { allowed: true, used: 0, limit: null };

  const usage = await usageFor(orgId).catch(() => undefined);
  const used = usage?.sessions ?? 0;

  if (used >= limit) {
    return {
      allowed: false,
      reason:
        'This organisation has used all its training sessions for this month. The count starts again on the first of next month. Technavious sets this limit, so your training administrator can ask them to raise it.',
      used,
      limit,
    };
  }

  return { allowed: true, used, limit };
}
