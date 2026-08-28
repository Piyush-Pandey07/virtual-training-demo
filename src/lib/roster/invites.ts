/**
 * Invite links: minting them, and deciding whether one may be used.
 *
 * The token is generated once, handed back once, and never stored. What is stored is
 * its SHA-256, so somebody who reads the roster file — or, later, the database —
 * finds no usable links in it. That is the whole reason to hash rather than store:
 * an invite is a credential, and credentials at rest should not be live.
 *
 * The check is deliberately a pure function of the invite and the moment, separate
 * from the store, so every reason a link can be refused is testable without a
 * filesystem and cannot drift between the page that shows the invite and the route
 * that accepts it.
 */

import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { emailKeyOf } from './store';
import type { Invite, InviteProblem } from './types';

/**
 * 32 bytes of randomness, base64url.
 *
 * Long enough that guessing is not a threat worth modelling, and URL-safe so it can
 * be pasted into a chat window without being mangled.
 */
export function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

/** Days an invite lasts by default. Long enough to be useful over a weekend. */
export const DEFAULT_INVITE_DAYS = 14;

/** The most an invite may last, however it is asked for. */
export const MAX_INVITE_DAYS = 90;

/** The most people one shared link may let in. */
export const MAX_INVITE_USES = 200;

export function expiryFrom(now: Date, days: number): string {
  const bounded = Math.min(Math.max(Math.round(days), 1), MAX_INVITE_DAYS);
  return new Date(now.getTime() + bounded * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Whether an invite may be accepted, and by whom.
 *
 * Order matters for what the person is told. Revoked and expired are facts about the
 * invite and are safe to state. A wrong address is checked last, because saying
 * "this invite is not for you" to somebody holding a link is only sensible once the
 * link is otherwise valid.
 */
export function inviteProblem(
  invite: Invite | undefined,
  now: Date,
  email?: string,
): InviteProblem | null {
  if (!invite) return 'unknown';
  if (invite.revokedAt) return 'revoked';
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) return 'expired';
  if (invite.usedCount >= invite.maxUses) return 'exhausted';
  if (invite.email && email && emailKeyOf(invite.email) !== emailKeyOf(email)) return 'wrong-email';
  return null;
}

/** What to say about a refused invite. Never says which, when it does not know. */
export function explainProblem(problem: InviteProblem): string {
  switch (problem) {
    case 'revoked':
      return 'This invitation has been withdrawn. Ask whoever sent it for a new one.';
    case 'expired':
      return 'This invitation has expired. Ask whoever sent it for a new one.';
    case 'exhausted':
      return 'This invitation has already been used as many times as it allows.';
    case 'wrong-email':
      return 'This invitation was issued to a different address.';
    default:
      // Deliberately the same wording as a link that never existed, so a wrong guess
      // learns nothing from the difference.
      return 'This invitation link is not valid.';
  }
}

/** The link to send somebody. */
export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/invite/${token}`;
}
