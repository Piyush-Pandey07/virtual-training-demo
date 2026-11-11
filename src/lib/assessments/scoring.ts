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
  EARLIER_DEFAULT_LEVEL_BANDS,
  PASS_MARK,
  RATING_MAX,
  RATING_MIN,
  type AnswerOutcome,
  type AssessmentPaper,
  type AssessmentResult,
  type BankQuestion,
  type FeedbackQuestionSet,
  type Level,
  type LevelBands,
  type OutcomeCounts,
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

/**
 * The paper a participant is given.
 *
 * With a person, its questions are in an order of their own, so two people side by side
 * in a room are not on the same question at the same time. The order is worked out from
 * who they are and the bank's version rather than drawn at random, so a reload, or the
 * same person on another device, sees the same order, and a new version is a new order.
 * The options keep the order they were written in: a bank may have "All of the above" or
 * "Both A and B", which moving would make wrong. Marking goes by question id, so the
 * order a question was shown in never matters to its mark.
 */
export function paperFor(bank: QuestionBank, personId?: string): AssessmentPaper {
  const questions = bank.questions.map(toParticipantQuestion);
  return {
    deckId: bank.deckId,
    kind: bank.kind,
    version: bank.version,
    sample: bank.source === 'sample',
    questions: personId ? seededShuffle(questions, `${personId}:${bank.version}`) : questions,
  };
}

/**
 * A 32-bit number from a string (FNV-1a). Not for secrets: only so the same seed always
 * gives the same order, in the browser or on the server.
 */
function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A small seeded generator (mulberry32), giving numbers from 0 up to but not including 1. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** The items in an order fixed by the seed: the same seed, the same order. A copy. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const random = seededRandom(hashOf(seed));
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
  }
  return shuffled;
}

/** How one recorded answer went, including one stored before blanks were allowed. */
export function outcomeOf(answer: RecordedAnswer): AnswerOutcome {
  if (answer.outcome) return answer.outcome;
  if (answer.correct) return 'correct';
  return answer.chosenIndex === null || answer.chosenIndex === undefined
    ? 'not-attempted'
    : 'wrong';
}

/**
 * How many questions a result had right, wrong and left blank.
 *
 * From the stored counts where there are some, and otherwise from the answers, for a
 * result written before blanks were allowed, when everything not right was wrong.
 */
export function outcomeCounts(result: AssessmentResult): OutcomeCounts {
  if (typeof result.wrong === 'number' && typeof result.notAttempted === 'number') {
    return { correct: result.correct, wrong: result.wrong, notAttempted: result.notAttempted };
  }
  const answers = Array.isArray(result.answers) ? result.answers : [];
  const notAttempted = answers.filter((answer) => outcomeOf(answer) === 'not-attempted').length;
  return {
    correct: result.correct,
    wrong: Math.max(0, result.total - result.correct - notAttempted),
    notAttempted,
  };
}

/**
 * What a participant is told about their own result: the score, what it means, and how
 * many questions were right, wrong and not attempted, but not which. Telling them which
 * would hand the answer key to the next person in the room, one question at a time.
 */
