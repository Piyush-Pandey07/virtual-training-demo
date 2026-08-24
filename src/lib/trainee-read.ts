/**
 * Reading the trainee from the conversation so far.
 *
 * The transcript already contains everything here, and the model could in principle
 * work it out. It does not. Measured across a nine-question session, seven of nine
 * replies closed with the same "does that make sense?" check, despite the prompt
 * asking for variety, because nothing pointed at the repetition. A model cannot
 * avoid a pattern it has not been shown.
 *
 * So these are computed and stated plainly: what the trainer has already said, when
 * a question has been asked before, and when the trainee is answering rather than
 * asking. Each one changes what a good reply looks like.
 */

import 'server-only';

import type { HistoryTurn } from './types';

/**
 * The last sentence of a turn, which is where it hands the conversation back.
 *
 * Splitting on sentence ends rather than taking the last line, because a spoken
 * turn is a paragraph and the closing is its final clause.
 */
export function closingSentence(text: string): string {
  const sentences = text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences[sentences.length - 1] ?? '';
}

/** How many of the trainer's own closings to show it. */
const CLOSINGS_REMEMBERED = 5;

/** Closings the trainer has already used this session, most recent last. */
export function recentClosings(history: HistoryTurn[], limit = CLOSINGS_REMEMBERED): string[] {
  return history
    .filter((turn) => turn.speaker === 'trainer')
    .map((turn) => closingSentence(turn.text))
    .filter((closing) => closing.length > 0)
    .slice(-limit);
}

/**
 * Whether the trainer's last turn ended by asking something.
 *
 * If it did, the trainee's reply is as likely to be an attempt at that question as
 * a new question of their own, and the two need completely different replies. The
 * prompt has always described how to handle an attempt; it had no way of knowing
 * when one had arrived.
 */
export function lastTurnAskedSomething(history: HistoryTurn[]): boolean {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].speaker !== 'trainer') continue;
    return closingSentence(history[index].text).includes('?');
  }
  return false;
}

/** Words too common to signal that two questions are about the same thing. */
const STOP_WORDS = new Set([
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'whose',
  'why',
  'how',
  'that',
  'this',
  'these',
  'those',
  'there',
  'here',
  'about',
  'would',
  'could',
  'should',
  'does',
  'doing',
  'have',
  'has',
  'had',
  'been',
  'being',
  'with',
  'from',
  'into',
  'them',
  'they',
  'then',
  'than',
  'your',
  'yours',
  'mine',
  'just',
  'like',
  'really',
  'actually',
  'sorry',
  'please',
  'again',
  'tell',
  'give',
  'more',
  'much',
  'some',
  'anything',
  'something',
]);

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOP_WORDS.has(word)),
  );
}

/**
 * How alike two questions are, by the content words they share.
 *
 * Jaccard overlap on words that carry subject matter. Crude, and enough: the case
 * worth catching is a trainee asking about the same thing twice, which shares nouns.
 */
export function questionOverlap(a: string, b: string): number {
  const first = contentWords(a);
  const second = contentWords(b);
  if (first.size === 0 || second.size === 0) return 0;

  let shared = 0;
  for (const word of first) if (second.has(word)) shared += 1;

  return shared / new Set([...first, ...second]).size;
}

/**
 * Above this, two questions are about the same thing.
 *
 * Set from what real pairs look like: "can I use my own laptop" against "what if I
 * lose it at a client site" overlaps very little and must not trip, while asking
 * about phishing twice in different words does.
 */
const SAME_QUESTION = 0.45;

/**
 * An earlier question that this one repeats, if there is one.
 *
 * A trainee asking the same thing twice is telling you the first answer did not
 * land. Repeating it more slowly is the wrong response and the most likely one, so
 * the trainer is told explicitly to change the explanation instead.
 */
export function earlierSimilarQuestion(
  history: HistoryTurn[],
  question: string,
): string | undefined {
  const asked = question.trim();
  if (asked.length === 0) return undefined;

  let best: { text: string; score: number } | undefined;

  for (const turn of history) {
    if (turn.speaker !== 'trainee') continue;
    if (turn.text.trim().toLowerCase() === asked.toLowerCase()) {
      // Word for word. Nothing to weigh up.
      return turn.text;
    }
    const score = questionOverlap(turn.text, asked);
    if (score >= SAME_QUESTION && (!best || score > best.score)) {
      best = { text: turn.text, score };
    }
  }

  return best?.text;
}

/** How many turns in a row have happened on the slide currently showing. */
export function turnsOnSlide(history: HistoryTurn[], slideId: number): number {
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].slideId !== slideId) break;
    count += 1;
  }
  return count;
}
