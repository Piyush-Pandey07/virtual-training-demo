/**
 * Reading an uploaded deck: the outline pass.
 *
 * Takes a deck that has been rendered but not understood and works out what it is.
 * Two questions, asked separately because they need different context.
 *
 * The deck-level question needs to see the whole deck at once, so it gets one line
 * per page and answers who the deck belongs to, what it is about, and how the
 * trainer should introduce themselves. Those strings are spoken aloud, so this is
 * the half where an invented fact does real damage.
 *
 * The slide-level question needs each page's actual text, so it runs in batches. A
 * batch is given the deck-level answer as context, which is what stops slide 30
 * being summarised as though it were the start of a different deck.
 *
 * Everything comes back through a response schema rather than parsed out of prose.
 * With structured output the failure mode is a validation error, which is
 * recoverable; with prose it is a plausible-looking string in a field that gets read
 * out to a trainee.
 */

import 'server-only';

import { GoogleGenAI, Type, type Content, type Part } from '@google/genai';

import { GEMINI_MODEL, requireEnv } from '../config';
import type { DeckMeta, DeckRecord, DeckSlide, SlideRole } from '../deck-types';
import { assetStore } from '../decks/registry';
import { pageAssetName } from '../decks/asset-paths';

/**
 * Bumped when the prompts or schemas change in a way that would produce a different
 * answer. Recorded on the deck so a re-analysis can be offered where it would help.
 */
export const OUTLINE_PROMPT_VERSION = 1;

/** Pages per slide-detail call. */
export const OUTLINE_BATCH_SIZE = 10;

/**
 * Below this many words, a page's text does not say what the page is, so its
 * thumbnail is attached.
 *
 * Attaching every thumbnail would be simpler and six times the cost: a page at 768
 * across is one image tile, and sixty of those is most of the budget for reading a
 * deck. Most pages have text that speaks for itself; the ones that do not are
 * usually a diagram, and those are exactly the ones worth looking at.
 */
const WORDS_BEFORE_IMAGE_HELPS = 12;

/** What one page contributes to a whole-deck view. */
function pageHeadline(slide: DeckSlide): string {
  const first = slide.bullets.find((line) => line.trim().length > 0) ?? '(no text)';
  return `Page ${slide.id}: ${first.slice(0, 120)}`;
}

function wordsOn(slide: DeckSlide): number {
  return slide.bullets.reduce((total, line) => total + line.split(/\s+/).filter(Boolean).length, 0);
}

// ===========================================================================
// The deck-level pass
// ===========================================================================

export interface DeckMetaAnalysis {
  title: string;
  subtitle: string;
  spokenSubject: string;
  owner: string;
  /**
   * Whether the deck itself names the organisation.
   *
   * The single most important field here. Without it the model will happily supply a
   * plausible company name, which then gets spoken to a trainee as "the deck is the
   * authority on Acme policy". When this is false the neutral placeholder is kept.
   */
  ownerNamedInDeck: boolean;
  ownerDescription: string;
  trainerRole: string;
  practitionerCredential: string;
  exampleDomain: string;
  exampleContext: string;
  closingReminder: string;
}

const DECK_META_SCHEMA = {
  type: Type.OBJECT,
  required: [
    'title',
    'subtitle',
    'spokenSubject',
    'owner',
    'ownerNamedInDeck',
    'ownerDescription',
    'trainerRole',
    'practitionerCredential',
    'exampleDomain',
    'exampleContext',
    'closingReminder',
  ],
  properties: {
    title: { type: Type.STRING, description: 'The deck title, as printed on it.' },
    subtitle: {
      type: Type.STRING,
      description: 'One line saying what this covers. From the deck, not invented.',
    },
    spokenSubject: {
      type: Type.STRING,
      description:
        'How a trainer would say the subject out loud, mid-sentence, in lower case. No slashes or abbreviations a voice would mangle. For example "ISO 27001 information security management system awareness".',
    },
    owner: {
      type: Type.STRING,
      description:
        'The organisation whose deck this is, exactly as printed. If the deck never names one, return the words "your organisation" and set ownerNamedInDeck to false.',
    },
    ownerNamedInDeck: {
      type: Type.BOOLEAN,
      description: 'True only if the organisation is actually named somewhere in the deck.',
    },
    ownerDescription: {
      type: Type.STRING,
      description:
        'A short noun phrase for what the organisation does, starting with "a" or "an", only if the deck says. Otherwise "the organisation this deck belongs to".',
    },
    trainerRole: {
      type: Type.STRING,
      description:
        'What kind of trainer would deliver this, starting with "a" or "an". For example "an information security trainer" or "a fire safety officer".',
    },
    practitionerCredential: {
      type: Type.STRING,
      description:
        'Why this trainer is credible on this subject, as a noun phrase starting with "a" or "someone". Describe the kind of experience the subject calls for. Claim no named qualification, employer or certification.',
    },
    exampleDomain: {
      type: Type.STRING,
      description:
        'A comma-separated list of four to eight artefacts or situations the audience would recognise from their own work, drawn from what the deck implies about them.',
    },
    exampleContext: {
      type: Type.STRING,
      description:
        'A short phrase naming the audience\'s working world, for "an example from ___". For example "data centre consultancy work".',
    },
    closingReminder: {
      type: Type.STRING,
      description:
        'The one practical thing the closing turn should remind them of, phrased as an object. Must be something the deck actually covers.',
    },
  },
} as const;

