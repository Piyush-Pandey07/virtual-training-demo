/**
 * Marking an assessment, placing a participant, and checking feedback.
 *
 * Pure and free of server imports, so the tests reach every rule without a store, and the
 * administrator's screen can check level bands with the same function the server does.
 * Nothing here decides who may do what; that is `access.ts`.
 */

import {
  CURRENT_FEEDBACK_SET,
  DEFAULT_LEVEL_BANDS,
  PASS_MARK,
  RATING_MAX,
  RATING_MIN,
  type AssessmentPaper,
  type AssessmentResult,
  type BankQuestion,
  type FeedbackQuestionSet,
  type Level,
  type LevelBands,
  type ParticipantQuestion,
  type QuestionBank,
  type RecordedAnswer,
  type ResultSummary,
} from './types';

/**
 * The bank as a participant may see it.
 *
 * Built field by field rather than by deleting the answer from a copy, so a field added
 * to `BankQuestion` later stays on the server unless somebody chooses to send it.
 */
export function toParticipantQuestion(question: BankQuestion): ParticipantQuestion {
  return { id: question.id, question: question.question, options: [...question.options] };
}

export function paperFor(bank: QuestionBank): AssessmentPaper {
  return {
    deckId: bank.deckId,
    kind: bank.kind,
    version: bank.version,
    sample: bank.source === 'sample',
    questions: bank.questions.map(toParticipantQuestion),
  };
}

/**
 * What a participant is told about their own result: the score and what it means, and
 * not which questions they got wrong. Telling them that would hand the answer key to the
 * next person in the room, one question at a time.
 */
export function summaryOf(result: AssessmentResult): ResultSummary {
  const summary: ResultSummary = {
    kind: result.kind,
    correct: result.correct,
    total: result.total,
    percent: result.percent,
    submittedAt: result.submittedAt,
  };
  if (result.level) summary.level = result.level;
  if (result.passed !== undefined) {
    summary.passed = result.passed;
    summary.passMark = result.passMark ?? PASS_MARK;
  }
  return summary;
}

/** A refusal worded for the participant, with the status the route should send. */
export class AnswersRejected extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

export interface Marked {
  answers: RecordedAnswer[];
  correct: number;
  total: number;
  percent: number;
}

/**
 * Marks a submission against the bank.
 *
 * Every question must be answered, once, with an option that exists. An answer to a
 * question the bank does not have means the bank changed under the participant, which
 * the version check normally catches first, and is refused rather than ignored: scoring
 * the questions that happen to match would give a mark for a paper nobody sat.
 */
export function mark(questions: BankQuestion[], submitted: Record<string, unknown>): Marked {
  if (questions.length === 0) throw new AnswersRejected(409, 'This assessment has no questions.');

  const known = new Set(questions.map((question) => question.id));
  for (const id of Object.keys(submitted)) {
    if (!known.has(id)) {
      throw new AnswersRejected(
        409,
        'The questions changed while you were answering. Reload the page to see the current ones.',
      );
    }
  }

  const answers: RecordedAnswer[] = questions.map((question, index) => {
    const chosen = submitted[question.id];
    if (chosen === undefined || chosen === null) {
      throw new AnswersRejected(400, `Question ${index + 1} has not been answered.`);
    }
    if (
      typeof chosen !== 'number' ||
      !Number.isInteger(chosen) ||
      chosen < 0 ||
      chosen >= question.options.length
    ) {
      throw new AnswersRejected(
        400,
        `The answer to question ${index + 1} is not one of its options.`,
      );
    }
    return {
      questionId: question.id,
      chosenIndex: chosen,
      correct: chosen === question.correctIndex,
    };
  });

  const correct = answers.filter((answer) => answer.correct).length;
  return {
    answers,
    correct,
    total: questions.length,
    percent: percentOf(correct, questions.length),
  };
}

/**
 * A whole percentage, rounded down.
 *
 * Down rather than to the nearest, because the number is compared with a pass mark and a
 * band edge. Six out of nine is 66.7%, and showing that as 67% is harmless, but 69.6% shown
 * as 70% beside the word "Fail" is a support call. Computed in integers so 7 of 10 is
 * exactly 70 rather than 69.99999.
 */
export function percentOf(correct: number, total: number): number {
  if (total <= 0) return 0;
  return Math.floor((correct * 100) / total);
}

