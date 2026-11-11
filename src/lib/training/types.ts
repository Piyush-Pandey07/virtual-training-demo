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

/**
 * A session moves from scheduled to open to closed, or from scheduled to cancelled, and
 * never back: a closed or cancelled session is a record, and running it again means
 * setting up a new one.
 */
export type TrainingSessionStatus = 'scheduled' | 'open' | 'closed' | 'cancelled';

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
  /**
   * When each participant's mark was last changed, written with the mark. Somebody marked
   * present after the session opened joined late (AI-26). Absent from sessions marked
   * before it was kept, whose marks are then read as on time.
   */
  attendanceAt?: Record<string, string>;
  createdBy: string;
  createdAt: string;
  openedAt: string | null;
  /** Only the facilitator, or an administrator, can close a session. */
  closedAt: string | null;
  closedBy: string | null;
  /**
   * When and by whom a session was cancelled before it started. The record is kept, shown
   * as cancelled. Set in the same transaction as the status, so a hand-over arriving at
   * the same moment cannot open it.
   */
  cancelledAt?: string;
  cancelledBy?: string;
}

/** One participant's line in a session's closure summary (AI-33). */
export interface SummaryRow {
  personId: string;
  name: string;
  email: string;
  attendance: AttendanceMark | 'not marked';
  /** Marked present after the session opened. */
  joinedLate: boolean;
  /** When their mark was made, if that was recorded. */
  markedAt: string | null;
  preLevel: string | null;
  /** The pre-session bank's version, as people number it, when the result records one. */
  preVersion: string | null;
  postPercent: number | null;
  passed: boolean | null;
  /**
   * The post-session result was taken after another sitting of this deck: a result is
   * kept once per person and deck, so it is theirs, but not this session's.
   */
  postElsewhere: boolean;
  /**
   * Post-session answers wrong and left unanswered, and the bank's version, when the
   * result records them. Null for a result scored before it did.
   */
  postWrong: number | null;
  postNotAttempted: number | null;
  postVersion: string | null;
  feedback: 'submitted' | 'pending' | null;
}
