/**
 * What a lesson plan is (AI-43).
 *
 * The Benchmark administrator's own plan for a course: the session flow, as ordered
 * sections with a time and an objective each, and the curriculum's learning outcomes.
 * The teaching plan follows it where the deck agrees, and where the deck differs the
 * trainer follows the deck and the facilitator is told about the difference.
 *
 * Kept on the deck record rather than in a collection of its own, because it belongs
 * to exactly one deck, is read on every turn the deck is taught from, and has to go
 * when the deck goes. On the record it is in the same organisation as the deck by
 * construction, the chat route already has it without another read, deleting a deck
 * or a customer removes it with nothing new to remember, and the approval fingerprint
 * can see it. Never on `meta`, which crosses to the browser in `DeckClientView`.
 *
 * Types and wording only, no data and no I/O, so both sides can import this file.
 */

import { TRAINER_NAME } from '../trainer';

/** One part of the session flow. */
export interface LessonPlanSection {
  title: string;
  /** How long the plan gives it, in whole minutes. */
  minutes?: number;
  /** What the section is for, in the plan's words. */
  objective?: string;
  /**
   * The slides the administrator tied this section to, by number.
   *
   * Overrides matching by title. Matching is a guess, and a guess the administrator
   * can see is wrong has to be correctable without renaming slides.
   */
  slides?: number[];
}

/**
 * How the plan lines up with the deck as it stood when it was worked out.
 *
 * Worked out when the plan is saved, never per turn. `slidesKey` says which slides it
 * was worked out against, so a deck whose slides have since changed is realigned
 * rather than trusted.
 */
export interface LessonPlanAlignment {
  slidesKey: string;
  /**
   * The slides serving each section, in the same order as `LessonPlan.sections`.
   *
   * Objects rather than a list of lists, which Firestore cannot store.
   */
  sections: { slides: number[] }[];
  gaps: LessonPlanGap[];
}

/** One way the deck differs from the plan. */
export type LessonPlanGap =
  /** A section with no slide in the deck. */
  | { kind: 'missing'; section: string }
  /** A section the deck teaches before one the plan puts ahead of it. */
  | { kind: 'order'; section: string; before: string }
  /** A section whose slides hold far more or far less than the plan's time for it. */
  | { kind: 'timing'; section: string; planMinutes: number; deckMinutes: number }
  /** Teaching slides that belong to no section of the plan. */
  | { kind: 'unplanned'; slides: number[] };

export interface LessonPlan {
  /** The plan's own name for the course, when it gives one. */
  title?: string;
  sections: LessonPlanSection[];
  /** The curriculum's learning outcomes, one each. */
  outcomes: string[];
  /** The file it was read from, for the record. */
  sourceName?: string;
  /** ISO 8601. */
  updatedAt: string;
  alignment?: LessonPlanAlignment;
}

/** The editable part of a plan: what the administrator sends back after checking it. */
export type LessonPlanDraft = Pick<LessonPlan, 'title' | 'sections' | 'outcomes' | 'sourceName'>;

/** Caps, shared by the parser, the form and the server's own check. */
export const LESSON_PLAN_LIMITS = {
  /** The most text read from one upload or paste. A long plan is a few pages. */
  textChars: 60_000,
  sections: 40,
  outcomes: 30,
  titleChars: 200,
  objectiveChars: 600,
  outcomeChars: 400,
  /** A whole day's course. */
  sectionMinutes: 600,
} as const;

function minutesWord(minutes: number): string {
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function slidesWord(slides: number[]): string {
  if (slides.length === 1) return `Slide ${slides[0]}`;
  return `Slides ${slides.slice(0, -1).join(', ')} and ${slides[slides.length - 1]}`;
}

/**
 * The gap in words, for the facilitator and the administrator.
 *
 * Every one ends by saying what Nova will do about it, because the facilitator reading
 * it is about to run the session and needs to know what to expect rather than what to
 * fix: fixing it is the administrator's.
 */
export function describeGap(gap: LessonPlanGap, trainerName = TRAINER_NAME): string {
  switch (gap.kind) {
    case 'missing':
      return `The lesson plan's section "${gap.section}" has no slide in this deck; ${trainerName} will follow the deck and not teach it.`;
    case 'order':
      return `The lesson plan puts "${gap.before}" before "${gap.section}", but the deck teaches "${gap.section}" first; ${trainerName} will follow the deck's order.`;
    case 'timing':
      return gap.deckMinutes > gap.planMinutes
        ? `The lesson plan gives "${gap.section}" ${minutesWord(gap.planMinutes)}, but its slides take about ${minutesWord(gap.deckMinutes)} to teach; ${trainerName} will follow the deck, so the section is likely to run over.`
        : `The lesson plan gives "${gap.section}" ${minutesWord(gap.planMinutes)}, but its slides hold about ${minutesWord(gap.deckMinutes)} of teaching; ${trainerName} will follow the deck, so leave the rest for discussion.`;
    case 'unplanned':
      return `${slidesWord(gap.slides)} ${gap.slides.length === 1 ? 'is' : 'are'} in no section of the lesson plan; ${trainerName} will still teach ${gap.slides.length === 1 ? 'it' : 'them'}, as the deck does.`;
  }
}
