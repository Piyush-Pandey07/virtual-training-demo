/**
 * Dumps every prompt the trainer can build, plus the deterministic selection
 * results, to stdout.
 *
 * This exists to prove that making the deck a value changed nothing. Run it on the
 * old code, run it on the new code, diff the two. A refactor that claims to be
 * behaviour-preserving is worth exactly as much as the diff that proves it.
 *
 * The `teaches` flag is deliberately excluded from the slide dump. It is a field
 * this refactor adds, so including it would put an expected difference in the way
 * of seeing an unexpected one.
 */

import { clampSlideId, estimatedMinutes, getSlide, totalSlides } from '../src/lib/deck';
import { ISMS_DECK } from '../src/lib/decks/isms';
import {
  bestSlideForQuestion,
  renderKnowledge,
  renderTopicIndex,
  selectKnowledge,
  topicsForSlide,
} from '../src/lib/knowledge';
import {
  buildSystemInstruction,
  buildTurnPrompt,
  detectAnswerStyle,
} from '../src/lib/trainer-prompt';
import type { HistoryTurn, LearnerProfile, TurnKind } from '../src/lib/types';

const deck = ISMS_DECK;
const TOTAL = totalSlides(deck);

const out: string[] = [];
const rule = (s: string) => out.push('\n' + '='.repeat(78) + '\n' + s + '\n' + '='.repeat(78));

const HISTORY: HistoryTurn[] = [
  {
    speaker: 'trainer',
    text: 'Welcome to the session. We will start with what an ISMS is.',
    slideId: 1,
  },
  { speaker: 'trainee', text: 'Sounds good.', slideId: 1 },
  {
    speaker: 'trainer',
    text: 'An ISMS is the management system for information security.',
    slideId: 2,
  },
  { speaker: 'trainee', text: 'Does that mean it is just paperwork?', slideId: 2 },
];

const LEARNER: LearnerProfile = {
  questionsAsked: 3,
  curiousAbout: [2, 4],
  prefersSimpler: true,
  prefersDepth: false,
  askedForStandard: true,
};

const QUESTIONS = [
  'can you explain that in simpler terms',
  'can you give me an example',
  'which annex a control covers that',
  'can you go deeper on how that actually works',
  'what about passwords',
  'what is phishing',
  'how do I classify a document',
  'what if I lose my laptop',
  'can I use public wifi at a client site',
  'who do I report an incident to',
  'is tailgating really a problem',
  'what happens if I use my personal gmail for work',
];

rule('DECK CONSTANTS');
out.push(`DECK_TITLE=${deck.meta.title}`);
out.push(`DECK_SUBTITLE=${deck.meta.subtitle}`);
out.push(`DECK_SUBJECT_SPOKEN=${deck.meta.spokenSubject}`);
out.push(`DECK_OWNER=${deck.meta.owner}`);
out.push(`TOTAL_SLIDES=${TOTAL}`);
out.push(`ESTIMATED_MINUTES=${estimatedMinutes(deck)}`);
out.push(`ALL_TOPICS=${deck.topics.length}`);
out.push(`topic ids: ${deck.topics.map((t) => t.id).join(',')}`);

rule('CLAMP');
for (const n of [-5, 0, 1, 3, 7, 8, 99, NaN, 2.4, 2.6]) {
  out.push(`clampSlideId(${n}) = ${clampSlideId(deck, n)}`);
}

rule('SLIDES, FULL SERVER-SIDE SHAPE');
for (const s of deck.slides) {
  const comparable: Record<string, unknown> = { ...s };
  delete comparable.teaches;
  out.push(JSON.stringify(comparable, null, 1));
}

rule('TOPICS PER SLIDE');
for (let id = 1; id <= TOTAL; id += 1) {
  out.push(
    `slide ${id}: ${
      topicsForSlide(deck, id)
        .map((t) => t.id)
        .join(',') || '(none)'
    }`,
  );
}

rule('TOPIC INDEX');
out.push(renderTopicIndex(deck));

rule('NAVIGATION');
for (const q of QUESTIONS) {
  for (let from = 1; from <= TOTAL; from += 1) {
    const m = bestSlideForQuestion(deck, q, from);
    out.push(`from ${from} "${q}" -> ${m ? `${m.slideId} (score ${m.score})` : 'stay'}`);
  }
}

rule('ANSWER STYLE');
for (const q of QUESTIONS) out.push(`"${q}" -> ${detectAnswerStyle(q)}`);

rule('KNOWLEDGE SELECTION, NARRATION');
for (let id = 1; id <= TOTAL; id += 1) {
  const sel = selectKnowledge({ deck, slideId: id });
  out.push(`slide ${id}: ${sel.map((e) => `${e.topic.id}:${e.weight}`).join(' ')}`);
}

rule('KNOWLEDGE SELECTION, QUESTIONS');
for (const q of QUESTIONS) {
  for (const id of [2, 4, 6]) {
    const sel = selectKnowledge({ deck, slideId: id, question: q });
    out.push(`slide ${id} "${q}": ${sel.map((e) => `${e.topic.id}:${e.weight}`).join(' ')}`);
  }
}

rule('KNOWLEDGE SELECTION, WHOLE DECK');
out.push(
  selectKnowledge({ deck, slideId: 7, wholeDeck: true })
    .map((e) => `${e.topic.id}:${e.weight}`)
    .join(' '),
);

rule('RENDERED KNOWLEDGE, SLIDE 2 NARRATION');
out.push(renderKnowledge(selectKnowledge({ deck, slideId: 2 })));

rule('RENDERED KNOWLEDGE, SLIDE 4 QUESTION');
out.push(
  renderKnowledge(selectKnowledge({ deck, slideId: 4, question: 'how do I classify a document' })),
);

rule('SYSTEM INSTRUCTION, NO NAME');
out.push(buildSystemInstruction(deck));

rule('SYSTEM INSTRUCTION, NAMED');
out.push(buildSystemInstruction(deck, 'Priya'));

for (const kind of ['narrate', 'answer', 'quiz', 'recap'] as TurnKind[]) {
  for (let id = 1; id <= TOTAL; id += 1) {
    const slide = getSlide(deck, id)!;
    if (kind === 'answer') {
      for (const question of QUESTIONS) {
        rule(`TURN PROMPT ${kind} slide ${id} :: ${question}`);
        out.push(
          buildTurnPrompt({
            deck,
            kind,
            slide,
            history: HISTORY,
            question,
            coveredSlideIds: [1, 2, 3],
            learner: LEARNER,
          }),
        );
      }
    } else {
      rule(`TURN PROMPT ${kind} slide ${id}`);
      out.push(
        buildTurnPrompt({
          deck,
          kind,
          slide,
          history: HISTORY,
          coveredSlideIds: [1, 2, 3],
          learner: LEARNER,
        }),
      );
      rule(`TURN PROMPT ${kind} slide ${id} :: no history, no learner`);
      out.push(buildTurnPrompt({ deck, kind, slide, history: [], coveredSlideIds: [] }));
    }
  }
}

process.stdout.write(out.join('\n') + '\n');
