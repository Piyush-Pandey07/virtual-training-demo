import { getSlide } from '../../src/lib/deck';
import { ISMS_DECK } from '../../src/lib/decks/isms';
import { buildTurnPrompt } from '../../src/lib/trainer-prompt';
import { lastTurnAskedSomething, closingSentence } from '../../src/lib/trainee-read';
import type { HistoryTurn } from '../../src/lib/types';

const slide = getSlide(ISMS_DECK, 3)!;
const mk = (closing: string): HistoryTurn[] => [
  { speaker: 'trainer', text: 'An ISMS is the management system for information security. ' + closing, slideId: 3 },
  { speaker: 'trainee', text: 'so is it just paperwork then?', slideId: 3 },
  { speaker: 'trainer', text: 'Not paperwork for its own sake. ' + closing, slideId: 3 },
];

for (const closing of [
  'What would you do if it came from a colleague\u2019s address instead?',
  'That one is fairly self-contained, so where next?',
  'There is a version of this that catches people out with shared mailboxes, if that is useful.',
]) {
  const h = mk(closing);
  const p = buildTurnPrompt({ deck: ISMS_DECK, kind: 'answer', slide, history: h, question: 'what are the four classification tiers', coveredSlideIds: [1,2,3] });
  const words = p.split(/\s+/).filter(Boolean).length;
  console.log('closing:', JSON.stringify(closingSentence(h[h.length-1].text).slice(0,50)));
  console.log('  lastTurnAskedSomething:', lastTurnAskedSomething(h));
  console.log('  block present:', p.includes('YOUR LAST TURN ENDED WITH A QUESTION'));
  console.log('  answer prompt words:', words, ' chars:', p.length);
}

const block = 'YOUR LAST TURN ENDED WITH A QUESTION\nSo what they have just said may be an attempt at it rather than a new question. If it is, respond to the attempt: say what was right before anything else, and never leave a wrong answer standing.';
console.log('\nblock words:', block.split(/\s+/).filter(Boolean).length, 'chars:', block.length);
