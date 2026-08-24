/**
 * Measures how big the prompts actually get, on this deck and on a large one.
 *
 * The deck reference block had no input bound: it serialised every slide's bullets
 * and presenter notes on the answer, quiz and recap paths. On seven slides that is
 * invisible. On sixty it is the dominant cost of every question the trainee asks,
 * and it pushes the material that would actually answer them further from the
 * model's attention.
 *
 * Run before and after a change to the reference tiers. `npm run prompt-size`.
 */

import { getSlide, totalSlides } from '../src/lib/deck';
import type { DeckRecord } from '../src/lib/deck-types';
import { ISMS_DECK } from '../src/lib/decks/isms';
import { syntheticDeck } from '../src/lib/__fixtures__/synthetic-deck';
import { buildSystemInstruction, buildTurnPrompt } from '../src/lib/trainer-prompt';
import type { HistoryTurn, TurnKind } from '../src/lib/types';

const HISTORY: HistoryTurn[] = [
  {
    speaker: 'trainer',
    text: 'An ISMS is the management system for information security.',
    slideId: 2,
  },
  { speaker: 'trainee', text: 'Does that mean it is just paperwork?', slideId: 2 },
];

function measure(label: string, deck: DeckRecord) {
  const midpoint = Math.ceil(totalSlides(deck) / 2);
  const slide = getSlide(deck, midpoint)!;
  // A trainee who has worked halfway through, which is when a recap or quiz is
  // most likely and when the covered set is least trivial.
  const covered = Array.from({ length: midpoint }, (_, i) => i + 1);

  const rows: Array<[string, number]> = [
    ['system instruction', buildSystemInstruction(deck).length],
  ];

  for (const kind of ['narrate', 'answer', 'quiz', 'recap'] as TurnKind[]) {
    const prompt = buildTurnPrompt({
      deck,
      kind,
      slide,
      history: HISTORY,
      question: kind === 'answer' ? 'how do I classify a document' : undefined,
      coveredSlideIds: covered,
    });
    rows.push([`turn: ${kind}`, prompt.length]);
  }

  const worst = Math.max(...rows.map(([, n]) => n));
  const total = rows[0][1] + worst;

  console.log(`\n${label}  (${totalSlides(deck)} slides, ${deck.topics.length} topics)`);
  for (const [name, chars] of rows) {
    console.log(
      `  ${name.padEnd(20)} ${String(chars).padStart(8)} chars  ~${String(Math.round(chars / 4)).padStart(7)} tokens`,
    );
  }
  console.log(
    `  ${'WORST REQUEST'.padEnd(20)} ${String(total).padStart(8)} chars  ~${String(Math.round(total / 4)).padStart(7)} tokens`,
  );
  return total;
}

measure('ISMS deck', ISMS_DECK);
measure('synthetic', syntheticDeck(20));
measure('synthetic', syntheticDeck(40));
const big = measure('synthetic', syntheticDeck(60));

console.log(
  `\nA 60-slide deck sends ~${Math.round(big / 4).toLocaleString()} tokens of prompt on the worst turn, before the reply.`,
);
