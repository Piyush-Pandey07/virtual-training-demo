/**
 * The data centre glossary, put in front of the trainer when a turn uses its terms (AI-21).
 *
 * The Benchmark team keeps one glossary of data centre terms, and every trainee should
 * hear a term defined the same way whichever deck or session they meet it in. Gemini
 * knows what a CRAH is without this; what it does not know is how Technavious defines it,
 * and left alone it will define "concurrent maintainability" a slightly different way in
 * every session. So each turn gets the glossary entries for the terms it is about, and
 * nothing else: the whole list would be about seventeen thousand tokens on every call.
 *
 * Three decisions shape the matching:
 *
 * - Only data centre decks. Many entries are ordinary words with a data centre meaning
 *   (Monitoring, Access Control, Incident Management, Availability), and the ISMS deck
 *   uses all of them in an information security sense. Defining "incident management"
 *   as responding to equipment failures in a security lesson would be wrong, so a deck has
 *   to look like a data centre deck before any of this applies. See `usesGlossary`.
 *
 * - Acronyms match as written, in capitals, as whole tokens. "UPS" never matches "ups",
 *   "FAT" never matches "fat", and "N+1" is one token. Names match regardless of case,
 *   with British and American spellings treated as the same word.
 *
 * - Single ordinary words are weak evidence. "Server" or "Owner" in a speaker note is not
 *   a reason to define it; the same word in the trainee's question, or in the slide's own
 *   title and bullets, is.
 */

import type { DeckRecord, DeckSlide } from '../deck-types';
import { GLOSSARY } from './entries';
import type { GlossaryEntry } from './types';

export type { GlossaryEntry } from './types';

/** How many entries one turn may carry. */
export const MAX_TERMS_PER_TURN = 6;

/** The longest a single definition may run in the prompt. */
const MAX_DEFINITION_CHARS = 220;

/**
 * Distinct strong glossary terms a deck's slides must use before the glossary applies,
 * when its title does not already say it is about data centres. Measured on the decks in
 * use: the data centre decks use dozens, the ISMS decks a handful of ordinary words.
 */
export const MIN_DECK_TERMS = 6;

