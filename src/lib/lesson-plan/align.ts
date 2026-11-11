/**
 * Lining a lesson plan up with a deck, and finding where they differ (AI-43).
 *
 * Done once, when the plan is saved, and stored beside it: never per turn. Matching is
 * by words, not by a model, because it has to be explainable to the administrator who
 * checks it, it costs nothing to repeat when the slides change, and the administrator
 * can overrule it section by section ("Slides: 4-5") wherever it guesses wrong.
 *
 * Each slide goes to the section whose title, and less strongly whose objective, its own
 * title and text share the most distinctive words with. Distinctive because in a data
 * centre deck "data" and "centre" are on every slide and say nothing about which
 * section a slide belongs to, so a word counts for less the more slides carry it.
 *
 * Pure, with no I/O, so the tests drive it directly.
 */

import type { DeckRecord, DeckSlide } from '../deck-types';
import type { LessonPlan, LessonPlanAlignment, LessonPlanGap, LessonPlanSection } from './types';

/**
 * Bumped when matching changes, so an alignment stored by an older build is worked out
 * again rather than trusted.
 */
const ALIGNMENT_VERSION = 1;

/** The least a slide must share with a section to belong to it. */
const MIN_SCORE = 0.8;

/** How far a section's slides may run past its time before it does not fit. */
const OVER_TIME = 1.25;
/**
 * How little of its time a section's slides may fill before the plan expects something
 * the deck does not have. The plan's time includes discussion and the deck's is
 * narration alone, so only a large shortfall is worth telling anybody about.
 */
const UNDER_TIME = 0.15;

const STOPWORDS = new Set(
  (
    'a an the and or of to in on for with at by from is are be been what how why when where ' +
    'which who it its this that these those into your our their we you they as about using use ' +
    'can will should must not no all any each more most other such than then there so if but ' +
    'do does did has have had i me my part section module session slide slides lesson plan ' +
    'minute minutes min mins time understand explain describe know learn learners participants ' +
    'group trainee trainees cover covers covering through'
  ).split(' '),
);

/** Words that open a session, which a cover slide serves even when it shares none of them. */
const OPENING =
  /\b(introduction|intro|welcome|opening|overview|agenda|objectives?|housekeeping)\b/i;
/** Words that close one, which a closing slide serves. */
const CLOSING =
  /\b(summary|summarise|recap|review|close|closing|wrap|conclusion|conclude|takeaways?|questions|q&a|next steps)\b/i;

/** A word reduced to something two spellings of it share. */
function stem(word: string): string {
  let w = word.toLowerCase();
  if (w === 'center' || w === 'centers') return 'centre';
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith('es') && /(ches|shes|xes|sses)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

export function tokens(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[’']/g, '')
        .split(/[^a-z0-9+]+/)
        .filter((word) => word.length > 1 && !STOPWORDS.has(word))
        .map(stem)
        .filter((word) => !STOPWORDS.has(word)),
    ),
  ];
}

/** Two words as the same word: equal, or sharing most of a long enough start. */
function same(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 4) return false;
  let common = 0;
  while (common < shorter && a[common] === b[common]) common += 1;
  return common >= 4 && common >= shorter * 0.8;
}

function has(words: readonly string[], word: string): boolean {
  return words.some((entry) => same(entry, word));
}

/** A short, stable hash, so the key is small and the same on both sides. */
function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Which slides an alignment was worked out against: everything matching reads. */
export function slidesKey(slides: readonly DeckSlide[]): string {
  const read = slides.map((slide) => [
    slide.id,
    slide.title,
    slide.shortLabel,
    slide.summary,
    slide.bullets,
    slide.role ?? '',
    slide.teaches,
    slide.targetSeconds,
  ]);
  return `v${ALIGNMENT_VERSION}-${slides.length}-${fnv(JSON.stringify(read))}`;
}

interface SlideWords {
  slide: DeckSlide;
  index: number;
  title: string[];
  body: string[];
}

function sectionScore(
  section: LessonPlanSection,
  slide: SlideWords,
  weight: (word: string) => number,
): number {
  const title = tokens(section.title);
  const objective = tokens(section.objective ?? '').filter((word) => !has(title, word));
  let score = 0;
  for (const [words, importance] of [
    [title, 1],
    [objective, 0.35],
  ] as const) {
    for (const word of words) {
      if (has(slide.title, word)) score += importance * weight(word);
      else if (has(slide.body, word)) score += importance * weight(word) * 0.3;
    }
  }
  if (OPENING.test(section.title) && (slide.slide.role === 'title' || slide.index === 0)) {
    score += 2;
  }
  if (CLOSING.test(section.title) && slide.slide.role === 'closing') score += 2;
  return score;
}

/** Whether a slide is ordinary teaching material, which a plan ought to account for. */
function isTeaching(slide: DeckSlide): boolean {
  return slide.teaches && (slide.role === undefined || slide.role === 'content');
}

/**
 * The plan against the deck: which slides serve each section, and every gap.
 */