/**
 * Neutral values, used where the deck does not support a real one.
 *
 * Identical to what the draft builder uses, on purpose: an unanswered question
 * should look the same whether nobody asked it or the answer was not in the deck.
 */
const NEUTRAL_OWNER = 'your organisation';
const NEUTRAL_OWNER_DESCRIPTION = 'the organisation this deck belongs to';

function deckMetaPrompt(deck: DeckRecord): string {
  return `You are preparing a training deck to be delivered by an AI trainer that speaks aloud.

Here is every page of the deck, one line each, in order.

${deck.slides.map(pageHeadline).join('\n')}

Work out what this deck is and who it is for.

Everything you return is spliced into the trainer's own words and spoken to a trainee, so write phrases that can be dropped into a sentence, not sentence fragments with capital letters and full stops of their own.

Two rules matter more than the rest.

Do not invent an organisation. If the deck does not name the company or body it belongs to, say so with ownerNamedInDeck false and use the neutral wording. A trainer confidently naming the wrong employer is worse than one that stays general.

Do not invent credentials. practitionerCredential describes the kind of experience this subject calls for, in general terms. Never a named certification, a named employer, or a number of years.

If the deck is too thin to answer something, choose the most general phrasing that is still true rather than the most specific one that might not be.`;
}

/** Runs the deck-level pass. One call, sees the whole deck. */
export async function analyseDeckMeta(deck: DeckRecord): Promise<DeckMetaAnalysis> {
  const ai = new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });

  const result = await ai.models.generateContent({
    model: GEMINI_MODEL(),
    contents: [{ role: 'user', parts: [{ text: deckMetaPrompt(deck) }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: DECK_META_SCHEMA,
      // Low, but not zero. This is extraction with a little judgement, and the
      // judgement is about phrasing rather than about facts.
      temperature: 0.2,
    },
  });

  const text = result.text;
  if (!text) throw new Error('The model returned nothing for the deck outline.');

  return JSON.parse(text) as DeckMetaAnalysis;
}

/**
 * Applies the deck-level answer, refusing the parts it is not entitled to.
 *
 * The guard is not decoration. `owner` is spliced into "the deck is the authority on
 * ___ policy" and spoken, so a name the deck never mentioned would be the trainer
 * asserting something false about the trainee's own employer.
 */
export function mergeDeckMeta(
  existing: DeckMeta,
  analysis: DeckMetaAnalysis,
  now: string,
): DeckMeta {
  const trimmed = (value: string, fallback: string) => {
    const clean = value?.trim();
    return clean && clean.length > 0 ? clean : fallback;
  };

  const ownerIsReal = analysis.ownerNamedInDeck && analysis.owner.trim().length > 0;
  const looksNeutral = /your organisation|the organisation this deck/i.test(analysis.owner ?? '');

  return {
    ...existing,
    title: trimmed(analysis.title, existing.title),
    subtitle: trimmed(analysis.subtitle, existing.subtitle),
    spokenSubject: trimmed(analysis.spokenSubject, existing.spokenSubject).toLowerCase(),
    owner: ownerIsReal && !looksNeutral ? analysis.owner.trim() : NEUTRAL_OWNER,
    ownerDescription:
      ownerIsReal && analysis.ownerDescription?.trim()
        ? analysis.ownerDescription.trim()
        : NEUTRAL_OWNER_DESCRIPTION,
    trainerRole: trimmed(analysis.trainerRole, existing.trainerRole),
    practitionerCredential: trimmed(
      analysis.practitionerCredential,
      existing.practitionerCredential,
    ),
    exampleDomain: trimmed(analysis.exampleDomain, existing.exampleDomain),
    exampleContext: trimmed(analysis.exampleContext, existing.exampleContext),
    closingReminder: trimmed(analysis.closingReminder, existing.closingReminder),
    outlineAnalysedAt: now,
    outlinePromptVersion: OUTLINE_PROMPT_VERSION,
  };
}

// ===========================================================================
// The slide-level pass
// ===========================================================================

export interface SlideOutline {
  pageNumber: number;
  title: string;
  shortLabel: string;
  summary: string;
  role: SlideRole;
  /** 1 to 5. Turned into a time budget here rather than asked for in seconds. */
  teachingDepth: number;
}

const SLIDE_OUTLINE_SCHEMA = {
  type: Type.OBJECT,
  required: ['slides'],
  properties: {
    slides: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['pageNumber', 'title', 'shortLabel', 'summary', 'role', 'teachingDepth'],
        properties: {
          pageNumber: { type: Type.INTEGER, description: 'The page this describes.' },
          title: {
            type: Type.STRING,
            description:
              'The page heading. Prefer the line set in the largest type when it reads as a heading, keeping its own capitalisation: do not convert sentence case to Title Case. If that line is not a heading, or the page has none, write a short descriptive heading of your own in sentence case. A title must read as a title: never a fragment of code, never a line that stops mid-clause, never a comma-separated list of identifiers.',
          },
          shortLabel: {
            type: Type.STRING,
            description: 'Two or three words for a narrow navigation chip. Under 24 characters.',
          },
          summary: {
            type: Type.STRING,
            description:
              'One plain sentence of substance, under 140 characters, shown to a trainee in a list of what the session covers. Say the thing itself, not that the page says it: "How an uploaded deck becomes a session" rather than "This page describes how an uploaded deck becomes a session". Never begin with "This page", "This slide" or "The page".',
          },
          role: {
            type: Type.STRING,
            enum: ['title', 'content', 'divider', 'closing'],
            description:
              'title for an opening cover page, divider for a section marker that teaches nothing on its own, closing for a final summary or thank-you page, content for everything else.',
          },
          teachingDepth: {
            type: Type.INTEGER,
            description:
              'How much there is to explain here, 1 to 5. 1 is a page that needs a sentence. 5 is a page a trainer could spend three minutes on. Judge the depth of the ideas, not the amount of text: six one-word bullets naming six real threats is a 5.',
          },
        },
      },
    },
  },
} as const;

