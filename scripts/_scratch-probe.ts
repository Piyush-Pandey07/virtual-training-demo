import { getSlide } from '../src/lib/deck';
import { ISMS_DECK } from '../src/lib/decks/isms';
import { buildTurnPrompt, ANSWER_WORD_BUDGET } from '../src/lib/trainer-prompt';
import { detectAnswerStyle } from '../src/lib/intent';
import type { HistoryTurn } from '../src/lib/types';

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

for (const [sid, q] of [[3, 'sorry, what actually is an ISMS? I got lost'], [5, 'what are the four classification tiers'], [3, 'so is it just paperwork then?']] as Array<[number, string]>) {
  const slide = getSlide(ISMS_DECK, sid)!;
  const history: HistoryTurn[] = [
    { speaker: 'trainer', text: 'Welcome. Right, so where shall we begin?', slideId: 1 },
  ];
  const p = buildTurnPrompt({ deck: ISMS_DECK, kind: 'answer', slide, history, question: q, coveredSlideIds: [1, 2, 3] });
  const iPrompts = p.indexOf('Ways you could invite a response');
  const iHand = p.indexOf('HOW TO HAND BACK');
  const iTask = p.indexOf('YOUR TASK');
  const iStyle = p.indexOf('WHAT KIND OF ANSWER THEY WANT');
  console.log(`\n--- slide ${sid} | style ${detectAnswerStyle(q)} | budget ${ANSWER_WORD_BUDGET[detectAnswerStyle(q)]}`);
  console.log(`  total prompt words           : ${words(p)}`);
  console.log(`  'Ways you could...' at word  : ${words(p.slice(0, iPrompts))}`);
  console.log(`  'WHAT KIND OF ANSWER' at word: ${words(p.slice(0, iStyle))}`);
  console.log(`  'YOUR TASK' at word          : ${words(p.slice(0, iTask))}`);
  console.log(`  'HOW TO HAND BACK' at word   : ${words(p.slice(0, iHand))}`);
  console.log(`  words between them           : ${words(p.slice(iPrompts, iHand))}`);
  console.log(`  discussionPrompts block:\n${p.slice(iPrompts, p.indexOf('\n\n', iPrompts))}`);
}
