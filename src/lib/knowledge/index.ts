/**
 * Knowledge selection and rendering.
 *
 * The whole base is far too large to send on every turn, and sending all of it
 * would dilute the model's attention as well as costing latency. So each turn
 * gets the topics that belong to the slide on screen, plus anything a question
 * reaches for, plus a one-line index of everything else so the trainer knows what
 * it could go deeper on if asked.
 *
 * The topics arrive with the deck. They used to be five modules imported here and
 * flattened into a module-scope array, which was fine while there was one deck and
 * impossible once a trainer uploads their own.
 */

import 'server-only';

import { getSlide } from '../deck';
import type { DeckRecord } from '../deck-types';
import type { KnowledgeTopic, SelectedTopic } from './types';

export type { KnowledgeTopic, SelectedTopic } from './types';

export function getTopic(deck: DeckRecord, id: string): KnowledgeTopic | undefined {
  return deck.topics.find((topic) => topic.id === id);
}

export function topicsForSlide(deck: DeckRecord, slideId: number): KnowledgeTopic[] {
  return deck.topics.filter((topic) => topic.slideIds.includes(slideId));
}

/**
 * Normalises text for trigger matching. Punctuation becomes whitespace so that
 * "wi-fi?" and "wi fi" both match a "wi-fi" trigger.
 */
