/**
 * Reads what a trainee's utterance is actually asking for.
 *
 * This matters more than it looks. If "please move to the next topic" is treated
 * as a question, the trainer answers it ("right, let's move on") and nobody ever
 * teaches the next slide. The session looks like it has hung when in fact it did
 * exactly what it was told.
 *
 * Shared between the client, which routes the turn, and the server, which decides
 * whether a slide change should be followed by teaching or by an answer.
 *
 * Answer style lives here too. It is the same job on the same input, reading an
 * utterance to decide what the trainee wants, and it has to be callable from the
 * browser. It used to sit in trainer-prompt.ts, which meant the session hook
 * imported the whole prompt builder, and behind it the entire knowledge base, into
 * the client bundle to call one regex.
 */

import type { AnswerStyle } from './types';

/** What the trainee wants to happen next. */
export type Utterance =
  /** Move forward. There is nothing to answer. */
  | 'advance'
  /** Go back to the previous slide. */
  | 'back'
  /** Say that again, on the current slide. */
  | 'repeat'
  /** A real question, or anything substantive. */
  | 'question';

/**
 * Fillers people put in front of the real content. Stripped before matching so
 * that "yeah, ok, please move on" is read the same as "move on".
 */
const LEADING_FILLER =
  /^(?:(?:yeah|yes|yep|yup|ok|okay|right|sure|alright|all right|cool|great|fine|no|nope|erm|um|uh|well|so|and|then|now|please|thanks|thank you|got it)[\s,.!]+)+/i;