export function summaryOf(result: AssessmentResult): ResultSummary {
  const counts = outcomeCounts(result);
  const summary: ResultSummary = {
    kind: result.kind,
    correct: result.correct,
    wrong: counts.wrong,
    notAttempted: counts.notAttempted,
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
  wrong: number;
  notAttempted: number;
  total: number;
  percent: number;
}

/**
 * Marks a submission against the bank.
 *
 * The score is the share of all the questions answered correctly. A question answered
 * with the wrong option is Wrong; one left blank is Not attempted; both score nothing.
 * An answer that is given must be an option that exists. An answer to a question the
 * bank does not have means the paper is not this version's, and is refused rather than
 * ignored: scoring the questions that happen to match would give a mark for a paper
 * nobody sat.
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

  const answers: RecordedAnswer[] = questions.map((question) => {
    const chosen = submitted[question.id];
    if (chosen === undefined || chosen === null) {
      return {
        questionId: question.id,
        chosenIndex: null,
        correct: false,
        outcome: 'not-attempted',
      };
    }
    if (
      typeof chosen !== 'number' ||
      !Number.isInteger(chosen) ||
      chosen < 0 ||
      chosen >= question.options.length
    ) {
      // Not numbered, because the participant's numbering is their own shuffled order.
      throw new AnswersRejected(
        400,
        "One of your answers is not one of its question's options. Reload the page and try again.",
      );
    }
    const correct = chosen === question.correctIndex;
    return {
      questionId: question.id,
      chosenIndex: chosen,
      correct,
      outcome: correct ? 'correct' : 'wrong',
    };
  });

  const count = (outcome: AnswerOutcome) =>
    answers.filter((answer) => answer.outcome === outcome).length;
  const correct = count('correct');
  return {
    answers,
    correct,
    wrong: count('wrong'),
    notAttempted: count('not-attempted'),
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

/**
 * Where a pre-session score places somebody. Each edge belongs to the band above it, so
 * with the defaults 40% is Intermediate and 70% is Intermediate, while 71% is Advanced.
 *
 * Only ever a level: nobody fails the pre-session assessment.
 */
export function levelFor(percent: number, bands: LevelBands = DEFAULT_LEVEL_BANDS): Level {
  if (percent >= bands.advancedFrom) return 'advanced';
  if (percent >= bands.intermediateFrom) return 'intermediate';
  return 'beginner';
}

/**
 * The bands a pre-session bank places people by.
 *
 * The bank's own, unless it has none or still holds the earlier defaults that every bank
 * was given before November 2026 without anybody choosing them, which are read as the
 * current defaults.
 */
export function bandsOf(bank: Pick<QuestionBank, 'bands' | 'bandsChosen'> | undefined): LevelBands {
  const bands = bank?.bands;
  if (!bands) return DEFAULT_LEVEL_BANDS;
  if (
    !bank.bandsChosen &&
    bands.intermediateFrom === EARLIER_DEFAULT_LEVEL_BANDS.intermediateFrom &&
    bands.advancedFrom === EARLIER_DEFAULT_LEVEL_BANDS.advancedFrom
  ) {
    return DEFAULT_LEVEL_BANDS;
  }
  return { intermediateFrom: bands.intermediateFrom, advancedFrom: bands.advancedFrom };
}

/**
 * A participant's level for one trainer-led session: their pre-session score placed by
 * that session's bands, which its facilitator may have changed since they took it. A
 * session set up before sessions had bands uses the level the result was given.
 */
export function levelWithBands(
  result: Pick<AssessmentResult, 'percent' | 'level'>,
  bands: LevelBands | undefined,
): Level {
  if (bands) return levelFor(result.percent, bands);
  return result.level ?? levelFor(result.percent);
}

const LEVEL_ORDER: readonly Level[] = ['beginner', 'intermediate', 'advanced'];

/**
 * The level most of a group are at (AI-37), or null for nobody. On a tie the lower
 * level, so nobody is left behind by a pitch above them.
 */
export function mostCommonLevel(levels: readonly Level[]): Level | null {
  let best: Level | null = null;
  let bestCount = 0;
  // Lowest first, and only a strictly larger count replaces it, so a tie keeps the lower.
  for (const level of LEVEL_ORDER) {
    const count = levels.filter((each) => each === level).length;
    if (count > bestCount) {
      best = level;
      bestCount = count;
    }
  }
  return best;
}

/** The score above which a participant is Advanced, as the screens show it. */
export function advancedAbove(bands: LevelBands): number {
  return bands.advancedFrom - 1;
}

/**
 * Level bands somebody typed, if they make sense.
 *
 * Takes the stored shape: a screen that asks for "Advanced above" sends one more than
 * what was typed as `advancedFrom`. Both whole numbers, Intermediate starting above zero
 * so Beginner exists at all, and Advanced above a score no lower than where Intermediate
 * starts and below 100% so all three bands can be reached. Returns the problem in words,
 * for the screen, or the bands.
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
      error:
        'Advanced must be above a score no lower than where Intermediate starts, and below 100%.',
    };
  }
  return { ok: true, bands: { intermediateFrom, advancedFrom } };
}

/** A plain description of the bands, for the screens that show them. */
export function describeBands(bands: LevelBands): string {
  const top = advancedAbove(bands);
  const middle =
    top === bands.intermediateFrom ? `${top}%` : `${bands.intermediateFrom}% to ${top}%`;
  return `Below ${bands.intermediateFrom}% is Beginner, ${middle} is Intermediate, and above ${top}% is Advanced.`;
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