/** Whether a post-session score passes. 70% and above does. */
export function passes(percent: number, passMark = PASS_MARK): boolean {
  return percent >= passMark;
}

/** Where a pre-session score places somebody. Each edge belongs to the band above it. */
export function levelFor(percent: number, bands: LevelBands = DEFAULT_LEVEL_BANDS): Level {
  if (percent >= bands.advancedFrom) return 'advanced';
  if (percent >= bands.intermediateFrom) return 'intermediate';
  return 'beginner';
}

/**
 * Level bands an administrator typed, if they make sense.
 *
 * Both whole numbers, Intermediate starting above zero so Beginner exists at all, and
 * Advanced starting above Intermediate and no higher than 100 so all three bands can be
 * reached. Returns the problem in words, for the screen, or the bands.
 */
export function checkBands(
  value: unknown,
): { ok: true; bands: LevelBands } | { ok: false; error: string } {
  const { intermediateFrom, advancedFrom } = (value ?? {}) as Record<string, unknown>;
  if (
    typeof intermediateFrom !== 'number' ||
    typeof advancedFrom !== 'number' ||
    !Number.isInteger(intermediateFrom) ||
    !Number.isInteger(advancedFrom)
  ) {
    return { ok: false, error: 'Both band edges must be whole percentages.' };
  }
  if (intermediateFrom < 1 || intermediateFrom > 99) {
    return { ok: false, error: 'Intermediate must start somewhere from 1% to 99%.' };
  }
  if (advancedFrom <= intermediateFrom || advancedFrom > 100) {
    return {
      ok: false,
      error: 'Advanced must start above where Intermediate starts, and no higher than 100%.',
    };
  }
  return { ok: true, bands: { intermediateFrom, advancedFrom } };
}

/** A plain description of the bands, for the screens that show them. */
export function describeBands(bands: LevelBands): string {
  return `Under ${bands.intermediateFrom}% is Beginner, ${bands.intermediateFrom}% to under ${bands.advancedFrom}% is Intermediate, and ${bands.advancedFrom}% and over is Advanced.`;
}

// -------------------------------------------------------------------- feedback

export interface CheckedFeedback {
  ratings: Record<string, number>;
  comments: Record<string, string>;
}

/**
 * A feedback submission, checked against the question set it claims to answer.
 *
 * Every rating must be a whole number from 1 to 5. Comments are optional, trimmed, and
 * refused rather than cut when they are too long, so nobody's words are shortened
 * without their knowing. Anything not in the set is refused, because a stored field
 * nobody asked for is a field nobody will think to remove later.
 */
export function checkFeedback(
  ratings: unknown,
  comments: unknown,
  set: FeedbackQuestionSet = CURRENT_FEEDBACK_SET,
): { ok: true; feedback: CheckedFeedback } | { ok: false; error: string } {
  const givenRatings = (ratings && typeof ratings === 'object' ? ratings : {}) as Record<
    string,
    unknown
  >;
  const givenComments = (comments && typeof comments === 'object' ? comments : {}) as Record<
    string,
    unknown
  >;

  const ratingIds = new Set(set.questions.filter((q) => q.kind === 'rating').map((q) => q.id));
  const commentIds = new Set(set.questions.filter((q) => q.kind === 'comment').map((q) => q.id));

  for (const id of Object.keys(givenRatings)) {
    if (!ratingIds.has(id))
      return { ok: false, error: 'That feedback form is out of date. Reload the page.' };
  }
  for (const id of Object.keys(givenComments)) {
    if (!commentIds.has(id))
      return { ok: false, error: 'That feedback form is out of date. Reload the page.' };
  }

  const checked: CheckedFeedback = { ratings: {}, comments: {} };
  for (const question of set.questions) {
    if (question.kind === 'rating') {
      const value = givenRatings[question.id];
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < RATING_MIN ||
        value > RATING_MAX
      ) {
        return {
          ok: false,
          error: `Choose a rating from ${RATING_MIN} to ${RATING_MAX} for "${question.prompt}"`,
        };
      }
      checked.ratings[question.id] = value;
    } else {
      const value = givenComments[question.id];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'string') return { ok: false, error: 'A comment must be text.' };
      const text = value.trim();
      if (text.length > question.maxLength) {
        return {
          ok: false,
          error: `Your comment is ${text.length} characters long. Please keep it to ${question.maxLength}.`,
        };
      }
      if (text) checked.comments[question.id] = text;
    }
  }
  return { ok: true, feedback: checked };
}
