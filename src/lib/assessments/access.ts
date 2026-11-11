/**
 * Who may manage question banks, and who may see whose results and feedback.
 *
 * Written once, here, so the routes and pages ask rather than work it out:
 *
 * - Question banks are uploaded only by the Benchmark administrator (Technavious). Not by
 *   a company administrator, and not by a facilitator, because the banks are Benchmark's
 *   content and a pass mark means nothing if whoever is being measured can set the paper.
 * - Results are visible to the participant, the facilitator of a session or batch they
 *   are in, the administrator, and their own company's administrator (BRD v2.3, AI-29).
 * - Feedback is visible to the administrator and the facilitator, and not to the company
 *   administrator, who gets results only.
 *
 * Whether a facilitator facilitates somebody is `facilitatesPerson`'s question, not this
 * file's, so the rule for that stays in one place.
 */

import 'server-only';

import { isAdministrator, isCompanyAdmin, isFacilitator } from '../auth/permissions';
import type { DocumentStore } from '../roster/documents';
import type { SignedInPerson } from '../roster/types';
import { facilitatesPerson, mayManageSession } from '../training/access';
import type { TrainingSession } from '../training/types';

export interface AccessOptions {
  /** The store underneath the training records, before it is scoped. For the tests. */
  store?: DocumentStore;
}

/** Upload, generate, change and remove question banks. */
export function mayManageBanks(viewer: SignedInPerson): boolean {
  return isAdministrator(viewer);
}

/** Open the results screen for a deck at all. What it then shows depends on who they are. */
export function mayOpenResults(viewer: SignedInPerson): boolean {
  return isAdministrator(viewer) || isCompanyAdmin(viewer) || isFacilitator(viewer);
}

/** Whether feedback is shown to this viewer at all. Company administrators see results only. */
export function maySeeFeedbackAtAll(viewer: SignedInPerson): boolean {
  return isAdministrator(viewer) || isFacilitator(viewer);
}

/** Whether this viewer may see this participant's assessment results. */
export async function maySeeResultsOf(
  viewer: SignedInPerson,
  personId: string,
  options: AccessOptions = {},
): Promise<boolean> {
  if (viewer.id === personId) return true;
  if (isAdministrator(viewer) || isCompanyAdmin(viewer)) return true;
  return facilitatesPerson(viewer, personId, options);
}

/** Whether this viewer may see this participant's feedback. */
export async function maySeeFeedbackOf(
  viewer: SignedInPerson,
  personId: string,
  options: AccessOptions = {},
): Promise<boolean> {
  if (isAdministrator(viewer)) return true;
  return facilitatesPerson(viewer, personId, options);
}

/**
 * Whether this viewer may look at one trainer-led session's results and feedback.
 *
 * The same people who may run it: its facilitator, and administrators of either kind.
 * A company administrator passes because they see every session in their company, and
 * is still shown results only.
 */
export function mayReviewSession(viewer: SignedInPerson, session: TrainingSession): boolean {
  return mayManageSession(viewer, session);
}
