/**
 * The one rule every read of a profile, an assessment result or feedback asks (AI-41).
 *
 * Once the daily job has restricted a record, only a Technavious administrator may see
 * it. Not the facilitator, not the participant's company administrator, not the
 * participant on their own screens, and not the trainer: a restricted profile is not in
 * use, and handing it to the model is using it.
 *
 * Asked here, in one function, rather than worked out at each read, so that a new screen
 * which reads one of these records has one obvious thing to call and the rule cannot
 * drift between the places that already do. The read paths that ask it are listed in
 * the README under "Retention".
 *
 * Safe to import anywhere: it reads only the record and the person already in hand.
 */

import { isAdministrator, type Permissioned } from '../auth/permissions';
import type { Retained } from './policy';

/** Whether the daily job has restricted this record. */
export function isRestricted(record: Retained | null | undefined): boolean {
  return Boolean(record?.retention?.restrictedAt);
}

/**
 * The record, if this viewer may see it, or undefined.
 *
 * `null` as the viewer is the trainer, or anything else acting for nobody in particular,
 * and is refused a restricted record like everybody who is not an administrator.
 */
export function visibleTo<T extends Retained>(
  viewer: Permissioned | null,
  record: T | null | undefined,
): T | undefined {
  if (!record) return undefined;
  if (!isRestricted(record)) return record;
  return viewer && isAdministrator(viewer) ? record : undefined;
}

/** The records of a list this viewer may see. */
export function visibleOnly<T extends Retained>(
  viewer: Permissioned | null,
  records: readonly T[],
): T[] {
  return records.filter((record) => visibleTo(viewer, record) !== undefined);
}

/** What a screen says in place of a record it may not show. */
export const RESTRICTED_EXPLANATION =
  'Restricted under the retention policy, because there has been no session for 90 days. Only Technavious administrators can see it.';
