/**
 * Cutting a white paper into passages, and choosing a few of them for one turn (AI-46).
 *
 * A white paper runs to tens of thousands of words, and the trainer is asked something
 * every few seconds with a voice waiting on the answer. Sending the whole paper on every
 * turn would cost seconds of latency and bury the slide in material that has nothing to
 * do with it, which is the mistake the deck reference made before it was bounded. So the
 * text is cut once, at upload, into passages a few sentences long, each with an id, and
 * each turn is given only the handful that share the most words with the slide on screen
 * and the question asked, capped at about fifteen hundred characters in all.
 *
 * Words rather than embeddings, deliberately. This is the matcher the knowledge base
 * already uses, it needs no model call and no index service, and it runs in well under a
 * millisecond on a hundred pages. A question that shares no words with a paper gets
 * nothing from it, which is the safe way to be wrong: the trainer falls back on the deck
 * and the glossary, as it did before there were papers.
 *
 * Pure, so the rules can be tested without a store, and shared by the store, which cuts
 * at upload, and the chat route, which selects per turn.
 */

import type { DeckSlide } from '../deck-types';
import type { ApprovedReference } from '../trainer-prompt';
import type { WhitePaperPassage } from './types';

/** What a passage aims for: three or four sentences, about a short paragraph. */
export const PASSAGE_TARGET = 450;
/** No passage is longer than this, however long its sentences run. */
export const PASSAGE_MAX = 700;
/** A tail shorter than this joins the passage before it rather than standing alone. */
const PASSAGE_MIN = 120;

/** All the white paper text one turn may carry, across every paper. */
export const TURN_BUDGET = 1500;
/** And at most this many passages, however short they are. */
export const MAX_PASSAGES_PER_TURN = 3;

// ------------------------------------------------------------------- cutting

/**
 * One page's lines as running text.
 *
 * pdf.js gives lines, not paragraphs, and a word broken over a line arrives as
 * "manage-" and "ment". Joining with a space everywhere else is right for prose, which
 * is what a white paper is.
 */
export function pageText(page: string): string {
  return page
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((text, line) => {
      if (!text) return line;
      if (/[a-z]-$/.test(text) && /^[a-z]/.test(line)) return text.slice(0, -1) + line;
      return `${text} ${line}`;
    }, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sentences, split after a full stop, question or exclamation mark followed by a capital. */
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?]["')\]]?)\s+(?=["'(\[]?[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** A sentence too long to be one passage, broken between words. */
function hardSplit(sentence: string): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const word of sentence.split(' ')) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > PASSAGE_MAX && current) {
      pieces.push(current);
      current = word.slice(0, PASSAGE_MAX);
    } else {
      current = next.slice(0, PASSAGE_MAX);
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * A paper's pages, cut into passages with ids.
 *
 * Passages never cross a page, so each one can say where it came from, and they are
 * numbered through the whole paper in reading order. The ids are stable for one version
 * of the text and change only when the text does, which is also what clears approval.
 */
export function cutIntoPassages(pages: readonly string[]): WhitePaperPassage[] {
  const passages: WhitePaperPassage[] = [];

  pages.forEach((raw, index) => {
    const page = index + 1;
    const text = pageText(raw);
    if (!text) return;

    const chunks: string[] = [];
    let current = '';
    for (const sentence of sentencesOf(text).flatMap((s) =>
      s.length > PASSAGE_MAX ? hardSplit(s) : [s],
    )) {
      const next = current ? `${current} ${sentence}` : sentence;
      if (current && next.length > PASSAGE_TARGET) {
        chunks.push(current);
        current = sentence;
      } else {
        current = next;
      }
    }
    if (current) {
      const last = chunks[chunks.length - 1];
      if (last !== undefined && current.length < PASSAGE_MIN) {
        const joined = `${last} ${current}`;
        if (joined.length <= PASSAGE_MAX) chunks[chunks.length - 1] = joined;
        else chunks.push(current);
      } else {
        chunks.push(current);
      }
    }

    for (const chunk of chunks) {
      passages.push({ id: `p${passages.length + 1}`, page, text: chunk });
    }
  });

  return passages;
}

// ------------------------------------------------------------------- matching

/**
 * Words that say nothing about a subject. Short, because anything under three letters
 * is dropped anyway, and words common in every paper are discounted by rarity below.
 */
const STOP_WORDS = new Set(
  (
    'the and for are but not you all any can had her was one our out has have this that ' +
    'with from they will would there their what when where which who whom why how into ' +
    'about than then them these those been being does did doing its it’s also just only ' +
    'very more most some such each other over under again further once here both few ' +
    'own same too should could may might must shall per via upon your yours ours his she ' +
    'him himself herself itself themselves what’s let’s tell explain mean means meaning ' +
    'please know want need like make made use used using get got say said slide deck'
  ).split(' '),
);

/**
 * A word reduced to its stem, crudely.
 *
 * "cooling" and "cooled", "policy" and "policies", "classify" and "classification" each
 * become one stem. A real stemmer would be better and is a dependency and a dictionary;
 * this is the approximation the knowledge base's matcher already makes.
 */
export function stemOf(word: string): string {
  let stem = word;
  if (stem.length > 5 && stem.endsWith('ies')) stem = `${stem.slice(0, -3)}y`;
  else if (stem.length > 5 && stem.endsWith('ied')) stem = `${stem.slice(0, -3)}y`;
  else {
    for (const suffix of ['ations', 'ation', 'ings', 'ing', 'ed', 'es', 's']) {
      if (stem.endsWith(suffix) && stem.length - suffix.length >= 4 && !stem.endsWith('ss')) {
        stem = stem.slice(0, -suffix.length);
        break;
      }
    }
  }
  return stem.slice(0, 7);
}

/** The distinct stems of the words in a text worth matching on. */
export function termsOf(text: string): Set<string> {
  const terms = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z0-9’']+/)) {
    const clean = word.replace(/[’']/g, '');
    if (clean.length < 3 || STOP_WORDS.has(word) || STOP_WORDS.has(clean)) continue;
    if (/^\d+$/.test(clean) && clean.length < 4) continue;
    terms.add(stemOf(clean));
  }
  return terms;
}

/** A passage with its stems worked out once, when its paper is loaded. */
export interface IndexedPassage extends WhitePaperPassage {
  terms: ReadonlySet<string>;
}

/** One approved, attached paper, ready to be matched against. */
export interface ReferencePaper {
  paperId: string;
  title: string;
  passages: readonly IndexedPassage[];
}

export function indexPassages(passages: readonly WhitePaperPassage[]): IndexedPassage[] {
  return passages.map((passage) => ({ ...passage, terms: termsOf(passage.text) }));
}

/** What a turn is about: the slide on screen, and the question, when there is one. */
export interface TurnFocus {
  slide: Pick<DeckSlide, 'title' | 'bullets' | 'keyPoints' | 'summary'>;
  question?: string;
}

/**
 * How much each word of the turn counts.
 *
 * The question most, because it is what the trainee wants answered; the slide's title
 * next, because it names the subject; and its bullets, key points and summary least,
 * because they range wider than the one thing being asked.
 */
function weightedTerms(focus: TurnFocus): Map<string, number> {
  const weights = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const term of termsOf(text)) {
      weights.set(term, Math.max(weights.get(term) ?? 0, weight));
    }
  };
  add([focus.slide.summary, ...focus.slide.bullets, ...focus.slide.keyPoints].join(' '), 1);
  add(focus.slide.title, 2);
  if (focus.question?.trim()) add(focus.question, 3);
  return weights;
}

