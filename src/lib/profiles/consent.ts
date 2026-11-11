/**
 * The record of who agreed to which privacy notice, and who withdrew.
 *
 * A log rather than a flag on the person. Each agreement and each withdrawal is its own
 * document, with the notice version and the moment, and nothing is ever overwritten:
 * the notice promises these records are kept for at least five years, and "agreed to the
 * draft of 8 November, withdrew on the 20th, agreed again to the approved text on the
 * 1st" is a history a flag cannot hold.
 *
 * Kept in the person's own organisation, beside their profile, in the org-scoped
 * `consents` collection. Deliberately not deleted when somebody withdraws or leaves:
 * their profile goes, the evidence of what they agreed to stays.
 */

import 'server-only';

import { PROFILE_NOTICE_VERSION } from './notice';
import { profileDocuments, type ProfileOwner, type ProfileStoreOptions } from './store';

/** The collection name, which the purge also lists. */
export const CONSENTS = 'consents';

export type ConsentDecision = 'given' | 'withdrawn';

export interface ConsentRecord {
  /** Also this document's id, so the purge can find it again. */
  id: string;
  personId: string;
  decision: ConsentDecision;
  /** The notice on screen when they decided. */
  noticeVersion: string;
  /** ISO 8601. */
  at: string;
  /**
   * Whether a profile came with the agreement. False for an administrator or a
   * facilitator agreeing to the notice alone, and for every withdrawal.
   */
  withProfile: boolean;
}

/**
 * A key that sorts by time and cannot collide for one person.
 *
 * The person and the moment, which is unique enough for something a person does by
 * clicking, with a few random characters so two tabs submitting in the same millisecond
 * still make two records rather than one overwriting the other.
 */
function consentId(personId: string, at: string): string {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `${personId}__${at.replace(/[^0-9]/g, '')}__${random}`;
}

export async function recordConsent(
  owner: ProfileOwner,
  decision: ConsentDecision,
  withProfile: boolean,
  options: ProfileStoreOptions = {},
  now: Date = new Date(),
): Promise<ConsentRecord> {
  const at = now.toISOString();
  const record: ConsentRecord = {
    id: consentId(owner.id, at),
    personId: owner.id,
    decision,
    noticeVersion: PROFILE_NOTICE_VERSION,
    at,
    withProfile: decision === 'given' && withProfile,
  };
  await profileDocuments(owner, options).set(CONSENTS, record.id, record);
  return record;
}

/** Everything this person has decided, oldest first. */
export async function consentHistory(
  owner: ProfileOwner,
  options: ProfileStoreOptions = {},
): Promise<ConsentRecord[]> {
  const rows = await profileDocuments(owner, options).where<ConsentRecord>(
    CONSENTS,
    'personId',
    owner.id,
  );
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Whether this person has agreed to the notice on screen now.
 *
 * An agreement to an older version does not count: the notice changed, so they have
 * not agreed to what it says. A later withdrawal does not undo it either. Withdrawing
 * takes back the profile, and the notice says training carries on without it, so the
 * agreement that let them attend still stands.
 */
export function agreedToCurrent(history: readonly ConsentRecord[]): boolean {
  return history.some(
    (record) => record.decision === 'given' && record.noticeVersion === PROFILE_NOTICE_VERSION,
  );
}

/** The most recent decision, for My profile to describe. */
export function latestDecision(history: readonly ConsentRecord[]): ConsentRecord | undefined {
  return history.at(-1);
}

export async function hasCurrentConsent(
  owner: ProfileOwner,
  options: ProfileStoreOptions = {},
): Promise<boolean> {
  return agreedToCurrent(await consentHistory(owner, options));
}
