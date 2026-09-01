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
        'This organisation has reached its training limit for this month. Whoever runs your training can raise it.',
      used,
      limit,
    };
  }

  return { allowed: true, used, limit };
}