/** Phrases that mean "carry on" rather than "answer something". */
const ADVANCE_PATTERNS: RegExp[] = [
  // Explicit navigation forwards. Covers slide, topic, section, one, page, bit.
  /\bnext\b(?:\s+\w+)?\s*(?:slide|topic|section|one|page|part|bit|thing)?\b/i,
  /\b(?:move|moving|go|going|take me|skip|jump|carry|head|push)\s+(?:on|ahead|forward|to|onto|along)\b/i,
  /\b(?:move|go|carry|press|crack)\s+on\b/i,
  /\bgo\s+ahead\b/i,
  /\bkeep\s+(?:going|moving)\b/i,
  /\b(?:let'?s|lets|shall we|can we|could we)\s+(?:move|continue|carry|go|proceed|crack)\b/i,
  /\b(?:continue|proceed|onwards|onward)\b/i,
  /\bwhat'?s\s+next\b/i,
  /\bcarry\s+on\b/i,

  // Signals that they have nothing to ask, which is also a request to advance.
  /\bno(?:\s+more)?\s+questions?\b/i,
  /\bnothing(?:\s+else)?(?:\s+for\s+now)?\b/i,
  /\b(?:i'?m|i\s+am)\s+(?:all\s+)?(?:good|done|fine|clear|happy|set|sorted)\b/i,
  /\b(?:all\s+)?(?:good|done|clear|fine|sorted)\s+(?:with\s+)?(?:that|this|there)\b/i,
  /\b(?:that'?s|thats|it'?s)\s+(?:all\s+)?(?:clear|fine|good|great)\b/i,
  /\b(?:understood|makes\s+sense|got\s+it|noted|crystal\s+clear)\b/i,
  /\bready\b/i,
];

/**
 * Negated readiness, which must not be read as a request to advance.
 *
 * "I'm not ready" contains "ready" and matched the advance pattern, so the deck
 * moved on at exactly the moment the trainee was asking it not to. Only the words
 * that flip meaning under negation are listed here, because a blanket negation
 * check would break "no questions", where the negation is the whole point.
 */
const NEGATED_ADVANCE =
  /\b(?:not|n'?t|never|hardly|barely)\s+(?:\w+\s+){0,2}(?:ready|clear|good|fine|done|sorted|sure|understood|following)\b/i;

/** Phrases that mean "go back". */
const BACK_PATTERNS: RegExp[] = [
  /\b(?:previous|prior|last)\s+(?:slide|topic|section|one|page)\b/i,
  /\b(?:go|take me|move|jump)\s+back\b/i,
  /\bback\s+(?:one|a\s+slide|to\s+the\s+(?:previous|last))\b/i,
];

/**
 * Phrases that mean "say what you just said again", with no new subject.
 *
 * Deliberately narrow. "Go over the classification matrix again" names a topic,
 * so it belongs on the question path, where the trainer can bring up slide 5 and
 * teach it. Repeating the current slide would be the wrong response.
 */
const REPEAT_PATTERNS: RegExp[] = [
  /\b(?:say|explain|go over|run through|go through)\s+(?:that|it|this)\s+again\b/i,
  /\b(?:repeat|rerun)\s+(?:that|it|this)?\b/i,
  /\b(?:one\s+more\s+time|once\s+more|come\s+again)\b/i,
  /\bcan\s+you\s+repeat\b/i,
];

/**
 * Beyond this many words an utterance is treated as substantive, whatever it
 * matches. Someone saying a lot is not nudging you along.
 */
const MAX_CONTROL_WORDS = 10;

/**
 * Substantive openers. "What's next" is a nudge; "what's next after
 * classification and why does it matter" is a question, and the difference is not
 * only length.
 */
const QUESTION_MARKERS =
  /\b(?:why|how|what\s+(?:is|are|does|do|would|about|if|happens)|which|who|when|where|explain|tell\s+me|give\s+me|example|difference|mean|should\s+i|can\s+i|do\s+i|is\s+it|are\s+we)\b/i;

/**
 * Tests every candidate form of the utterance.
 *
 * Filler stripping helps matching more often than it hurts, but it can remove
 * something meaningful: "no questions" strips to "questions", because "no" is
 * also a filler. Matching the raw form as well means stripping can only ever add
 * a match, never take one away.
 */
function matchesAny(candidates: string[], patterns: RegExp[]): boolean {
  return patterns.some((pattern) => candidates.some((text) => pattern.test(text)));
}

/**
 * Folds the apostrophes a keyboard produces into the one the patterns match.
 *
 * A phone and a Mac both give U+2019 for an apostrophe, and it is
 * indistinguishable on screen from the ASCII one every contraction below is
 * written with. "I don’t understand" was scoring as an ordinary question.
 */
function foldApostrophes(text: string): string {
  return text.replace(/[\u2018\u2019\u02bc]/g, "'");
}

/**
 * Classifies one utterance.
 *
 * Anything questioning wins over anything navigational, because mistaking a
 * question for a nudge silently drops what the trainee wanted to know.
 */
export function classifyUtterance(raw: string): Utterance {
  const text = foldApostrophes(raw.trim());
  if (!text) return 'question';

  // A question mark settles it, whatever else is in there.
  if (text.includes('?')) return 'question';

  const stripped = text.replace(LEADING_FILLER, '').trim() || text;
  const forms = stripped === text ? [text] : [stripped, text];
  const wordCount = stripped.split(/\s+/).length;

  // Checked before the word limit, since a politely phrased "would you mind
  // saying that again" runs long while carrying no new subject.
  if (matchesAny(forms, REPEAT_PATTERNS)) return 'repeat';

  // Past this length an utterance is substantive whatever it matches.
  if (wordCount > MAX_CONTROL_WORDS) return 'question';

  // A short utterance that still asks something is a question, not a nudge.
  if (QUESTION_MARKERS.test(stripped) && !matchesAny(forms, ADVANCE_PATTERNS)) {
    return 'question';
  }

  if (matchesAny(forms, BACK_PATTERNS)) return 'back';

  // Checked before advance, because the advance patterns match the un-negated
  // word and would otherwise read "I'm not ready" as a request to move on.
  if (matchesAny(forms, [NEGATED_ADVANCE])) return 'question';

  if (matchesAny(forms, ADVANCE_PATTERNS)) return 'advance';

  return 'question';
}

/** True when the utterance carries no content for the trainer to answer. */
export function isNavigationOnly(raw: string | undefined): boolean {
  if (!raw?.trim()) return true;
  const kind = classifyUtterance(raw);
  return kind === 'advance' || kind === 'back';
}

/**
 * Works out what shape of answer the trainee is asking for.
 *
 * A request to simplify and a request to go deeper need genuinely different
 * replies, and getting this wrong is the difference between a trainer who listens
 * and one with a single register.
 */
export function detectAnswerStyle(question: string): AnswerStyle {
  const q = foldApostrophes(question.toLowerCase());

  if (
    /**
     * Two widenings, both from listening to what people actually say.
     *
     * `simpl\w*` rather than the two spellings this started with. "Explain that more
     * simply" is among the most natural ways to ask, and it was falling through to
     * the default register, which answers at normal depth and repeats the very thing
     * the trainee said they could not follow. The stem covers simpler, simplify,
     * simply and simple terms together.
     *
     * `do(?:n't| not)` rather than the contraction alone. This arrives from speech to
     * text, and Deepgram transcribes the same sentence as "don't understand" or "do
     * not understand" depending on how it was said. Matching only the contraction
     * meant half of the clearest possible signal was missed.
     *
     * Biased towards firing. A false positive answers more plainly than strictly
     * needed; a false negative keeps talking over someone who has just said they are
     * lost, which is the one thing this is here to prevent.
     */
    /\b(simpl\w*|plain english|layman|confus|lost|do(?:n'?t| not) (?:really )?(?:get|understand|follow)|did(?:n'?t| not) (?:get|understand|follow)|not following|explain (?:it |that )?again|what do you mean|too (?:technical|complicated)|(?:break|dumb) (?:it|that|this) down)\b/.test(
      q,
    )
  ) {
    return 'simpler';
  }
  if (
    /\b(example|for instance|such as|show me|what would that look like|in practice|real world|scenario)\b/.test(
      q,
    )
  ) {
    return 'example';
  }
  /**
   * Asked for an enumeration.
   *
   * Placed after `simpler` and `example`, and before `standard` and `deeper`,
   * because the first match wins. Somebody who says "I am lost, can you list them"
   * is lost first, and "give me an example of each" wants the example register.
   *
   * Deliberately narrower than the other branches. A false positive here hands an
   * ordinary question half again as many words as it needs, which is the failure
   * this whole exercise is trying to remove.
   */
  if (
    // Interrogative: "what are the four tiers", "which policies apply to me".
    /\b(?:what|which)\s+(?:are|is)?\s*(?:all\s+)?(?:the\s+)?(?:\w+\s+)?(?:tiers|levels|categories|types|kinds|routes|policies|options|steps|stages|classifications|principles|controls|ways|reasons|threats|risks)\b/.test(
      q,
    ) ||
    // A request, which has to be what they are asking rather than a word in
    // passing. Anchored near the front for that reason: "is the list of policies
    // long" is a question about a list, not a request for one, and it was matching.
    /^(?:(?:ok|okay|so|right|well|and|then|um|erm|yeah|yes|sorry|please|now)[\s,]+){0,2}(?:(?:can|could|would|will)\s+(?:you\s+)?)?(?:please\s+)?(?:list|name|run\s+through|go\s+through|walk\s+me\s+through|talk\s+me\s+through)\b/.test(
      q,
    ) ||
    /\bwhat\s+(?:are|were)\s+(?:the\s+)?\w*\s*(?:\d+|three|four|five|six|seven)\b/.test(q) ||
    /\b(?:\d+|three|four|five|six|seven)\s+\w*\s*(?:tiers|levels|categories|types|kinds|routes|policies|options|steps|stages|principles|controls)\b/.test(
      q,
    )
  ) {
    return 'list';
  }
  if (
    /\b(clause|annex|control number|which control|standard say|iso say|27002|reference|precisely)\b/.test(
      q,
    )
  ) {
    return 'standard';
  }
  if (
    /\b(more detail|go deeper|deeper|elaborate|expand|tell me more|why (?:exactly|specifically)|how does that (?:actually )?work|what happens if)\b/.test(
      q,
    )
  ) {
    return 'deeper';
  }
  return 'default';
}
