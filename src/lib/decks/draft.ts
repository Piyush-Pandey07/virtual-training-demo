/**
 * Turning an uploaded PDF's outline into a deck.
 *
 * No model involved. Everything here is derived from what is printed on the pages,
 * which is why it is worth having: a deck built this way is honest about knowing
 * nothing beyond the slides, and it still runs a session, because the trainer has
 * the slide text to work from and the length budgets are computed from it.
 *
 * The result is a draft. Analysis replaces almost all of it, and until then the
 * meta reads as placeholders rather than as invented facts about a company nobody
 * has told us anything about.
 */

import 'server-only';

import type { DeckMeta, DeckRecord, DeckSlide } from '../deck-types';
import { pageAssetUrl } from './assets';

/** One page, as the browser measured it. */
export interface DraftPage {
  pageNumber: number;
  width: number;
  height: number;
  lines: string[];
  /** The line the browser found set in the largest type, if one stood out. */
  titleHint?: string;
}

export interface DraftInput {
  /** The uploaded filename, used to name the deck when nothing better exists. */
  fileName: string;
  /** The PDF's own title, when it had a usable one. */
  documentTitle?: string;
  pages: DraftPage[];
}

/** A page with fewer words than this, and no page before it, is a title card. */
const TITLE_CARD_WORD_LIMIT = 25;

/** Lines longer than this are prose, not a bullet, and get trimmed for the prompt. */
const MAX_BULLET_CHARS = 400;

/** Beyond this many lines a page is a wall of text; the rest is not slide content. */
const MAX_BULLETS_PER_PAGE = 40;

/**
 * What a teaching slide is worth before its text is even considered.
 *
 * Deliberately most of the budget. The hand-authored deck's busiest slide is six
 * one-word bullets and is budgeted at two and a half minutes, because the value
 * is in explaining them rather than reading them. Deriving the whole budget from
 * printed word count put every normally-worded slide on the floor and made a
 * title card and a dense page come out identical.
 */
const BASE_TEACHING_SECONDS = 60;

/** Seconds added per printed word, as a rough proxy for how much there is to say. */
const SECONDS_PER_WORD = 1.2;

/** A title card needs long enough to welcome someone and set out the session. */
const TITLE_CARD_SECONDS = 45;

/** Nobody can hold attention past this on one slide, whatever it contains. */
const MAX_TARGET_SECONDS = 180;

/** Below this a slide is not worth stopping on, even if it is nearly empty. */
const MIN_TARGET_SECONDS = 40;

/**
 * Turns a filename into something a person would read.
 *
 * Real exports look like `Technavious_ISO27001_ISMS Awareness 04062025 1.pdf`, so
 * separators become spaces and trailing version noise comes off.
 */
export function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[a-z0-9]+$/i, '');
  const spaced = withoutExtension
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Dates and copy numbers at the end of an export name are noise, not title.
  const trimmed = spaced
    .replace(/\s+\d{6,8}(\s+\d+)?$/, '')
    .replace(/\s+\(\d+\)$/, '')
    .trim();
  return trimmed.length >= 3 ? trimmed : 'Uploaded deck';
}

/**
 * A storage id derived from the title, with a suffix so two uploads of the same
 * file do not overwrite each other.
 *
 * The suffix comes from the caller rather than being generated here, so this stays
 * a pure function and the tests do not have to stub a clock.
 */
export function deckIdFrom(title: string, suffix: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `${slug || 'deck'}-${suffix}`;
}

function wordCount(lines: string[]): number {
  return lines.reduce((total, line) => total + line.split(/\s+/).filter(Boolean).length, 0);
}

/**
 * How long the trainer should spend on a page.
 *
 * A base for the fact of teaching at all, plus a component from what is printed.
 * Bounded at both ends: a nearly empty page is still worth pausing on, and no page
 * justifies three minutes.
 */
function targetSecondsFor(lines: string[], teaches: boolean): number {
  if (!teaches) return TITLE_CARD_SECONDS;

  const seconds = Math.round(BASE_TEACHING_SECONDS + wordCount(lines) * SECONDS_PER_WORD);
  return Math.min(Math.max(seconds, MIN_TARGET_SECONDS), MAX_TARGET_SECONDS);
}

/**
 * The slide's title.
 *
 * The largest type on the page when the browser found a clear winner, since that
 * is what a heading is. Falling back to the first line that reads as words: on a
 * page holding a diagram the literal first line was picking up box-drawing
 * characters, which then appeared in the slide rail and in the prompt.
 */