function slideBatchPrompt(deck: DeckRecord, meta: DeckMeta, pages: DeckSlide[]): string {
  return `You are preparing a training deck to be delivered by an AI trainer that speaks aloud.

THE DECK AS A WHOLE
Title: ${meta.title}
Subject: ${meta.subtitle}
It has ${deck.slides.length} pages. Here they are, one line each:

${deck.slides.map(pageHeadline).join('\n')}

YOUR TASK
Describe only the pages listed below, using the text printed on each one. Some pages also have an image attached, because their text alone does not say what they are.

${pages
  .map((slide) => {
    const lines = slide.bullets.length > 0 ? slide.bullets.join('\n  ') : '(no text on this page)';
    // What the page set in the largest type, measured at render time. Raw text
    // cannot distinguish a heading from a code snippet; this can.
    const printed = slide.printedTitle
      ? `\n  Set in the largest type on this page: ${slide.printedTitle}`
      : '\n  Nothing on this page is set noticeably larger than the rest.';
    return `--- Page ${slide.id} ---${printed}\n  ${lines}`;
  })
  .join('\n\n')}

Return one entry per page listed, and no others.

For the title, start from the line set in the largest type. If it reads as a heading, keep it and keep its capitalisation. If it is a code snippet, a diagram label, or a fragment that stops mid-clause, ignore it and write a short heading of your own in sentence case that says what the page is about. A title appears in a navigation chip and is read by a trainee, so it has to read like a title.

Summaries appear to a trainee as a list of what the session covers, so write the substance directly. "How an uploaded deck becomes a session" reads as a contents entry; "This page describes how an uploaded deck becomes a session" reads as a report about a document, and it is what every model writes unless told not to.

Judge role by what the page does for a trainee, not by how much text it holds. A cover page is title. A page that only announces the next section is divider. A final recap or thank-you is closing.

teachingDepth is about the ideas, not the word count. A page listing six threats by name has a great deal to explain and is a 5. A page with a long paragraph restating the title is a 1.`;
}