/** British and American spellings, made the same before matching. */
function normalise(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/\bcenters?\b/g, (word) => word.replace('center', 'centre'))
    .replace(/\bfib(er|re)s?\b/g, (word) => word.replace(/fib(er|re)/, 'fibre'))
    .replace(/(\w{3,})iz(e|es|ed|ing|ation)\b/g, '$1is$2')
    .replace(/[^a-z0-9+&]+/g, ' ')
    .trim()} `;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Written like an acronym or a code: UPS, RDHx, N+1, 2N, FM-200, D2C. */
function writtenAsCode(text: string): boolean {
  return (
    /^[A-Z0-9][A-Za-z0-9&+-]{0,9}$/.test(text) && /[A-Z]/.test(text) && /[A-Z0-9]{2}|\+/.test(text)
  );
}

interface Matcher {
  entry: GlossaryEntry;
  /** Matched against the text as written. */
  codes: RegExp[];
  /** Matched against `normalise`d text. */
  names: string[];
  /** A single ordinary word, which counts only where it is prominent. */
  weak: boolean;
}

function matcherFor(entry: GlossaryEntry): Matcher | null {
  const codes: string[] = [];
  const names: string[] = [];
  const add = (text: string | undefined) => {
    if (!text) return;
    if (writtenAsCode(text)) codes.push(text);
    else if (text.length > 2) names.push(normalise(text).trim());
  };
  add(entry.acronym);
  add(entry.term);
  add(entry.expansion);
  for (const alias of entry.aliases ?? []) {
    // "IT: Information Technology" is a note, and a bare test level such as "L4" is too
    // short to trust outside a commissioning schedule.
    if (alias.includes(':') || /^L\d$/.test(alias)) continue;
    add(alias);
  }
  if (codes.length === 0 && names.length === 0) return null;
  return {
    entry,
    // Whole tokens only, allowing a plural "s": "UPSs", "CRAHs".
    codes: [...new Set(codes)].map(
      (code) => new RegExp(`(?<![A-Za-z0-9+])${escape(code)}s?(?![A-Za-z0-9+])`),
    ),
    names: [...new Set(names)],
    weak: codes.length === 0 && names.every((name) => !name.includes(' ')),
  };
}

/** Every entry the trainer may use. Held entries wait for their owners to confirm them. */
const MATCHERS: Matcher[] = GLOSSARY.filter((entry) => !entry.held)
  .map(matcherFor)
  .filter((matcher): matcher is Matcher => matcher !== null);

function hits(matcher: Matcher, written: string, normalised: string): boolean {
  if (matcher.codes.some((pattern) => pattern.test(written))) return true;
  return matcher.names.some(
    (name) =>
      normalised.includes(` ${name} `) ||
      normalised.includes(` ${name}s `) ||
      normalised.includes(` ${name}es `),
  );
}

/** The glossary entries a piece of text uses, strongest first. */
export function termsIn(text: string, options: { includeWeak?: boolean } = {}): GlossaryEntry[] {
  const normalised = normalise(text);
  return MATCHERS.filter(
    (matcher) => (options.includeWeak || !matcher.weak) && hits(matcher, text, normalised),
  ).map((matcher) => matcher.entry);
}

function slideText(slide: DeckSlide): { screen: string; notes: string } {
  return {
    screen: [slide.title, slide.printedTitle ?? '', ...slide.bullets].join('\n'),
    notes: [
      slide.summary,
      slide.narrationBrief,
      ...slide.keyPoints,
      ...slide.speakerNotes,
      ...slide.discussionPrompts,
    ].join('\n'),
  };
}

/**
 * Whether a deck is about data centres, so its turns get glossary definitions.
 *
 * Said in its title or subject, or shown by its slides using enough of the glossary's
 * stronger terms. Kept per deck version, because it is asked on every turn and the
 * answer only changes when the deck does.
 */
const usesGlossaryCache = new Map<string, boolean>();

export function usesGlossary(deck: DeckRecord): boolean {
  const key = `${deck.meta.id}|${deck.meta.outlineAnalysedAt ?? ''}|${deck.slides.length}`;
  const cached = usesGlossaryCache.get(key);
  if (cached !== undefined) return cached;

  const named = /\bdata ?cent(re|er)s?\b/i.test(
    [deck.meta.title, deck.meta.subtitle, deck.meta.spokenSubject].join(' '),
  );
  const answer =
    named ||
    termsIn(deck.slides.map((slide) => Object.values(slideText(slide)).join('\n')).join('\n'))
      .length >= MIN_DECK_TERMS;

  if (usesGlossaryCache.size > 500) usesGlossaryCache.clear();
  usesGlossaryCache.set(key, answer);
  return answer;
}

/**
 * The entries for one turn, most relevant first, at most MAX_TERMS_PER_TURN.
 *
 * What the trainee asked about comes first, then what is on screen, then what the
 * narration brief and notes will lead the trainer to say. Ordinary single words count
 * only from the question and the screen.
 */
export function termsForTurn(
  deck: DeckRecord,
  slide: DeckSlide,
  question?: string,
): GlossaryEntry[] {
  if (!usesGlossary(deck)) return [];
  const { screen, notes } = slideText(slide);
  const ordered = [
    ...(question ? termsIn(question, { includeWeak: true }) : []),
    ...termsIn(screen, { includeWeak: true }),
    ...termsIn(notes),
  ];
  return [...new Map(ordered.map((entry) => [entry.id, entry])).values()].slice(
    0,
    MAX_TERMS_PER_TURN,
  );
}

function nameOf(entry: GlossaryEntry): string {
  if (entry.acronym && entry.expansion && entry.term === entry.acronym) {
    return `${entry.acronym} (${entry.expansion})`;
  }
  if (entry.acronym && entry.term !== entry.acronym) return `${entry.term} (${entry.acronym})`;
  return entry.expansion ? `${entry.term} (${entry.expansion})` : entry.term;
}

function clipped(text: string): string {
  if (text.length <= MAX_DEFINITION_CHARS) return text;
  return `${text.slice(0, text.lastIndexOf(' ', MAX_DEFINITION_CHARS))}...`;
}

/**
 * The prompt block, or an empty string when there is nothing to add.
 *
 * Empty rather than a heading over nothing, so a turn with no glossary terms, and every
 * turn of a deck that is not about data centres, sends exactly the prompt it always did.
 */
export function renderGlossary(entries: readonly GlossaryEntry[]): string {
  if (entries.length === 0) return '';
  return `TECHNAVIOUS GLOSSARY
This is how Technavious defines terms this turn uses. When you explain one of them, keep to this meaning, and say an acronym in full the first time you use it. Put it in your own spoken words rather than reading the definition out, and do not define a term the trainee plainly already knows.
${entries.map((entry) => `- ${nameOf(entry)}: ${clipped(entry.definition)}.`).join('\n')}`;
}

/**
 * Terms worth telling live transcription to listen for in this deck.
 *
 * Acronyms are what speech recognition mishears: "CRAH" comes back as "crow" and "HOTO"
 * as "photo". Deepgram's keyterm prompting takes a short list of them, so this is the
 * deck's own acronyms rather than the whole glossary, capped well inside its limit.
 */
export function keytermsFor(deck: DeckRecord, max = 40): string[] {
  if (!usesGlossary(deck)) return [];
  const text = deck.slides.map((slide) => Object.values(slideText(slide)).join('\n')).join('\n');
  const codes = termsIn(text)
    .map((entry) => entry.acronym ?? (writtenAsCode(entry.term) ? entry.term : undefined))
    .filter((code): code is string => Boolean(code));
  return [...new Set(codes)].slice(0, max);
}
