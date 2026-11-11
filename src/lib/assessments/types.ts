/**
 * Question banks, the pre and post-session assessments, and session feedback (BRD v2.3:
 * AI-04, AI-29, AI-31).
 *
 * Types and fixed values only, free of imports, so the browser can hold them. Nothing in
 * here carries a correct answer except `BankQuestion`, which only the administrator's
 * own screen and the server ever see. What a participant is sent is `ParticipantQuestion`,
 * which has no field for one, so a correct answer cannot reach their browser by somebody
 * forgetting to delete it.
 */

/** Before the session, to place somebody, or after it, to check what they learned. */
export type BankKind = 'pre' | 'post';

export const BANK_KINDS: readonly BankKind[] = ['pre', 'post'];

export function isBankKind(value: unknown): value is BankKind {
  return value === 'pre' || value === 'post';
}

export const BANK_KIND_LABELS: Record<BankKind, string> = {
  pre: 'Pre-session assessment',
  post: 'Post-session assessment',
};

/** Fewer than two is not a choice, and more than six is not read by anybody. */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

/** More than a participant would sit through, and enough for any bank the BRD imagines. */
export const MAX_QUESTIONS = 50;

/** Long enough for a scenario question, short enough to read on a phone. */
export const MAX_QUESTION_LENGTH = 600;
export const MAX_OPTION_LENGTH = 300;

/** One multiple choice question, with its answer. Administrator and server only. */
export interface BankQuestion {
  /** Assigned when the bank is saved, so a submission can name the question it answers. */
  id: string;
  question: string;
  options: string[];
  /** Which of `options` is right, counting from zero. Exactly one is. */
  correctIndex: number;
}

/** The same question as a participant is sent it: no answer, and nothing to find one in. */
export interface ParticipantQuestion {
  id: string;
  question: string;
  options: string[];
}

/** Where a participant is placed by the pre-session assessment. */
export type Level = 'beginner' | 'intermediate' | 'advanced';

export const LEVEL_LABELS: Record<Level, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

/**
 * The score percentages that divide the three levels.
 *
 * Below `intermediateFrom` is Beginner, from it up to `advancedFrom` is Intermediate, and
 * `advancedFrom` and over is Advanced. Two numbers rather than three ranges, so the
 * ranges cannot overlap or leave a gap.
 */
export interface LevelBands {
  intermediateFrom: number;
  advancedFrom: number;
}

/** Under 40% Beginner, 40% to under 75% Intermediate, 75% and over Advanced. */
export const DEFAULT_LEVEL_BANDS: LevelBands = { intermediateFrom: 40, advancedFrom: 75 };

/** The post-session pass mark, as a percentage. 70% and above passes (AI-29). */
export const PASS_MARK = 70;

/**
 * Who wrote a bank.
 *
 * `upload` came from the user team as a CSV. `sample` was generated from the deck so the
 * flow can be tried before the real banks arrive, and is labelled "Sample, not reviewed"
 * wherever it appears, because nobody has checked that its answers are right.
 */
export type BankSource = 'upload' | 'sample';

export const SAMPLE_LABEL = 'Sample, not reviewed';

/** One deck's pre or post-session bank, as stored. */
export interface QuestionBank {
  /** `${deckId}__${kind}`. Carried in the row so a purge can rebuild the key. */
  id: string;
  deckId: string;
  kind: BankKind;
  questions: BankQuestion[];
  /** The pre-session bank's level bands. Absent on a post-session bank. */
  bands?: LevelBands;
  source: BankSource;
  /**
   * Changes every time the questions do, so a submission against a bank that was
   * replaced while somebody was answering is refused rather than scored against
   * questions they never saw.
   */
  version: string;
  savedBy: string;
  savedAt: string;
}

/** What a participant's screen is given to take an assessment. */
export interface AssessmentPaper {
  deckId: string;
  kind: BankKind;
  version: string;
  sample: boolean;
  questions: ParticipantQuestion[];
}

/** One answer, as stored for audit: which option was chosen, and whether it was right. */
export interface RecordedAnswer {
  questionId: string;
  chosenIndex: number;
  correct: boolean;
}

/**
 * One participant's one attempt at one assessment for one deck. There is at most one,
 * and it never changes once written.
 */
