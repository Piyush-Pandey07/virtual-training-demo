/**
 * Checking a lesson plan, whichever way it arrives (AI-43).
 *
 * Three ways in: the administrator's checked draft from the browser, a stored deck read
 * back from storage, and the model's attempt at structuring free text. All three are
 * reduced to the same shape here, with the same caps, so a plan that reaches the prompt
 * has been through one set of rules however it got there.
 *
 * Pure, so the tests and both sides can use it.
 */

import {
  LESSON_PLAN_LIMITS as LIMITS,
  type LessonPlan,
  type LessonPlanAlignment,
  type LessonPlanDraft,
  type LessonPlanGap,
  type LessonPlanSection,
} from './types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One line of text, as a person would read it.
 *
 * Control characters and runs of space go, since everything here was typed into a form
 * or extracted from a file and is spoken from. Double quotes become single, so a section
 * title quoted in the prompt or in a gap cannot close its own quotation.
 */
export function cleanLine(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f­​-‏⁠﻿]+/g, ' ')
    .replace(/[  -   　]/g, ' ')
    .replace(/["“”]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** Slide numbers, as typed: "4-5, 7" or an array of numbers. Sorted and unique. */
export function readSlideNumbers(value: unknown): number[] {
  const numbers: number[] = [];
  const add = (n: number) => {
    if (Number.isInteger(n) && n >= 1 && n <= 1000) numbers.push(n);
  };
  if (Array.isArray(value)) {
    for (const entry of value) add(Number(entry));
  } else if (typeof value === 'string') {
    for (const part of value.split(/[,;]|\band\b/)) {
      const range = part.match(/^\s*(\d+)\s*(?:-|to|–)\s*(\d+)\s*$/);
      if (range) {
        const [from, to] = [Number(range[1]), Number(range[2])];
        // A range written backwards, or absurdly long, is a typing slip, not a plan.
        if (to >= from && to - from < 200) for (let n = from; n <= to; n += 1) add(n);
      } else if (/^\s*\d+\s*$/.test(part)) {
        add(Number(part));
      }
    }
  }
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function readSection(raw: unknown, index: number, problems: string[]): LessonPlanSection | null {
  if (!isObject(raw)) {
    problems.push(`section ${index + 1} must be an object.`);
    return null;
  }
  const title = typeof raw.title === 'string' ? cleanLine(raw.title, LIMITS.titleChars) : '';
  if (!title) {
    problems.push(`section ${index + 1} needs a title.`);
    return null;
  }
  const section: LessonPlanSection = { title };

  if (raw.minutes !== undefined && raw.minutes !== null && raw.minutes !== '') {
    const minutes = Number(raw.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > LIMITS.sectionMinutes) {
      problems.push(
        `section ${index + 1} ("${title}"): minutes must be from 1 to ${LIMITS.sectionMinutes}.`,
      );
    } else {
      section.minutes = Math.max(1, Math.round(minutes));
    }
  }
  if (typeof raw.objective === 'string') {
    const objective = cleanLine(raw.objective, LIMITS.objectiveChars);
    if (objective) section.objective = objective;
  }
  const slides = readSlideNumbers(raw.slides);
  if (slides.length > 0) section.slides = slides;
  return section;
}

export type DraftRead = { ok: true; draft: LessonPlanDraft } | { ok: false; problems: string[] };

/**
 * The editable part of a plan, checked and capped.
 *
 * A plan with no sections is refused rather than stored: the flow is the point of it,
 * and an empty one would put an empty heading in the trainer's instruction.
 */
export function readDraft(raw: unknown): DraftRead {
  const problems: string[] = [];
  if (!isObject(raw)) return { ok: false, problems: ['the lesson plan must be an object.'] };

  if (!Array.isArray(raw.sections)) {
    problems.push('the lesson plan needs its sections as a list.');
  } else if (raw.sections.length > LIMITS.sections) {
    problems.push(`a lesson plan can have at most ${LIMITS.sections} sections.`);
  }
  if (raw.outcomes !== undefined && !Array.isArray(raw.outcomes)) {
    problems.push('the learning outcomes must be a list.');
  }
  if (problems.length > 0) return { ok: false, problems };

  const sections = (raw.sections as unknown[])
    .map((entry, index) => readSection(entry, index, problems))
    .filter((section): section is LessonPlanSection => section !== null);
  if (problems.length === 0 && sections.length === 0) {
    problems.push('the lesson plan has no sections.');
  }

  const outcomes = ((raw.outcomes as unknown[] | undefined) ?? [])
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => cleanLine(entry, LIMITS.outcomeChars))
    .filter(Boolean)
    .slice(0, LIMITS.outcomes);

  if (problems.length > 0) return { ok: false, problems };

  const draft: LessonPlanDraft = { sections, outcomes };
  if (typeof raw.title === 'string' && cleanLine(raw.title, LIMITS.titleChars)) {
    draft.title = cleanLine(raw.title, LIMITS.titleChars);
  }
  if (typeof raw.sourceName === 'string' && cleanLine(raw.sourceName, LIMITS.titleChars)) {
    draft.sourceName = cleanLine(raw.sourceName, LIMITS.titleChars);
  }
  return { ok: true, draft };
}

function readGap(raw: unknown): LessonPlanGap | null {
  if (!isObject(raw)) return null;
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  switch (raw.kind) {
    case 'missing': {
      const section = text(raw.section);
      return section ? { kind: 'missing', section } : null;
    }
    case 'order': {
      const [section, before] = [text(raw.section), text(raw.before)];
      return section && before ? { kind: 'order', section, before } : null;
    }
    case 'timing': {
      const section = text(raw.section);
      const [planMinutes, deckMinutes] = [count(raw.planMinutes), count(raw.deckMinutes)];
      return section && planMinutes !== null && deckMinutes !== null
        ? { kind: 'timing', section, planMinutes, deckMinutes }
        : null;
    }
    case 'unplanned': {
      const slides = readSlideNumbers(raw.slides);
      return slides.length > 0 ? { kind: 'unplanned', slides } : null;
    }
    default:
      return null;
  }
}

/**
 * The stored alignment, or nothing if it does not read.
 *
 * Lenient where the plan itself is strict: an alignment is worked out from the plan and
 * the slides and can always be worked out again, so one that does not read is dropped
 * and recomputed rather than making the deck unreadable.
 */
function readAlignment(raw: unknown, sectionCount: number): LessonPlanAlignment | undefined {
  if (!isObject(raw) || typeof raw.slidesKey !== 'string') return undefined;
  if (!Array.isArray(raw.sections) || raw.sections.length !== sectionCount) return undefined;
  if (!Array.isArray(raw.gaps)) return undefined;
  return {
    slidesKey: raw.slidesKey,
    sections: raw.sections.map((entry) => ({
      slides: readSlideNumbers(isObject(entry) ? entry.slides : undefined),
    })),
    gaps: raw.gaps.map(readGap).filter((gap): gap is LessonPlanGap => gap !== null),
  };
}

/**
 * A stored plan, read back. Problems are returned for the deck parser to report, in the
 * same way as any other part of a stored deck that does not make sense.
 */
export function readStoredLessonPlan(raw: unknown): {
  plan?: LessonPlan;
  problems: string[];
} {
  const read = readDraft(raw);
  if (!read.ok) return { problems: read.problems.map((problem) => `lessonPlan: ${problem}`) };
  const record = raw as Record<string, unknown>;
  const plan: LessonPlan = {
    ...read.draft,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
  };
  const alignment = readAlignment(record.alignment, plan.sections.length);
  if (alignment) plan.alignment = alignment;
  return { plan, problems: [] };
}
