/**
 * Reading an uploaded deck: the expertise pass.
 *
 * The last of the three, and the one that makes an uploaded deck behave like the
 * hand-authored one rather than merely look like it. Without topics a deck is not
 * just shallower, it is differently broken:
 *
 *   - `selectKnowledge` returns nothing, so the trainer has the slide text and no
 *     practitioner knowledge behind it, and says so.
 *   - `bestSlideForQuestion` scores topics, so with none it always returns null and
 *     a question never moves the deck. In the hand-authored deck, asking about
 *     classification while looking at slide 2 brings up slide 5. On an uploaded deck
 *     the trainee stays where they are and the trainer answers about something that
 *     is not on screen.
 *   - `checkReadyToPublish` refuses, which is correct and is why publish has been
 *     shut for every uploaded deck until now.
 *
 * The bar is the hand-authored deck: 22 topics over 7 slides, each carrying about
 * seven triggers, five lines of explanation, two examples, three misconceptions and
 * three questions people actually ask.
 *
 * With one deliberate omission. Twenty of those 22 topics carry ISO clause and Annex
 * A references, and every one was checked by a person. A generated reference is the
 * field a model gets confidently wrong, and a trainee who repeats a wrong control
 * number in an audit has been actively harmed by this tool. So generated topics carry
 * none, and the trainer's existing instruction to say plainly when it is not certain
 * of a number is what covers the gap. Hedging a fabricated number would be worse than
 * not having it.
 */

import 'server-only';

import { GoogleGenAI, Type, type Content } from '@google/genai';

import { GEMINI_MODEL, requireEnv } from '../config';
import type { DeckMeta, DeckRecord, DeckSlide } from '../deck-types';
import { normalise, scoreAgainstQuestion } from '../knowledge';
import type { KnowledgeTopic } from '../knowledge/types';

/** Bumped when these prompts change enough to produce a different answer. */
export const TOPICS_PROMPT_VERSION = 1;

/**
 * Slides per call.
 *
 * Smaller than either earlier pass. A topic carries five explanation lines, examples,
 * misconceptions and questions, so three slides of them is already a long response and
 * six would risk the model thinning every topic to fit.
 */
export const TOPICS_BATCH_SIZE = 3;

/**
 * Topics per slide, from the time the slide has.
 *
 * The hand-authored deck ranges from one topic on a forty second title card to eight
 * on its densest slide, so this is a bound rather than a target. Two per slide is the
 * floor because one topic gives `selectKnowledge` nothing to rank.
 */
export function maxTopicsForSlide(slide: DeckSlide): number {
  if (!slide.teaches) return 1;
  return Math.min(Math.max(Math.round(slide.targetSeconds / 30), 2), 6);
}

/** What the model returns. The id and the priority are assigned here, not asked for. */
export interface GeneratedTopic {
  title: string;
  slideIds: number[];
  triggers: string[];
  explanation: string[];
  examples: string[];
  misconceptions: Array<{ belief: string; correction: string }>;
  faqs: Array<{ q: string; a: string }>;
  outOfScope: string[];
}

const TOPICS_SCHEMA = {
  type: Type.OBJECT,
  required: ['topics'],
  properties: {
    topics: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: [
          'title',
          'slideIds',
          'triggers',
          'explanation',
          'examples',
          'misconceptions',
          'faqs',
          'outOfScope',
        ],
        properties: {
          title: {
            type: Type.STRING,
            description:
              'A short name for this piece of expertise, as a practitioner would refer to it. Four words or so. Not a sentence.',
          },
          slideIds: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description:
              'The pages this expertise belongs to, from the pages you were given. Usually one. Two when the same idea genuinely underpins both.',
          },
          triggers: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'Five to ten words or short phrases that should pull this topic up when a trainee says them. Write what a trainee would actually say out loud, not the formal term: "dodgy email" belongs here as much as "phishing". Single words are matched by prefix, so "classif" catches classification and classify. Multi-word entries are matched as whole phrases. These decide both what the trainer knows and which slide a question moves to, so a topic with vague triggers is one nobody can reach.',
          },
          explanation: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'Four to six things a practitioner knows about this that are not printed on the slide: why the control exists, what actually goes wrong without it, the part most awareness training leaves out. One idea per entry, written to be spoken. Never invent a policy, a figure, a named tool or a contact detail for this organisation.',
          },
          examples: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'Two or three concrete illustrations from the audience\'s own working world. Name the artefact and say what somebody did.',
          },
          misconceptions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['belief', 'correction'],
              properties: {
                belief: { type: Type.STRING, description: 'What trainees genuinely believe, in their words.' },
                correction: { type: Type.STRING, description: 'What an expert says instead, written to be spoken, giving the belief its due first.' },
              },
            },
            description:
              'Two or three beliefs people actually arrive with, each paired with the correction. Almost every misconception is held for a sensible reason, so name the reason rather than contradicting flatly.',
          },
          faqs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['q', 'a'],
              properties: {
                q: { type: Type.STRING, description: "A question trainees really ask, in their own words." },
                a: { type: Type.STRING, description: 'The expert answer, written to be spoken aloud.' },
              },
            },
            description: 'Two or three questions this topic should already have an answer for.',
          },
          outOfScope: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'Things a trainee may reasonably ask about this that only the organisation can answer: a retention period, an approved tool, a named system, an exception process. The trainer names the gap and points at the controlled document instead of guessing. Empty if there are none.',
          },
        },
      },
    },
  },
} as const;