/** Seconds a page gets, by how much there is to say. */
const DEPTH_TO_SECONDS: Record<number, number> = {
  1: 45,
  2: 75,
  3: 105,
  4: 135,
  5: 170,
};

/**
 * Turns the model's depth rating into a time budget.
 *
 * Asked as a rating rather than in seconds so the mapping stays here. Asked for
 * directly, models return round numbers with no relationship to each other, and
 * occasionally ten minutes.
 */
export function secondsForDepth(depth: number): number {
  const rounded = Math.min(Math.max(Math.round(depth), 1), 5);
  return DEPTH_TO_SECONDS[rounded];
}

/** Roles that teach nothing on their own, so a question must never land there. */
const SILENT_ROLES = new Set<SlideRole>(['title']);

/** Runs the slide-level pass for one batch of pages. */
export async function analyseSlideBatch(
  deck: DeckRecord,
  meta: DeckMeta,
  pageNumbers: number[],
): Promise<SlideOutline[]> {
  const pages = deck.slides.filter((slide) => pageNumbers.includes(slide.id));
  if (pages.length === 0) return [];

  const ai = new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });

  const parts: Part[] = [{ text: slideBatchPrompt(deck, meta, pages) }];

  // Thumbnails, only where the text does not speak for itself.
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
      responseSchema: SLIDE_OUTLINE_SCHEMA,
      temperature: 0.2,
    },
  });

  const text = result.text;
  if (!text) throw new Error('The model returned nothing for this batch of pages.');

  const parsed = JSON.parse(text) as { slides?: SlideOutline[] };
  return Array.isArray(parsed.slides) ? parsed.slides : [];
}

/**
 * Applies a batch of slide outlines to the deck.
 *
 * Ignores an entry for a page that was not asked about, which models occasionally
 * produce when a batch sits next to an interesting neighbour. Leaves a page the
 * model skipped exactly as it was, so a partial answer degrades rather than blanks.
 */
export function mergeSlideOutlines(deck: DeckRecord, outlines: SlideOutline[]): DeckRecord {
  const byPage = new Map<number, SlideOutline>();
  for (const outline of outlines) {
    if (deck.slides.some((slide) => slide.id === outline.pageNumber)) {
      byPage.set(outline.pageNumber, outline);
    }
  }

  return {
    ...deck,
    slides: deck.slides.map((slide) => {
      const outline = byPage.get(slide.id);
      if (!outline) return slide;

      const role: SlideRole = (['title', 'content', 'divider', 'closing'] as SlideRole[]).includes(
        outline.role,
      )
        ? outline.role
        : 'content';

      const title = outline.title?.trim();
      const shortLabel = outline.shortLabel?.trim();
      const summary = outline.summary?.trim();

      return {
        ...slide,
        title: title && title.length > 0 ? title.slice(0, 200) : slide.title,
        // The rail is narrow, and a long label pushes the numbers off screen.
        shortLabel:
          shortLabel && shortLabel.length > 0 ? shortLabel.slice(0, 24) : slide.shortLabel,
        summary: summary && summary.length > 0 ? summary.slice(0, 200) : slide.summary,
        role,
        // Derived from the role rather than asked for separately, so the two cannot
        // contradict each other.
        teaches: !SILENT_ROLES.has(role),
        targetSeconds: secondsForDepth(outline.teachingDepth),
      };
    }),
  };
}

/** The batches a deck needs, in order. */
export function outlineBatches(deck: DeckRecord, size = OUTLINE_BATCH_SIZE): number[][] {
  const ids = deck.slides.map((slide) => slide.id);
  const batches: number[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    batches.push(ids.slice(index, index + size));
  }
  return batches;
}
