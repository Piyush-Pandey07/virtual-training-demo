/**
 * Reading an uploaded deck: the teaching pass.
 *
 * The outline pass works out what each page is. This one works out how to teach it,
 * and fills the three fields that reach the spoken prompt directly: what the trainer
 * must get across, what it must not leave the slide without covering, and how it
 * invites the trainee to speak.
 *
 * Until this runs, an analysed deck still carries the draft's placeholder brief,
 * which tells the trainer "this deck has not been analysed yet". That was true when
 * only rendering existed and stopped being true once the outline pass shipped, so a
 * deck could have real titles, summaries and pacing while its brief said otherwise.
 *
 * The quality bar is the hand-authored deck, and the thing worth copying from it is
 * not the length. Slide 1 has four key points in forty seconds and slide 3 has seven
 * in a hundred and twenty-five, so key points are a coverage checklist rather than a
 * running order. What makes that work is the brief carrying the priority: slide 2
 * says "name all six threat categories so the trainee knows the shape of the slide,
 * but do not give all six equal time, because that turns into a list". A checklist
 * without that instruction is a length instruction in disguise, and the model obeys
 * the brief over the word budget.
 */

import 'server-only';

import { GoogleGenAI, Type, type Content, type Part } from '@google/genai';

import { GEMINI_MODEL, requireEnv } from '../config';
import type { DeckMeta, DeckRecord, DeckSlide } from '../deck-types';
import { pageAssetName } from '../decks/asset-paths';
import { assetStore } from '../decks/registry';

/** Bumped when these prompts change enough to produce a different answer. */
export const DETAIL_PROMPT_VERSION = 1;

/** Pages per call. Smaller than the outline pass: each page returns far more text. */
export const DETAIL_BATCH_SIZE = 5;

/** Below this many words a page's text does not say what it is, so its image goes too. */
const WORDS_BEFORE_IMAGE_HELPS = 12;

/** Exactly what the hand-authored deck carries on every slide. */
const DISCUSSION_PROMPTS = 2;

/**
 * How many points a slide may list, from the time it has.
 *
 * A loose bound rather than a tight one, because the hand-authored deck is not
 * proportional: forty seconds carries four points and a hundred and twenty-five
 * carries seven. The cap exists to stop a wall, not to ration coverage, and the
 * brief is what tells the trainer how to weight what is listed.
 */
export function maxKeyPoints(targetSeconds: number): number {
  return Math.min(Math.max(Math.round(targetSeconds / 22), 3), 7);
}

export interface SlideDetail {
  pageNumber: number;
  narrationBrief: string;
  keyPoints: string[];
  discussionPrompts: string[];
}

const SLIDE_DETAIL_SCHEMA = {
  type: Type.OBJECT,
  required: ['slides'],
  properties: {
    slides: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['pageNumber', 'narrationBrief', 'keyPoints', 'discussionPrompts'],
        properties: {
          pageNumber: { type: Type.INTEGER, description: 'The page this describes.' },
          narrationBrief: {
            type: Type.STRING,
            description:
              'How to teach this page, in two to four sentences, written to a colleague who is about to present it. Begin with a verb: an instruction, not a description. "Build the definition in two steps" or "Name all six, then go properly into the two that matter" are briefs. Anything opening "This page", "This slide" or "The page" is a description, and the trainer already has one of those in the slide summary. Not spoken aloud. Say what to spend the time on, and where the page holds more than the time allows, say which one or two to go into properly and let the rest be offered.',
          },
          keyPoints: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'Points the trainer should not leave this page without covering. A coverage checklist, one idea each, drawn from what is on the page. Not a script, and not sentences to read out.',
          },
          discussionPrompts: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              "Exactly two openers the trainer could use to get the trainee talking about this page. Questions a person would actually ask out loud, answerable from the trainee's own working life rather than from the slide, and not checks of whether they understood.",
          },
        },
      },
    },
  },
} as const;

function wordsOn(slide: DeckSlide): number {
  return slide.bullets.reduce((total, line) => total + line.split(/\s+/).filter(Boolean).length, 0);
}

/**
 * The word budget the trainer will actually be held to on this page.
 *
 * Stated in the prompt so the brief and the budget cannot contradict each other. The
 * same arithmetic as spokenWordBudget in trainer-prompt.ts: a hundred and fifty words
 * a minute is a measured speaking pace.
 */
function spokenWords(slide: DeckSlide): number {
  return Math.round((slide.targetSeconds / 60) * 150);
}

function detailPrompt(deck: DeckRecord, meta: DeckMeta, pages: DeckSlide[]): string {
  return `You are preparing a training deck for an AI trainer that speaks aloud to one trainee at a time.

THE DECK
${meta.title}. ${meta.subtitle}
${deck.slides.length} pages in all.

WHAT YOU ARE WRITING
For each page below, three things. None of them is spoken to the trainee: the trainer reads them and decides what to say.

The brief is how to teach the page. The key points are what must be covered. The two prompts are how the trainer gets the trainee talking.

THE PAGES
${pages
  .map((slide) => {
    const lines = slide.bullets.length > 0 ? slide.bullets.join('\n  ') : '(no text on this page)';
    return `--- Page ${slide.id}: ${slide.title} ---
  The trainer has ${slide.targetSeconds} seconds here, which is about ${spokenWords(slide)} spoken words.
  At most ${maxKeyPoints(slide.targetSeconds)} key points.
  Printed on the page:
  ${lines}`;
  })
  .join('\n\n')}

Return one entry per page listed, and no others.

THE THING THAT GOES WRONG
A brief that says explain this and also this and also this is a length instruction wearing a disguise, and the trainer obeys the brief over its word budget. Every page here has a word budget, and most pages carry more than fits.

So when a page lists more than its time allows, say that in the brief and name which one or two are worth going into properly. Leaving material named but unsaid, and offering it, is good teaching rather than a failure to cover the page.

A brief is instructions to a colleague about to present, not a description of the page. This is a real one, quoted for its shape:

"Name all six threat categories so the trainee knows the shape of the slide, but do not give all six equal time, because that turns into a list. Go properly into spear phishing and passwords, with one concrete example each, because those two are where individual behaviour matters most. Cover the other four in a clause apiece. Close by making the point that all six come down to daily habits rather than technology, and offer to go deeper on any of them."

Every sentence there tells the presenter what to do. None of them says what the page contains, because the trainer can already see the page.

Never begin with "This page", "This slide" or "The page". Every one of those is the start of a summary, and a summary is the one thing the trainer does not need from you.

British English throughout: organisation, recognise, prioritise, emphasise, behaviour.

Ground the two prompts in work the audience would recognise: ${meta.exampleDomain}. A prompt must be answerable from their own experience. Never ask whether they understood.`;
}

