/**
 * Batches and trainer-led sessions (BRD v2.3: AI-38, AI-01, AI-32).
 *
 * Types only, free of imports, so the browser can hold them.
 *
 * An AI-led session is what the app has always had: one person, one assigned deck, at
 * their own pace, with no record beyond the attempt. A trainer-led session is new: a
 * facilitator runs a deck on their own screen for a listed group in one room, hands
 * over to the trainer when they choose, marks who was absent, and closes it. Each
 * participant does their own consent, profile, assessments and feedback on their own
 * device, so the session records who was on the list rather than slide progress.
 */

/** A named group of participants, owned by one facilitator. */
export interface Batch {
  id: string;
  name: string;
  /** The facilitator who owns it. Null until one is chosen. */
  facilitatorId: string | null;
  participantIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type TrainingSessionStatus = 'scheduled' | 'open' | 'closed';

export type AttendanceMark = 'present' | 'absent';

/** One trainer-led session: a deck, a facilitator, a list of participants and a date. */
export interface TrainingSession {
  id: string;
  deckId: string;
  /** Who runs it. Only they, and administrators, see and change it. */
  facilitatorId: string;
  /** The batch it was set up from, if any. The participant list is copied, not linked. */
  batchId: string | null;
  /**
   * Who may join. Copied from the batch when the session is set up, so changing a batch
   * later does not rewrite who was listed for a session that already happened.
   */
  participantIds: string[];
  /** ISO date and time it is planned for. Null when not set. */
  scheduledFor: string | null;
  status: TrainingSessionStatus;
  /**
   * Who attended, set by the facilitator. Anybody listed and not marked is shown as
   * not yet marked, and the facilitator is asked to mark them before closing.
   */
  attendance: Record<string, AttendanceMark>;
  createdBy: string;
  createdAt: string;
  openedAt: string | null;
  /** Only the facilitator, or an administrator, can close a session. */
  closedAt: string | null;
  closedBy: string | null;
}