export function alignLessonPlan(
  plan: Pick<LessonPlan, 'sections'>,
  deck: Pick<DeckRecord, 'slides'>,
): LessonPlanAlignment {
  const slides: SlideWords[] = deck.slides.map((slide, index) => ({
    slide,
    index,
    title: tokens(`${slide.title} ${slide.shortLabel}`),
    body: tokens(
      [slide.summary, ...slide.bullets, ...slide.keyPoints, slide.narrationBrief].join(' '),
    ),
  }));

  // A word on every slide tells no slide apart from another.
  const weight = (word: string) => {
    const carrying = slides.filter((entry) => has(entry.title, word) || has(entry.body, word));
    return Math.log(1 + slides.length / (1 + carrying.length));
  };

  const ids = new Set(deck.slides.map((slide) => slide.id));
  const assigned: number[][] = plan.sections.map((section) =>
    (section.slides ?? []).filter((id) => ids.has(id)),
  );
  const pinned = new Set(assigned.flat());

  // Each slide the administrator did not pin goes to the section it matches best, if
  // any matches well enough. Sections the administrator pinned are left as they are.
  const owner = new Map<number, number>();
  plan.sections.forEach((_, sectionIndex) => {
    for (const id of assigned[sectionIndex]) owner.set(id, sectionIndex);
  });
  for (const entry of slides) {
    if (pinned.has(entry.slide.id)) continue;
    let best: { section: number; score: number } | null = null;
    plan.sections.forEach((section, sectionIndex) => {
      if (section.slides && section.slides.length > 0) return;
      const score = sectionScore(section, entry, weight);
      if (score >= MIN_SCORE && (!best || score > best.score)) {
        best = { section: sectionIndex, score };
      }
    });
    if (best) owner.set(entry.slide.id, (best as { section: number }).section);
  }

  // A slide that matched nothing, between two slides of the same section, is part of it:
  // a section's second slide often carries the detail and not the section's words. And a
  // divider belongs to whatever follows it.
  for (const entry of slides) {
    const id = entry.slide.id;
    if (owner.has(id)) continue;
    const before = slides
      .slice(0, entry.index)
      .reverse()
      .find((other) => owner.has(other.slide.id));
    const after = slides.slice(entry.index + 1).find((other) => owner.has(other.slide.id));
    if (before && after && owner.get(before.slide.id) === owner.get(after.slide.id)) {
      owner.set(id, owner.get(before.slide.id)!);
    } else if (entry.slide.role === 'divider' && after) {
      owner.set(id, owner.get(after.slide.id)!);
    }
  }

  const sections = plan.sections.map((section, sectionIndex) =>
    section.slides && section.slides.length > 0
      ? assigned[sectionIndex]
      : deck.slides
          .filter((slide) => owner.get(slide.id) === sectionIndex)
          .map((slide) => slide.id),
  );

  const gaps: LessonPlanGap[] = [];
  const position = new Map(deck.slides.map((slide, index) => [slide.id, index]));

  plan.sections.forEach((section, sectionIndex) => {
    if (sections[sectionIndex].length === 0) gaps.push({ kind: 'missing', section: section.title });
  });

  // Each section against the one the plan puts before it, among those the deck has.
  let previous: { title: string; first: number } | null = null;
  plan.sections.forEach((section, sectionIndex) => {
    const slideIds = sections[sectionIndex];
    if (slideIds.length === 0) return;
    const first = Math.min(...slideIds.map((id) => position.get(id) ?? 0));
    if (previous && first < previous.first) {
      gaps.push({ kind: 'order', section: section.title, before: previous.title });
    }
    previous = { title: section.title, first };
  });

  plan.sections.forEach((section, sectionIndex) => {
    const slideIds = sections[sectionIndex];
    if (!section.minutes || slideIds.length === 0) return;
    const served = deck.slides.filter((slide) => slideIds.includes(slide.id));
    const seconds = served.reduce((total, slide) => total + slide.targetSeconds, 0);
    const planned = section.minutes * 60;
    // A section served only by a cover or a closing page is the welcome or the questions,
    // which are spent talking rather than teaching, so only running over counts there.
    const short = served.some(isTeaching) && seconds < planned * UNDER_TIME;
    if (seconds > planned * OVER_TIME || short) {
      gaps.push({
        kind: 'timing',
        section: section.title,
        planMinutes: section.minutes,
        deckMinutes: Math.max(1, Math.round(seconds / 60)),
      });
    }
  });

  const covered = new Set(sections.flat());
  const unplanned = deck.slides
    .filter((slide) => isTeaching(slide) && !covered.has(slide.id))
    .map((slide) => slide.id);
  if (unplanned.length > 0) gaps.push({ kind: 'unplanned', slides: unplanned });

  return {
    slidesKey: slidesKey(deck.slides),
    sections: sections.map((slideIds) => ({ slides: slideIds })),
    gaps,
  };
}

/**
 * The deck's alignment as it stands: the stored one while the slides are as they were
 * when it was worked out, and worked out again when they are not.
 *
 * A re-analysis or an edit to a slide's title changes what matches, and the plan is not
 * saved again when that happens, so the stored answer is checked rather than trusted.
 * Working it out again is cheap and touches nothing.
 */
export function alignmentFor(deck: DeckRecord): LessonPlanAlignment | undefined {
  const plan = deck.lessonPlan;
  if (!plan || plan.sections.length === 0) return undefined;
  const stored = plan.alignment;
  if (
    stored &&
    stored.sections.length === plan.sections.length &&
    stored.slidesKey === slidesKey(deck.slides)
  ) {
    return stored;
  }
  return alignLessonPlan(plan, deck);
}

/** Where a slide sits in the plan, or undefined if the deck has no plan or it is in none. */
export function sectionOfSlide(
  deck: DeckRecord,
  slideId: number,
): { number: number; section: LessonPlanSection; slides: number[] } | undefined {
  const alignment = alignmentFor(deck);
  if (!alignment || !deck.lessonPlan) return undefined;
  const index = alignment.sections.findIndex((entry) => entry.slides.includes(slideId));
  if (index < 0) return undefined;
  return {
    number: index + 1,
    section: deck.lessonPlan.sections[index],
    slides: alignment.sections[index].slides,
  };
}
