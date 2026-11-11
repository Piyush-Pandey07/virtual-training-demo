/**
 * What of a lesson plan the screens are given (AI-43).
 *
 * Worked out on the server from the whole deck, so a page hands the browser the plan and
 * the gaps in words and nothing else of the deck.
 */

import type { DeckRecord } from '../deck-types';
import { alignmentFor } from './align';
import { describeGap, type LessonPlanSection } from './types';

export interface LessonPlanView {
  title?: string;
  sourceName?: string;
  updatedAt: string;
  sections: (LessonPlanSection & { matched: number[] })[];
  outcomes: string[];
  gaps: string[];
}

/** The gaps between a deck and its plan, in words, or none when it has no plan. */
export function lessonPlanGaps(deck: DeckRecord | undefined): string[] {
  if (!deck) return [];
  return (alignmentFor(deck)?.gaps ?? []).map((gap) => describeGap(gap));
}

/** The plan as the deck page shows and edits it, or null when the deck has none. */
export function lessonPlanView(deck: DeckRecord): LessonPlanView | null {
  const plan = deck.lessonPlan;
  const alignment = alignmentFor(deck);
  if (!plan || !alignment) return null;
  return {
    ...(plan.title ? { title: plan.title } : {}),
    ...(plan.sourceName ? { sourceName: plan.sourceName } : {}),
    updatedAt: plan.updatedAt,
    sections: plan.sections.map((section, index) => ({
      ...section,
      matched: alignment.sections[index]?.slides ?? [],
    })),
    outcomes: plan.outcomes,
    gaps: alignment.gaps.map((gap) => describeGap(gap)),
  };
}