function topicsPrompt(deck: DeckRecord, meta: DeckMeta, pages: DeckSlide[]): string {
  return `You are the expertise behind an AI trainer that delivers ${meta.title} aloud, one trainee at a time.

The trainer already has what is printed on each page. What it does not have, and what you are writing, is what a practitioner brings to the room: why a control exists, what goes wrong without it, the misconceptions people arrive with, and the questions they always ask.

THE AUDIENCE
${meta.ownerDescription}. Ground examples in what they would recognise: ${meta.exampleDomain}.

THE PAGES
${pages
  .map(
    (slide) => `--- Page ${slide.id}: ${slide.title} ---
  At most ${maxTopicsForSlide(slide)} topics for this page.
  ${slide.bullets.length > 0 ? slide.bullets.join('\n  ') : '(no text on this page)'}
  ${slide.keyPoints.length > 0 ? `Must be covered: ${slide.keyPoints.join('; ')}` : ''}`,
  )
  .join('\n\n')}

Write topics only for the pages listed above. Return the most important first: the order is used as the teaching priority when there is not time for all of them.

WHERE YOUR AUTHORITY ENDS
This is general professional knowledge, not ${meta.owner} policy. You do not know this organisation's retention periods, approved tools, named systems, exception processes, contact details or figures, and inventing one is worse than every other mistake available to you, because the trainer will state it as policy and a trainee will act on it. Where a question needs one, put it in outOfScope so the trainer names the gap instead.

Do not cite a standard, a clause or a control number. Not even one you are confident about. A trainee repeating a wrong control number in an audit has been harmed by this, and there is nobody downstream to check it.`;
}

/** Runs the expertise pass for one batch of slides. */
export async function analyseTopics(
  deck: DeckRecord,
  meta: DeckMeta,
  pageNumbers: number[],
): Promise<GeneratedTopic[]> {
  const pages = deck.slides.filter((slide) => pageNumbers.includes(slide.id));
  if (pages.length === 0) return [];

  const ai = new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });
  const contents: Content[] = [
    { role: 'user', parts: [{ text: topicsPrompt(deck, meta, pages) }] },
  ];

  const result = await ai.models.generateContent({
    model: GEMINI_MODEL(),
    contents,
    config: {
      responseMimeType: 'application/json',
      responseSchema: TOPICS_SCHEMA,
      // Higher than the other passes. This one is asked to bring knowledge rather
      // than to extract it, and the extraction passes want determinism that this
      // does not.
      temperature: 0.5,
    },
  });

  const text = result.text;
  if (!text) throw new Error('The model returned nothing for this batch of pages.');

  const parsed = JSON.parse(text) as { topics?: GeneratedTopic[] };
  return Array.isArray(parsed.topics) ? parsed.topics : [];
}

/** A stable, unique id from a title. Assigned here rather than trusted to the model. */
function topicId(title: string, taken: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/, '') || 'topic';

  let id = base;
  let suffix = 2;
  // Two topics can legitimately be named the same thing on different pages, and a
  // duplicate id makes one of them unreachable rather than failing loudly.
  while (taken.has(id)) id = `${base}-${suffix++}`;
  taken.add(id);
  return id;
}

const MAX_TRIGGERS = 12;
const MAX_EXPLANATION = 8;
const MAX_EXAMPLES = 4;
const MAX_MISCONCEPTIONS = 4;
const MAX_FAQS = 4;
const MAX_OUT_OF_SCOPE = 4;

function cleanList(values: unknown, limit: number): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, limit);
}

/**
 * Turns what the model returned into topics the engine can use.
 *
 * Ids and priorities are assigned here. Priority comes from the order returned, ten
 * apart, because `selectKnowledge` sorts on it and only the ordering matters; asking
 * a model for a number on a scale produces numbers with no relationship to each
 * other.
 */