function normalise(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/**
 * Scores a topic against a question.
 *
 * Single-word triggers match on word prefix, so the stem "classif" catches
 * "classification" and "classify", and "tailgat" catches "tailgating". Matching
 * whole words only meant every stem trigger in the base was dead: a question about
 * classification scored zero against the classification topic.
 *
 * Multi-word triggers still match as phrases, since "client site" should not fire
 * on "client" alone.
 */
export function scoreAgainstQuestion(topic: KnowledgeTopic, normalisedQuestion: string): number {
  let score = 0;
  const questionWords = normalisedQuestion.trim().split(' ');

  for (const trigger of topic.triggers) {
    const needle = normalise(trigger).trim();
    if (!needle) continue;

    const hit = needle.includes(' ')
      ? normalisedQuestion.includes(` ${needle} `)
      : questionWords.some((word) => word.startsWith(needle));

    if (hit) {
      // Longer, more specific triggers are stronger evidence than short ones.
      score += trigger.length >= 8 ? 3 : 2;
    }
  }
  // A question that names something from a worked example is usually about it.
  for (const faq of topic.faqs ?? []) {
    const words = normalise(faq.q).trim().split(' ');
    const salient = words.filter((word) => word.length > 5);
    const hits = salient.filter((word) => normalisedQuestion.includes(` ${word} `)).length;
    if (salient.length > 0 && hits >= Math.max(2, Math.ceil(salient.length * 0.4))) score += 2;
  }
  return score;
}

/** How many topics from other slides a question may pull in. */
const MAX_RETRIEVED = 3;

/**
 * A cross-slide topic needs more than one weak lexical hit before it earns a
 * place. Without this, a question about a client site survey drags in the
 * public-browsing topic purely because "client site" appears in both.
 */
const MIN_CROSS_SLIDE_SCORE = 3;

/**
 * How many of the current slide's topics stay at full depth on a question turn.
 * Slides 2 and 4 carry six and eight topics respectively, and rendering all of
 * them at full depth to answer one narrow question buries the answer.
 */
const MAX_CORE_ON_QUESTION = 3;

/**
 * How many of a slide's topics are taught at full depth when narrating it.
 *
 * Derived from the time the slide has, not a constant. A topic taught properly,
 * with the one example that makes it land, costs roughly thirty-five seconds, so
 * a slide budgeted at two and a half minutes can carry four and a forty second
 * title card cannot carry four whatever the deck says. The old constant was 4 for
 * every slide and was documented as being sized for one particular slide of one
 * particular deck.
 *
 * Floored at 2 so a short slide still gets a second idea, capped at 5 because
 * beyond that the model stops choosing and starts listing.
 */
function maxCoreOnNarration(targetSeconds: number): number {
  const affordable = Math.round(targetSeconds / 35);
  return Math.min(Math.max(affordable, 2), 5);
}

/**
 * How many topics a recap or quiz gets at full depth.
 *
 * A closing turn is one turn. It needs a handful of things to say properly, not
 * the whole base, and the trainer already has a one-line index of everything it
 * knows in its system instruction.
 */
const MAX_CORE_ON_WHOLE_DECK = 5;

/**
 * How many topics a whole-deck turn names in one line before it stops listing.
 *
 * The remainder is reported as a count rather than silently dropped, so the
 * trainer knows there is more it could offer.
 */
const MAX_HEADLINE_ON_WHOLE_DECK = 20;

export interface SelectKnowledgeArgs {
  deck: DeckRecord;
  slideId: number;
  /** Present for question-answering turns. */
  question?: string;
  /**
   * True for a recap or quiz, where the turn ranges over the session rather than
   * over the slide on screen.
   */
  wholeDeck?: boolean;
  /**
   * Slides actually taught. On a whole-deck turn this bounds what the trainer may
   * draw on, because a recap of material the trainee never saw is worse than a
   * short recap.
   */
  coveredSlideIds?: number[];
}

/**
 * Chooses the topics for one turn.
 *
 * `core` topics are rendered at full depth and drive the turn. `supporting` ones
 * are rendered compactly and are there in case they are needed.
 *
 * On a narration turn every topic belonging to the slide is core, because the job
 * is to teach the whole slide. On a question turn the slide's topics compete on
 * relevance: the ones the question actually reaches for stay at full depth and
 * the rest are demoted, so the answer is not buried under the other five threats.
 */
export function selectKnowledge({
  deck,
  slideId,
  question,
  wholeDeck,
  coveredSlideIds,
}: SelectKnowledgeArgs): SelectedTopic[] {
  const selected: SelectedTopic[] = [];
  const taken = new Set<string>();
  const slideTopics = topicsForSlide(deck, slideId);
  const asked = question?.trim();

  if (!asked) {
    // Narration. The slide's most important topics go in at depth and the rest
    // travel compactly.
    //
    // Handing over every topic on a busy slide was the actual cause of narration
    // running fifty per cent past its budget: slide 2 carries seven topics and
    // 27,000 characters, and the model used what it was given however the prompt
    // was worded. Choosing here is more effective than asking it to be brief, and
    // nothing is lost, because the demoted topics are still present and the slide's
    // own key points still name everything on screen.
    const ranked = [...slideTopics].sort(
      (a, b) => (a.narrationPriority ?? 50) - (b.narrationPriority ?? 50),
    );

    const cap = maxCoreOnNarration(getSlide(deck, slideId)?.targetSeconds ?? 120);

    ranked.forEach((topic, index) => {
      const core = index < cap;
      selected.push({
        topic,
        weight: core ? 'core' : 'supporting',
        reason: core ? `on slide ${slideId}` : `on slide ${slideId}, beyond the narration budget`,
      });
      taken.add(topic.id);
    });
  } else {
    const normalised = normalise(asked);

    // Rank this slide's own topics by how well they answer the question.
    const ranked = slideTopics
      .map((topic) => ({ topic, score: scoreAgainstQuestion(topic, normalised) }))
      .sort((a, b) => b.score - a.score);

    const matched = ranked.filter((entry) => entry.score > 0);
    // If nothing on the slide matches, keep a couple anyway so the trainer still
    // has the context of what the trainee is looking at.
    const promoted = (matched.length > 0 ? matched : ranked).slice(0, MAX_CORE_ON_QUESTION);
    const promotedIds = new Set(promoted.map((entry) => entry.topic.id));

    for (const { topic, score } of promoted) {
      selected.push({
        topic,
        weight: 'core',
        reason: score > 0 ? `on slide ${slideId}, matched the question` : `on slide ${slideId}`,
      });
      taken.add(topic.id);
    }
    for (const topic of slideTopics) {
      if (promotedIds.has(topic.id)) continue;
      selected.push({ topic, weight: 'supporting', reason: `also on slide ${slideId}` });
      taken.add(topic.id);
    }

    // Then anything from elsewhere in the deck that the question reaches for.
    const crossSlide = deck.topics
      .filter((topic) => !taken.has(topic.id))
      .map((topic) => ({ topic, score: scoreAgainstQuestion(topic, normalised) }))
      .filter((entry) => entry.score >= MIN_CROSS_SLIDE_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RETRIEVED);

    for (const { topic, score } of crossSlide) {
      selected.push({
        topic,
        weight: 'supporting',
        reason: `matched the question from another slide (score ${score})`,
      });
      taken.add(topic.id);
    }
  }

  /**
   * A recap or quiz ranges over the session, which is not the same as the deck.
   *
   * This used to add every topic in the base at the compact weight. Two things
   * were wrong with that. It let the trainer recap or examine material the trainee
   * never saw, which reads as a session that was not paying attention. And on a
   * sixty slide deck it was around a hundred thousand tokens of expertise per
   * turn, nearly all of it unused, pushing what the trainer actually needed
   * further from its attention.
   *
   * So it is bounded twice: to what was taught, and then to what one closing turn
   * can honestly use.
   */
  if (wholeDeck) {
    const covered = new Set(
      coveredSlideIds && coveredSlideIds.length > 0 ? coveredSlideIds : [slideId],
    );

    const fromCovered = deck.topics
      .filter((topic) => !taken.has(topic.id))
      .filter((topic) => topic.slideIds.some((id) => covered.has(id)))
      .sort((a, b) => (a.narrationPriority ?? 50) - (b.narrationPriority ?? 50));

    const alreadyCore = selected.filter((entry) => entry.weight === 'core').length;
    const coreRoom = Math.max(0, MAX_CORE_ON_WHOLE_DECK - alreadyCore);

    fromCovered.forEach((topic, index) => {
      if (index < coreRoom) {
        selected.push({ topic, weight: 'core', reason: 'covered in this session' });
      } else if (index < coreRoom + MAX_HEADLINE_ON_WHOLE_DECK) {
        selected.push({ topic, weight: 'headline', reason: 'covered in this session' });
      } else {
        return;
      }
      taken.add(topic.id);
    });
  }

  return selected;
}

/**
 * A slide must beat the current one by this margin before the deck is moved.
 * Without a margin, a passing lexical hit on another slide would yank the
 * trainee's screen away from what they were looking at. Scores land in the low
 * single digits, so the margin is deliberately small.
 */
const NAV_SCORE_MARGIN = 2;

/** Below this, a match is too weak to move the deck on. */
const NAV_MIN_SCORE = 2;

export interface SlideMatch {
  slideId: number;
  score: number;
}

/**
 * Works out which slide a question is really about.
 *
 * This replaces asking the model to call a navigation tool. Gemini does not emit
 * speech in the same turn as a tool call, and repairing that with a second pass
 * proved unreliable: the model would sometimes acknowledge the move instead of
 * teaching. Deciding here is deterministic, testable, needs one pass, and keeps
 * the reply streaming from the first token.
 *
 * Returns null when the question belongs on the slide already showing, or when no
 * other slide is a clearly better fit.
 */
export function bestSlideForQuestion(
  deck: DeckRecord,
  question: string,
  currentSlideId: number,
): SlideMatch | null {
  const asked = question.trim();
  if (!asked) return null;

  const normalised = normalise(asked);
  const bySlide = new Map<number, number>();

  for (const topic of deck.topics) {
    const score = scoreAgainstQuestion(topic, normalised);
    if (score <= 0) continue;
    // A topic can support more than one slide, so credit each of them.
    for (const slideId of topic.slideIds) {
      bySlide.set(slideId, Math.max(bySlide.get(slideId) ?? 0, score));
    }
  }

  const currentScore = bySlide.get(currentSlideId) ?? 0;

  let best: SlideMatch | null = null;
  for (const [slideId, score] of bySlide) {
    if (slideId === currentSlideId) continue;
    // A title card or section divider teaches nothing, so a question must never
    // land the trainee on one, even when a topic legitimately lists it.
    if (getSlide(deck, slideId)?.teaches === false) continue;
    if (score < NAV_MIN_SCORE) continue;
    if (score < currentScore + NAV_SCORE_MARGIN) continue;
    // On a tie, the earlier slide wins. Where a topic spans consecutive slides,
    // the first is normally the one that introduces it and the later ones are the
    // continuation, so the introduction is the better place to send someone.
    if (!best || score > best.score || (score === best.score && slideId < best.slideId)) {
      best = { slideId, score };
    }
  }

  return best;
}

/** Renders one topic at full depth, for the material the turn is built on. */
function renderCore(topic: KnowledgeTopic): string {
  const lines: string[] = [`### ${topic.title}`];

  lines.push('', 'What you know about this:');
  lines.push(...topic.explanation.map((line) => `- ${line}`));

  if (topic.examples?.length) {
    lines.push('', 'Illustrations you can draw on:');
    lines.push(...topic.examples.map((line) => `- ${line}`));
  }
  if (topic.analogy) {
    lines.push('', `Analogy that tends to land: ${topic.analogy}`);
  }
  if (topic.misconceptions?.length) {
    lines.push('', 'Beliefs to correct if they come up:');
    lines.push(
      ...topic.misconceptions.map(
        (m) => `- They may think: "${m.belief}" You say: ${m.correction}`,
      ),
    );
  }
  if (topic.standardRefs?.length) {
    lines.push('', 'Standard references, for a trainee who asks for the clause:');
    lines.push(...topic.standardRefs.map((line) => `- ${line}`));
  }
  if (topic.faqs?.length) {
    lines.push('', 'Questions you should already have an answer for:');
    lines.push(...topic.faqs.map((f) => `- Q: ${f.q}\n  A: ${f.a}`));
  }
  if (topic.outOfScope?.length) {
    lines.push('', 'Not settled by this deck. Name the gap rather than guessing:');
    lines.push(...topic.outOfScope.map((line) => `- ${line}`));
  }

  return lines.join('\n');
}

/** Renders a topic compactly, for context that may or may not be needed. */
function renderSupporting(topic: KnowledgeTopic): string {
  const lines: string[] = [`### ${topic.title} (slide ${topic.slideIds.join(', ')})`];
  lines.push(...topic.explanation.slice(0, 4).map((line) => `- ${line}`));
  if (topic.misconceptions?.length) {
    const m = topic.misconceptions[0];
    lines.push(`- Common error: "${m.belief}" Correct it with: ${m.correction}`);
  }
  if (topic.faqs?.length) {
    lines.push(...topic.faqs.slice(0, 2).map((f) => `- Q: ${f.q}\n  A: ${f.a}`));
  }
  if (topic.standardRefs?.length) {
    lines.push(`- Reference: ${topic.standardRefs[0]}`);
  }
  if (topic.outOfScope?.length) {
    lines.push(`- Not in this deck: ${topic.outOfScope[0]}`);
  }
  return lines.join('\n');
}

/**
 * Names a topic and nothing more.
 *
 * Enough for the trainer to know it covered this and to offer to go back to it.
 * The compact form is roughly fifteen times longer and, on a whole-deck turn,
 * almost never used.
 */
function renderHeadline(topic: KnowledgeTopic): string {
  return `- ${topic.title} (slide ${topic.slideIds.join(', ')})`;
}

/**
 * What the core block is describing.
 *
 * A narration or answer turn is about the slide in front of the trainee. A recap
 * or quiz is about the session, and on those turns the core topics are drawn from
 * everything taught, so telling the model they are what is on screen is simply
 * false and invites it to talk about slide seven as though it covered slide two.
 */
export type KnowledgeScope = 'slide' | 'session';

const CORE_HEADING: Record<KnowledgeScope, string> = {
  slide: 'YOUR EXPERTISE ON WHAT IS CURRENTLY ON SCREEN',
  session: 'YOUR EXPERTISE ON WHAT YOU COVERED WITH THEM',
};

/** Turns the selection into the block that goes into the prompt. */
export function renderKnowledge(
  selected: SelectedTopic[],
  scope: KnowledgeScope = 'slide',
): string {
  if (selected.length === 0) return '';

  const core = selected.filter((entry) => entry.weight === 'core');
  const supporting = selected.filter((entry) => entry.weight === 'supporting');
  const headline = selected.filter((entry) => entry.weight === 'headline');

  const sections: string[] = [];

  if (core.length > 0) {
    sections.push(
      CORE_HEADING[scope],
      'This is your own knowledge as a practitioner, not text from the slide. Teach from it. Do not read it out, do not work through it as a list, and do not try to use all of it. Choose what this trainee needs.',
      '',
      core.map((entry) => renderCore(entry.topic)).join('\n\n'),
    );
  }

  if (supporting.length > 0) {
    sections.push(
      '',
      'FURTHER EXPERTISE YOU CAN REACH FOR',
      'Relevant to the question or to the wider deck. Use it only where it helps.',
      '',
      supporting.map((entry) => renderSupporting(entry.topic)).join('\n\n'),
    );
  }

  if (headline.length > 0) {
    sections.push(
      '',
      'ALSO COVERED IN THIS SESSION',
      'You taught these and can offer to go back to any of them. You have the detail if they ask.',
      '',
      headline.map((entry) => renderHeadline(entry.topic)).join('\n'),
    );
  }

  return sections.join('\n');
}

/** A one-line index of everything, so the trainer knows the shape of what it knows. */
export function renderTopicIndex(deck: DeckRecord): string {
  return deck.topics
    .map((topic) => `- ${topic.title} (slide ${topic.slideIds.join(', ')})`)
    .join('\n');
}