/** Runs the teaching pass for one batch of pages. */
export async function analyseSlideDetail(
  deck: DeckRecord,
  meta: DeckMeta,
  pageNumbers: number[],
): Promise<SlideDetail[]> {
  const pages = deck.slides.filter((slide) => pageNumbers.includes(slide.id));
  if (pages.length === 0) return [];

  const ai = new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });
  const parts: Part[] = [{ text: detailPrompt(deck, meta, pages) }];

  // Thumbnails, only where the text does not speak for itself. A page at 768 across
  // is one image tile, so attaching every one of them multiplies the cost of reading
  // a deck for pages whose text already says what they are.
  const store = assetStore();
  for (const slide of pages) {
    if (wordsOn(slide) >= WORDS_BEFORE_IMAGE_HELPS) continue;
    const asset = await store.get(deck.meta.id, pageAssetName(slide.id, 'thumb')).catch(() => null);
    if (!asset) continue;
    parts.push({ text: `Image of page ${slide.id}:` });
    parts.push({
      inlineData: {
        mimeType: asset.contentType,
        data: Buffer.from(asset.bytes).toString('base64'),
      },
    });
  }

  const contents: Content[] = [{ role: 'user', parts }];

  const result = await ai.models.generateContent({
    model: GEMINI_MODEL(),
    contents,
    config: {
      responseMimeType: 'application/json',
      responseSchema: SLIDE_DETAIL_SCHEMA,
      temperature: 0.3,
    },
  });

  const text = result.text;
  if (!text) throw new Error('The model returned nothing for this batch of pages.');

  const parsed = JSON.parse(text) as { slides?: SlideDetail[] };
  return Array.isArray(parsed.slides) ? parsed.slides : [];
}

/**
 * A brief that describes the page rather than telling the trainer what to do with it.
 *
 * The opener alone is not the test, which is what the first version of this got
 * wrong. Slide 7 of the hand-authored deck begins "This slide completes the reporting
 * routes with the two phone numbers", and that is an instruction: it says where this
 * page sits relative to the last one. What marks a summary is the verb. "This page
 * covers the four tiers" describes; "this slide completes the routes" directs.
 */
const READS_AS_SUMMARY =
  /^(?:this|the)\s+(?:page|slide)\s+(?:covers|explains|details|describes|outlines|introduces|discusses|presents|shows|lists|summarises|summarizes|is\s+about|provides|contains)\b/i;

/**
 * Applies a batch of teaching detail to the deck.
 *
 * Caps rather than rejects. A model that returns nine key points for a forty second
 * slide has understood the page and misjudged the time, and taking the first few is a
 * better outcome than discarding the lot. The trainer sees what survived on the
 * review screen and can put anything back.
 */
export function mergeSlideDetail(deck: DeckRecord, details: SlideDetail[]): DeckRecord {
  const byPage = new Map<number, SlideDetail>();
  for (const detail of details) {
    if (deck.slides.some((slide) => slide.id === detail.pageNumber)) {
      byPage.set(detail.pageNumber, detail);
    }
  }

  return {
    ...deck,
    slides: deck.slides.map((slide) => {
      const detail = byPage.get(slide.id);
      if (!detail) return slide;

      const brief = detail.narrationBrief?.trim();
      const points = (detail.keyPoints ?? [])
        .map((point) => point?.trim())
        .filter((point): point is string => Boolean(point && point.length > 0))
        .slice(0, maxKeyPoints(slide.targetSeconds));
      const prompts = (detail.discussionPrompts ?? [])
        .map((prompt) => prompt?.trim())
        .filter((prompt): prompt is string => Boolean(prompt && prompt.length > 0))
        .slice(0, DISCUSSION_PROMPTS);

      return {
        ...slide,
        narrationBrief: brief && brief.length > 0 ? brief : slide.narrationBrief,
        keyPoints: points.length > 0 ? points : slide.keyPoints,
        discussionPrompts: prompts.length > 0 ? prompts : slide.discussionPrompts,
      };
    }),
  };
}

/**
 * Whether a brief reads as instructions or as a description.
 *
 * Used by the review screen to flag the ones worth a second look. A brief that opens
 * "This page covers..." is a summary, and the trainer already has one of those in the
 * slide's own summary field; what it needs is what to do about the page.
 */
export function briefReadsAsSummary(brief: string): boolean {
  return READS_AS_SUMMARY.test(brief.trim());
}

/** The batches a deck needs for this pass, in order. */
export function detailBatches(deck: DeckRecord, size = DETAIL_BATCH_SIZE): number[][] {
  const ids = deck.slides.map((slide) => slide.id);
  const batches: number[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    batches.push(ids.slice(index, index + size));
  }
  return batches;
}