function titleFor(page: DraftPage, index: number): string {
  if (page.titleHint) return page.titleHint;

  const candidate = page.lines.find(
    (line) =>
      line.length >= 3 && line.length <= 120 && line.replace(/[^\p{L}\p{N}]/gu, '').length >= 3,
  );
  return candidate ?? `Page ${index + 1}`;
}

/** A short label for the slide rail, which has very little room. */
function shortLabelFor(title: string, pageNumber: number): string {
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 0) return `Page ${pageNumber}`;
  const label = words.slice(0, 3).join(' ');
  return label.length <= 24 ? label : `${label.slice(0, 22)}…`;
}

/**
 * Placeholder meta for a deck nobody has analysed.
 *
 * Every one of these is spoken aloud somewhere in the prompt, so they have to read
 * naturally while making no claim that is not true. "Your organisation" is vague
 * because at this point we genuinely do not know whose deck this is, and inventing
 * a name would be worse than being vague.
 */
function draftMeta(id: string, title: string, subtitle: string): DeckMeta {
  return {
    id,
    // Read out of a file, so the analysis passes are free to improve all of it.
    origin: 'uploaded',
    title,
    subtitle,
    spokenSubject: title.toLowerCase(),
    owner: 'your organisation',
    ownerDescription: 'the organisation this deck belongs to',
    trainerRole: 'a trainer',
    practitionerCredential:
      'someone who has worked through this material and knows where people get stuck',
    exampleDomain: 'the situations this deck describes',
    exampleContext: 'everyday work',
    closingReminder: 'the main points you covered',
  };
}

/**
 * Builds a deck from a rendered upload.
 *
 * `topics` is empty, and that is the honest state of a deck that has been read but
 * not analysed. It will not pass the publish check, which is the point: it can be
 * stored, previewed and run as a draft, and it cannot be handed to a trainee as
 * finished.
 */
export function draftDeckFrom(input: DraftInput, deckId: string): DeckRecord {
  const title = input.documentTitle?.trim() || titleFromFileName(input.fileName);

  // The first page's second line is very often the subtitle of a real deck.
  const firstPage = input.pages[0];
  const subtitleCandidate = firstPage?.lines[1]?.trim();
  const subtitle =
    subtitleCandidate && subtitleCandidate.length >= 3 && subtitleCandidate.length <= 160
      ? subtitleCandidate
      : `${input.pages.length} pages, uploaded and not yet analysed`;

  const slides: DeckSlide[] = input.pages.map((page, index) => {
    const bullets = page.lines
      .slice(0, MAX_BULLETS_PER_PAGE)
      .map((line) =>
        line.length > MAX_BULLET_CHARS ? `${line.slice(0, MAX_BULLET_CHARS)}…` : line,
      );

    const slideTitle = titleFor(page, index);
    const words = wordCount(page.lines);
    // Only the opening page gets the benefit of the doubt. A sparse page in the
    // middle of a deck is usually a section divider that still deserves a sentence,
    // and marking it silent would stop questions ever navigating to it.
    const teaches = !(index === 0 && words < TITLE_CARD_WORD_LIMIT);

    return {
      id: page.pageNumber,
      title: slideTitle,
      // Kept as the record of what the page actually looked like. The analysis pass
      // reads this rather than `title`, which it also overwrites.
      ...(page.titleHint ? { printedTitle: page.titleHint } : {}),
      shortLabel: shortLabelFor(slideTitle, page.pageNumber),
      summary:
        bullets.slice(1, 3).join('. ').slice(0, 160) || `Page ${page.pageNumber} of the deck`,
      image: pageAssetUrl(deckId, page.pageNumber, 'full'),
      width: page.width,
      height: page.height,
      bullets,
      // A PDF export carries no presenter notes. This is the single biggest
      // difference between an uploaded deck and the hand-authored one, and it is
      // why PPTX is the format worth supporting properly.
      speakerNotes: [],
      internalNotes: [],
      narrationBrief: teaches
        ? 'This deck has not been analysed yet, so you have only what is printed on the slide. Explain it in your own words, say what it means in practice, and be straightforward that you are working from the slide itself.'
        : 'This is the opening page. Welcome the trainee, say what the session covers, and set them at ease.',
      keyPoints: [],
      discussionPrompts: [],
      targetSeconds: targetSecondsFor(page.lines, teaches),
      teaches,
    };
  });

  return {
    meta: draftMeta(deckId, title, subtitle),
    slides,
    // Nothing has been analysed. Not a placeholder: an accurate statement that this
    // deck has no expertise behind it yet.
    topics: [],
  };
}