/**
 * The least a passage must match to be worth sending: one word of the question, or a
 * word of the title and one more, or three words of the slide. Below that, a passage
 * that shares one common word with a bullet is noise, and an empty answer is better.
 */
const MIN_EVIDENCE = 3;

/**
 * The passages for one turn, as the trainer prompt takes them.
 *
 * Every passage of every paper is scored by the words it shares with the turn, each
 * word weighted by where it came from and by how rare it is across the papers, so a
 * word every passage uses decides nothing. The best go in, up to `TURN_BUDGET`
 * characters and `MAX_PASSAGES_PER_TURN` passages, and come back one reference per
 * paper, in the paper's own order, so the trainer reads them as they were written.
 *
 * Empty when nothing matches well enough, which leaves the prompt exactly as it would
 * be with no papers attached.
 */
export function selectReferences(
  papers: readonly ReferencePaper[],
  focus: TurnFocus,
): ApprovedReference[] {
  const pool = papers.flatMap((paper, paperIndex) =>
    paper.passages.map((passage, index) => ({ paper, paperIndex, passage, index })),
  );
  if (pool.length === 0) return [];

  const weights = weightedTerms(focus);
  if (weights.size === 0) return [];

  const frequency = new Map<string, number>();
  for (const term of weights.keys()) {
    let count = 0;
    for (const { passage } of pool) if (passage.terms.has(term)) count += 1;
    frequency.set(term, count);
  }

  const scored = pool
    .map((entry) => {
      let evidence = 0;
      let score = 0;
      for (const [term, weight] of weights) {
        if (!entry.passage.terms.has(term)) continue;
        evidence += weight;
        score += weight * Math.log(1 + pool.length / frequency.get(term)!);
      }
      return { ...entry, evidence, score };
    })
    .filter((entry) => entry.evidence >= MIN_EVIDENCE)
    .sort((a, b) => b.score - a.score || a.paperIndex - b.paperIndex || a.index - b.index);

  const chosen: typeof scored = [];
  let used = 0;
  for (const entry of scored) {
    if (chosen.length >= MAX_PASSAGES_PER_TURN) break;
    if (used + entry.passage.text.length > TURN_BUDGET) continue;
    chosen.push(entry);
    used += entry.passage.text.length;
  }
  if (chosen.length === 0) return [];

  chosen.sort((a, b) => a.paperIndex - b.paperIndex || a.index - b.index);
  const references: ApprovedReference[] = [];
  for (const entry of chosen) {
    const last = references[references.length - 1];
    const previous = chosen[chosen.indexOf(entry) - 1];
    if (last && previous?.paper === entry.paper) {
      last.text = `${last.text}\n\n${entry.passage.text}`;
    } else {
      references.push({ title: entry.paper.title, text: entry.passage.text });
    }
  }
  return references;
}
