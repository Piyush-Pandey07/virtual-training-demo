/**
 * Measures how the trainer handles a trainee, against a running server.
 *
 * Two things that a unit test cannot see and that reading one reply will not tell
 * you either: whether answers hold their length across a session, and whether the
 * closings vary. Both only show up over eight or nine consecutive turns, which is
 * why this exists rather than an eyeballed transcript.
 *
 * The measurement that prompted it: seven of nine replies closed with the same
 * comprehension check, in slightly different words each time, while the prompt was
 * explicitly asking for variety.
 *
 * `npm run answer-quality`, with `npm run dev` already up.
 */

import { detectAnswerStyle } from '../src/lib/intent';
import { ANSWER_OVERRUN, ANSWER_WORD_BUDGET } from '../src/lib/trainer-prompt';
import type { HistoryTurn, TurnKind } from '../src/lib/types';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const DECK = process.env.DECK_ID ?? 'isms';

/**
 * The closed comprehension-check family.
 *
 * Warm once in a session. By the third time it is the clearest possible signal that
 * nobody is listening, and it invites the word yes, which ends the conversation.
 */
const COMPREHENSION_CHECK =
  /((does|did|do|would|is|was) (that|it|this|these|you)\b[^?]{0,60}(help|make sense|clear|clarify|answer|useful|follow|understand)|make sense|makes sense|hope that helps|clear\?|understood\?|sound(s)? (good|ok|right)\?)/i;

/**
 * Closings that mention questions but are not comprehension checks.
 *
 * "Does that raise any questions about what counts as a corporate device?" invites a
 * question, which is the behaviour this whole rule exists to encourage. The first
 * pass at the pattern scored it as the thing it is the opposite of.
 */
const INVITES_A_QUESTION = /\b(raise|bring up|leave|prompt)\s+(?:any|some|a)\s+questions?\b/i;

/** A realistic run: a confused start, follow-ups, then unrelated ground. */
const SCRIPT: Array<[TurnKind, string | null]> = [
  ['narrate', null],
  ['answer', 'sorry, what actually is an ISMS? I got lost'],
  ['answer', 'so is it just paperwork then?'],
  ['answer', 'can you give me an example of that'],
  ['answer', 'what are the four classification tiers'],
  ['answer', 'can I use my own laptop for work'],
  ['answer', 'what if I lose it at a client site'],
  ['answer', 'who do I tell'],
  ['answer', 'is tailgating really a problem'],
  ['answer', 'what about public wifi'],
  // Deliberately close to the second question. A trainee asking the same thing twice
  // is saying the first answer did not land, and repeating it is the wrong response.
  ['answer', 'I still do not really get what an ISMS is'],
];

const history: HistoryTurn[] = [];
let slideId = 1;
const covered = [1];

async function turn(kind: TurnKind, question: string | null): Promise<string> {
  const body: Record<string, unknown> = {
    deckId: DECK,
    kind,
    slideId,
    history,
    coveredSlideIds: covered,
  };
  if (question) body.question = question;

  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let spoken = '';
  for (const line of (await response.text()).split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const event = JSON.parse(line.slice(6)) as {
      type: string;
      delta?: string;
      slideId?: number;
      message?: string;
    };
    if (event.type === 'text') spoken += event.delta ?? '';
    if (event.type === 'nav' && event.slideId) slideId = event.slideId;
    if (event.type === 'error') throw new Error(event.message);
  }

  if (!covered.includes(slideId)) covered.push(slideId);
  if (question) history.push({ speaker: 'trainee', text: question, slideId });
  history.push({ speaker: 'trainer', text: spoken, slideId });
  return spoken.trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

interface Row {
  question: string;
  style: string;
  words: number;
  /** A reply that stopped rather than finished. See the check below. */
  truncated: boolean;
  budget: number;
  ceiling: number;
  closing: string;
  generic: boolean;
  handsBack: boolean;
}

const rows: Row[] = [];

async function main() {
  for (const [kind, question] of SCRIPT) {
    const spoken = await turn(kind, question);
    if (kind !== 'answer' || !question) continue;

    const style = detectAnswerStyle(question);
    const budget = ANSWER_WORD_BUDGET[style];
    const parts = sentences(spoken);
    const closing = parts[parts.length - 1] ?? '';

    rows.push({
      question,
      style,
      words: spoken.split(/\s+/).filter(Boolean).length,
      /**
       * A reply that was cut off rather than finished.
       *
       * Without this the harness reports a truncated answer as a disciplined one. It
       * did exactly that: capping maxOutputTokens at 900 produced a mean of 38 words
       * and nothing over its ceiling, which read as a triumph and was a model being
       * severed mid-thought. A token cap cannot make a model choose to be brief.
       *
       * A finished spoken turn ends on terminal punctuation. Anything else stopped.
       */
      truncated: !/[.!?]["')\]]?$/.test(spoken.trim()),
      budget,
      ceiling: Math.round(budget * ANSWER_OVERRUN),
      closing,
      generic: COMPREHENSION_CHECK.test(closing) && !INVITES_A_QUESTION.test(closing),
      // A statement ending "if that would be useful" hands the floor back just as
      // much as a question does, and the first pass at this scored it as flat.
      handsBack:
        closing.includes('?') ||
        /\bif (?:you|that|it)(?:'s| is| would be| are)?\s*(?:like|want|useful|helpful|relevant|of use|interested)/i.test(
          closing,
        ),
    });
  }

  console.log('\nLENGTH, against each answer’s own budget');
  for (const row of rows) {
    const over = row.words > row.ceiling ? `  OVER by ${row.words - row.ceiling}` : '';
    console.log(
      `  ${String(row.words).padStart(3)}w  budget ${String(row.budget).padStart(3)} ceiling ${String(row.ceiling).padStart(3)}  ${row.style.padEnd(8)}${over}`,
    );
  }

  const truncated = rows.filter((row) => row.truncated);
  if (truncated.length > 0) {
    console.log(
      `
  WARNING: ${truncated.length} of ${rows.length} replies did not finish. Every number below is meaningless until that is fixed: a severed reply is short, and short scores well here.`,
    );
    for (const row of truncated) {
      console.log(
        `    "${row.question}" stopped at ${row.words} words: ...${row.closing.slice(-70)}`,
      );
    }
  }

  const overCeiling = rows.filter((row) => row.words > row.ceiling);
  const mean = Math.round(rows.reduce((total, row) => total + row.words, 0) / rows.length);
  const meanBudget = Math.round(rows.reduce((total, row) => total + row.budget, 0) / rows.length);

  console.log(`\n  mean ${mean} words against a mean budget of ${meanBudget}`);
  console.log(`  over their ceiling: ${overCeiling.length}/${rows.length}`);

  console.log('\nCLOSINGS');
  for (const row of rows) {
    console.log(`  ${row.generic ? 'CHECK-IN' : 'specific'}  ${row.closing.slice(0, 88)}`);
  }

  const generic = rows.filter((row) => row.generic).length;
  const handsBack = rows.filter((row) => row.handsBack).length;
  const distinctOpeners = new Set(
    rows.map((row) => row.closing.toLowerCase().split(/\s+/).slice(0, 3).join(' ')),
  ).size;

  console.log('\nSUMMARY');
  console.log(`  comprehension checks : ${generic}/${rows.length}`);
  console.log(`  hands the floor back : ${handsBack}/${rows.length}`);
  console.log(`  distinct openings    : ${distinctOpeners}/${rows.length}`);
  console.log(`  over their ceiling   : ${overCeiling.length}/${rows.length}`);
  console.log(`  did not finish       : ${truncated.length}/${rows.length}`);
}

void main();