export function toKnowledgeTopics(
  generated: GeneratedTopic[],
  deck: DeckRecord,
  pageNumbers: number[],
  taken: Set<string>,
): KnowledgeTopic[] {
  const valid = new Set(pageNumbers);

  return generated
    .map((raw, index) => {
      const title = raw.title?.trim();
      if (!title) return null;

      // A topic pointing at a page outside the batch, or outside the deck, would fail
      // validation on the way to storage. Dropping the stray id keeps the topic.
      const slideIds = (Array.isArray(raw.slideIds) ? raw.slideIds : [])
        .filter((id): id is number => Number.isInteger(id))
        .filter((id) => valid.has(id) && deck.slides.some((slide) => slide.id === id));

      const triggers = cleanList(raw.triggers, MAX_TRIGGERS);
      const explanation = cleanList(raw.explanation, MAX_EXPLANATION);

      // Both are what make a topic reachable and worth reaching. The deck validator
      // refuses either being empty, so a topic without them cannot be stored anyway.
      if (slideIds.length === 0 || triggers.length === 0 || explanation.length === 0) return null;

      const misconceptions = (Array.isArray(raw.misconceptions) ? raw.misconceptions : [])
        .filter((entry) => entry && typeof entry.belief === 'string' && typeof entry.correction === 'string')
        .map((entry) => ({ belief: entry.belief.trim(), correction: entry.correction.trim() }))
        .filter((entry) => entry.belief && entry.correction)
        .slice(0, MAX_MISCONCEPTIONS);

      const faqs = (Array.isArray(raw.faqs) ? raw.faqs : [])
        .filter((entry) => entry && typeof entry.q === 'string' && typeof entry.a === 'string')
        .map((entry) => ({ q: entry.q.trim(), a: entry.a.trim() }))
        .filter((entry) => entry.q && entry.a)
        .slice(0, MAX_FAQS);

      const topic: KnowledgeTopic = {
        id: topicId(title, taken),
        title: title.slice(0, 120),
        slideIds: [...new Set(slideIds)].sort((a, b) => a - b),
        narrationPriority: (index + 1) * 10,
        triggers,
        explanation,
      };

      const examples = cleanList(raw.examples, MAX_EXAMPLES);
      const outOfScope = cleanList(raw.outOfScope, MAX_OUT_OF_SCOPE);
      if (examples.length > 0) topic.examples = examples;
      if (misconceptions.length > 0) topic.misconceptions = misconceptions;
      if (faqs.length > 0) topic.faqs = faqs;
      if (outOfScope.length > 0) topic.outOfScope = outOfScope;

      // standardRefs is deliberately never set. See the note at the top of this file.
      return topic;
    })
    .filter((topic): topic is KnowledgeTopic => topic !== null);
}

/**
 * A question in the trainee's words, built from what a slide is about.
 *
 * Used to work out which existing topics a slide can be taught from, by asking the
 * retriever the question a trainee looking at that slide would ask.
 */
function questionForSlide(slide: DeckSlide): string {
  return [slide.title, ...slide.keyPoints, ...slide.bullets.slice(0, 6)].join(' ');
}

/**
 * Attaches topics to slides they can teach but were not assigned to.
 *
 * The model assigns a topic to the page it was written from, which leaves slides
 * whose material is genuinely covered elsewhere with nothing behind them, and a
 * teaching slide with no topic is what `checkReadyToPublish` refuses.
 *
 * The assignment uses `scoreAgainstQuestion`, which is the same function the trainer
 * uses at run time to decide what a question reaches for. That is the point of doing
 * it this way: a topic attached here is one the retriever would genuinely have found,
 * so the two cannot disagree about what a slide can be taught from.
 */
export function backfillSlideIds(deck: DeckRecord): DeckRecord {
  if (deck.topics.length === 0) return deck;

  const topics = deck.topics.map((topic) => ({ ...topic, slideIds: [...topic.slideIds] }));

  for (const slide of deck.slides) {
    if (!slide.teaches) continue;
    if (topics.some((topic) => topic.slideIds.includes(slide.id))) continue;

    const question = normalise(questionForSlide(slide));
    let best: { topic: (typeof topics)[number]; score: number } | null = null;

    for (const topic of topics) {
      const score = scoreAgainstQuestion(topic, question);
      if (score > 0 && (!best || score > best.score)) best = { topic, score };
    }

    // Only when something genuinely matches. Attaching the least-bad topic to a slide
    // it has nothing to do with would satisfy the publish check and mislead the
    // trainer, which is worse than the check refusing.
    if (best) {
      best.topic.slideIds = [...best.topic.slideIds, slide.id].sort((a, b) => a - b);
    }
  }

  return { ...deck, topics };
}

/** Replaces the deck's topics for the given pages, leaving the rest alone. */
export function mergeTopics(
  deck: DeckRecord,
  pageNumbers: number[],
  generated: GeneratedTopic[],
): DeckRecord {
  const pages = new Set(pageNumbers);

  // A re-run of one batch replaces that batch's topics rather than duplicating them.
  const kept = deck.topics.filter((topic) => !topic.slideIds.some((id) => pages.has(id)));
  const taken = new Set(kept.map((topic) => topic.id));
  const added = toKnowledgeTopics(generated, deck, pageNumbers, taken);

  return { ...deck, topics: [...kept, ...added] };
}

/** The batches a deck needs for this pass, teaching slides only. */
export function topicBatches(deck: DeckRecord, size = TOPICS_BATCH_SIZE): number[][] {
  // A cover page teaches nothing, so it needs no expertise and the publish check does
  // not ask for any.
  const ids = deck.slides.filter((slide) => slide.teaches).map((slide) => slide.id);
  const batches: number[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    batches.push(ids.slice(index, index + size));
  }
  return batches;
}