export interface AssessmentResult {
  /** `${personId}__${deckId}__${kind}`. Carried in the row so a purge can rebuild it. */
  id: string;
  personId: string;
  deckId: string;
  kind: BankKind;
  /** The trainer-led session it was taken for, or null when the session was AI-led. */
  sessionId: string | null;
  answers: RecordedAnswer[];
  correct: number;
  total: number;
  /** Whole percent, rounded down, so 69.9% is not shown as a pass of 70%. */
  percent: number;
  /** Pre-session only: where the bands placed them. */
  level?: Level;
  /** Post-session only: whether they reached the pass mark. */
  passed?: boolean;
  /** The pass mark or bands in force when it was scored, so a later change cannot rewrite it. */
  passMark?: number;
  bands?: LevelBands;
  bankVersion: string;
  bankSource: BankSource;
  submittedAt: string;
  /**
   * Set by the daily retention job 90 days after last use, when only administrators may
   * see it (AI-41). The only change ever made to a result after it is written. The shape
   * is `RetentionMark` in retention/policy.ts, written inline to keep this file import-free.
   */
  retention?: { restrictedAt: string; lastUsedAt: string };
}

/** What a participant is told about their own result. No answer key, and no per-question marks. */
export interface ResultSummary {
  kind: BankKind;
  correct: number;
  total: number;
  percent: number;
  level?: Level;
  passed?: boolean;
  passMark?: number;
  submittedAt: string;
}

// -------------------------------------------------------------------- feedback

/**
 * One feedback question.
 *
 * Data rather than markup, so Benchmark's own questions can replace the interim set by
 * adding a new set below and pointing `CURRENT_FEEDBACK_SET` at it. Submissions record
 * which set they answered, so the two never get mixed up in a report.
 */
export type FeedbackQuestion =
  | { id: string; kind: 'rating'; prompt: string; low: string; high: string }
  | { id: string; kind: 'comment'; prompt: string; maxLength: number };

export interface FeedbackQuestionSet {
  id: string;
  questions: FeedbackQuestion[];
}

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/**
 * The interim set, until Benchmark's own questions arrive (AI-31).
 *
 * Every rating is required and the comment is optional.
 */
export const INTERIM_FEEDBACK_SET: FeedbackQuestionSet = {
  id: 'interim-2026-11',
  questions: [
    {
      id: 'trainer',
      kind: 'rating',
      prompt: 'How would you rate the trainer?',
      low: 'Poor',
      high: 'Excellent',
    },
    {
      id: 'content',
      kind: 'rating',
      prompt: 'How would you rate the content of the session?',
      low: 'Poor',
      high: 'Excellent',
    },
    {
      id: 'material',
      kind: 'rating',
      prompt: 'How would you rate the training material?',
      low: 'Poor',
      high: 'Excellent',
    },
    {
      id: 'facility',
      kind: 'rating',
      prompt: 'How would you rate the facility, or the setup you used to attend?',
      low: 'Poor',
      high: 'Excellent',
    },
    {
      id: 'learned',
      kind: 'rating',
      prompt: 'How much did you learn?',
      low: 'Nothing new',
      high: 'A great deal',
    },
    {
      id: 'comment',
      kind: 'comment',
      prompt: 'Anything else you would like to tell us? (optional)',
      maxLength: 1000,
    },
  ],
};

export const CURRENT_FEEDBACK_SET: FeedbackQuestionSet = INTERIM_FEEDBACK_SET;

/** One participant's feedback on one deck, or on one trainer-led session of it. */
export interface FeedbackRecord {
  /** `${personId}__${deckId}`, with `__${sessionId}` when trainer-led. */
  id: string;
  personId: string;
  deckId: string;
  sessionId: string | null;
  questionSetId: string;
  /** By question id. Every rating question in the set is present. */
  ratings: Record<string, number>;
  /** By question id. Only comments somebody actually wrote. */
  comments: Record<string, string>;
  submittedAt: string;
  /** Set by the daily retention job, as on a result. */
  retention?: { restrictedAt: string; lastUsedAt: string };
}

// ---------------------------------------------------------------- the report

/** One participant's row on the results and feedback screen. */
export interface ResultsRow {
  personId: string;
  name: string;
  email: string;
  pre: { percent: number; level: Level | null; submittedAt: string } | null;
  post: {
    percent: number;
    passed: boolean;
    submittedAt: string;
    /** The trainer-led session it was taken after, or null for a one-to-one session. */
    sessionId: string | null;
  } | null;
  /** Null when the viewer may not see feedback; otherwise whether it has been given. */
  feedback: 'submitted' | 'pending' | null;
  /**
   * Whether any of their results or feedback for this deck is restricted under the
   * retention policy. For anybody but an administrator, those are then absent above.
   */
  restricted: boolean;
}
