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
 *
 * Scores are whole percentages, rounded down, so "above 70%" is `advancedFrom: 71`. The
 * screens show and take that edge as "Advanced above 70%", in the words the bands were
 * asked for, and the stored shape stays the one every bank and result already has.
 */
export interface LevelBands {
  intermediateFrom: number;
  advancedFrom: number;
}

/**
 * Below 40% Beginner, 40% to 70% Intermediate, above 70% Advanced, as the product owner
 * set them for UAT: 40% exactly and 70% exactly are both Intermediate.
 */
export const DEFAULT_LEVEL_BANDS: LevelBands = { intermediateFrom: 40, advancedFrom: 71 };

/**
 * The defaults before November 2026. Every pre-session bank saved then stored them,
 * because a bank was given the defaults whether or not anybody chose bands, so a bank
 * still holding them without `bandsChosen` is read as having the current defaults.
 */
export const EARLIER_DEFAULT_LEVEL_BANDS: LevelBands = { intermediateFrom: 40, advancedFrom: 75 };

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
  /**
   * Set once an administrator has saved bands themselves, so bands they chose are never
   * mistaken for the earlier defaults (see `EARLIER_DEFAULT_LEVEL_BANDS`).
   */
  bandsChosen?: boolean;
  source: BankSource;
  /**
   * Changes every time the questions do. Every version is kept in `questionBankVersions`,
   * so a submission against a bank that was replaced while somebody was answering is
   * marked against the questions they were shown, not the new ones.
   */
  version: string;
  /**
   * 1 for a deck's first set of questions of this kind, counting up with each upload or
   * sample, for people to read. Absent on a bank saved before versions were kept.
   */
  versionNumber?: number;
  savedBy: string;
  savedAt: string;
}

/**
 * One version of a bank, kept for good: the questions a participant was shown, so their
 * result can always be marked and read against them. Written when the version is saved,
 * and never changed or removed, even when the bank is replaced or removed. Bands are not
 * kept here, being a decision about the deck rather than about one set of questions.
 */
export interface QuestionBankVersion {
  /** `${deckId}__${kind}__${version}`. Carried in the row so a purge can rebuild the key. */
  id: string;
  /** The bank it is a version of, `${deckId}__${kind}`, to list a bank's versions by. */
  bankId: string;
  deckId: string;
  kind: BankKind;
  version: string;
  versionNumber: number;
  questions: BankQuestion[];
  source: BankSource;
  savedBy: string;
  savedAt: string;
}

/** A version as the administrator's screen lists it: when, from where, and how long. */
export interface BankVersionSummary {
  version: string;
  versionNumber: number;
  source: BankSource;
  questions: number;
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

/**
 * How one question went. A question left blank is not attempted and scores nothing, the
 * same as a wrong answer, but is told apart from one because they mean different things
 * to a facilitator: somebody who ran out of patience, or did not understand the question,
 * rather than somebody who thought they knew.
 */
export type AnswerOutcome = 'correct' | 'wrong' | 'not-attempted';

export const OUTCOME_LABELS: Record<AnswerOutcome, string> = {
  correct: 'Correct',
  wrong: 'Wrong',
  'not-attempted': 'Not attempted',
};

/** One answer, as stored for audit: which option was chosen, and how it went. */
export interface RecordedAnswer {
  questionId: string;
  /** Null when the question was left blank. */
  chosenIndex: number | null;
  correct: boolean;
  /** Absent on a result stored before blanks were allowed, when every answer was given. */
  outcome?: AnswerOutcome;
}

/** How many questions went each way. */
export interface OutcomeCounts {
  correct: number;
  wrong: number;
  notAttempted: number;
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
  /** Answered, but not with the right option. Absent before blanks were allowed. */
  wrong?: number;
  /** Left blank, scoring nothing. Absent before blanks were allowed. */
  notAttempted?: number;
  /** Every question on the paper, answered or not: the score is a share of all of them. */
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
  /** The version of the bank it was taken on, and marked against. */
  bankVersion: string;
  /** That version's number, for people to read. Absent before versions were kept. */
  bankVersionNumber?: number;
  bankSource: BankSource;
  submittedAt: string;
  /**
   * Set by the daily retention job 90 days after last use, when only administrators may
   * see it (AI-41). The only change ever made to a result after it is written. The shape
   * is `RetentionMark` in retention/policy.ts, written inline to keep this file import-free.
   */
  retention?: { restrictedAt: string; lastUsedAt: string };
}

/**
 * What a participant is told about their own result. No answer key, and no per-question
 * marks: how many were right, wrong and left blank, but not which.
 */
export interface ResultSummary {
  kind: BankKind;
  correct: number;
  wrong: number;
  notAttempted: number;
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
  pre:
    | (OutcomeCounts & {
        percent: number;
        level: Level | null;
        submittedAt: string;
        /** The version of the questions it was taken on, when known. */
        versionNumber: number | null;
      })
    | null;
  post:
    | (OutcomeCounts & {
        percent: number;
        passed: boolean;
        submittedAt: string;
        /** The trainer-led session it was taken after, or null for a one-to-one session. */
        sessionId: string | null;
        versionNumber: number | null;
      })
    | null;
  /** Null when the viewer may not see feedback; otherwise whether it has been given. */
  feedback: 'submitted' | 'pending' | null;
  /**
   * Whether any of their results or feedback for this deck is restricted under the
   * retention policy. For anybody but an administrator, those are then absent above.
   */
  restricted: boolean;
}
