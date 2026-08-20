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
 */

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
 * Classifies one utterance.
 *
 * Anything questioning wins over anything navigational, because mistaking a
 * question for a nudge silently drops what the trainee wanted to know.
 */
export function classifyUtterance(raw: string): Utterance {
  const text = raw.trim();
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
