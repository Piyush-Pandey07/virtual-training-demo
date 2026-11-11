import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { groupLevel } from './assessments/service';
import { ASSESSMENT_RESULTS, resultId } from './assessments/store';
import { getSlide } from './deck';
import type { DeckRecord } from './deck-types';
import { ISMS_DECK } from './decks/isms';
import { InMemoryDocumentStore } from './roster/documents';
import {
  buildFacilitatedSystemInstruction,
  buildFacilitatedTurnPrompt,
  buildSystemInstruction,
  buildTurnPrompt,
  endsAModule,
} from './trainer-prompt';

/**
 * How delivery changes with the assessed level, names and modules (BRD v2.3: AI-37,
 * AI-08, AI-09), and the trainer-led hand-overs (AI-01, AI-02).
 */

const deck = ISMS_DECK;

describe('pitching to the assessed level (AI-37)', () => {
  it('adds the level only when there is one, and keeps the content the same', () => {
    const plain = buildSystemInstruction(deck, 'Asha');
    assert.equal(buildSystemInstruction(deck, 'Asha', undefined, null, null), plain);
    const beginner = buildSystemInstruction(deck, 'Asha', undefined, null, 'beginner');
    assert.match(beginner, /placed at beginner level/);
    assert.match(beginner, /Teach the same content whatever the level/);
    assert.match(
      buildSystemInstruction(deck, 'Asha', undefined, null, 'advanced'),
      /refer to the relevant standards/,
    );
  });

  it('takes the middle of a group, so one outlier does not set the pitch', async () => {
    const store = new InMemoryDocumentStore();
    const levels = { a: 'beginner', b: 'advanced', c: 'advanced', d: 'intermediate' } as const;
    for (const [personId, level] of Object.entries(levels)) {
      const id = resultId(personId, 'd', 'pre');
      await store.set(`orgs/acme/${ASSESSMENT_RESULTS}`, id, {
        id,
        personId,
        deckId: 'd',
        kind: 'pre',
        level,
      });
    }
    const level = await groupLevel('acme', ['a', 'b', 'c', 'd'], 'd', { store });
    assert.equal(level, 'intermediate');
    assert.equal(await groupLevel('acme', ['nobody'], 'd', { store }), null);
  });
});

describe('using the trainee name every time (AI-08)', () => {
  it('asks for the name on every answer, not in every sentence', () => {
    assert.match(
      buildSystemInstruction(deck, 'Asha'),
      /Use their first name every time you answer a question, clear a doubt or ask them something, but not in every sentence\./,
    );
  });
});

describe('an engagement question at the end of a module (AI-09)', () => {
  const withDivider: DeckRecord = {
    ...deck,
    slides: deck.slides.map((slide, index) =>
      index === 3 ? { ...slide, role: 'divider' as const } : slide,
    ),
  };

  it('knows the slide before a divider ends a module', () => {
    const before = withDivider.slides[2]!;
    assert.equal(endsAModule(withDivider, before), true);
    assert.equal(endsAModule(deck, deck.slides[2]!), false);
  });

  it('closes that slide with an engagement question instead of handing back', () => {
    const turn = buildTurnPrompt({
      deck: withDivider,
      kind: 'narrate',
      slide: withDivider.slides[2]!,
      history: [],
      coveredSlideIds: [],
    });
    assert.match(
      turn,
      /This slide closes a module, so end with one short, friendly engagement question/,
    );
  });
});

describe('a trainer-led session (AI-01, AI-02)', () => {
  const room = { attendees: ['Asha', 'Ravi'] };

  it('makes the trainer the co-facilitator, with names only', () => {
    const instruction = buildFacilitatedSystemInstruction(deck, room);
    assert.match(instruction, /co-facilitating a trainer-led session/);
    assert.match(instruction, /you are the co-facilitator, not the primary trainer/);
    assert.match(instruction, /The participants in the room are: Asha, Ravi\./);
    assert.match(instruction, /names only/);
    assert.doesNotMatch(instruction, /running a one to one live session/);
  });

  it('leaves the one-to-one instruction untouched', () => {
    assert.match(buildSystemInstruction(deck), /running a one to one live session/);
  });

  it('greets everybody by name and answers whoever asked by name', () => {
    const slide = getSlide(deck, 2)!;
    const greet = buildFacilitatedTurnPrompt({
      deck,
      slide,
      history: [],
      turn: 'greet',
      attendees: room.attendees,
    });
    assert.match(greet, /each participant by name: Asha, Ravi/);
    const answer = buildFacilitatedTurnPrompt({
      deck,
      slide,
      history: [],
      turn: 'answer',
      question: 'What is phishing?',
      askedBy: 'Ravi',
      attendees: room.attendees,
    });
    assert.match(answer, /RELAYED A QUESTION FROM RAVI/);
    assert.match(answer, /addressing Ravi by name/);
    assert.match(answer, /hand back to the facilitator/);
  });

  it('knows all fifty in a room of fifty, but greets that many as a group (AI-28)', () => {
    const fifty = Array.from({ length: 50 }, (_, index) => `Person${index}`);
    const instruction = buildFacilitatedSystemInstruction(deck, { attendees: fifty });
    for (const name of fifty) assert.ok(instruction.includes(name), name);
    const slide = deck.slides[0]!;
    const greet = buildFacilitatedTurnPrompt({
      deck,
      slide,
      history: [],
      turn: 'greet',
      attendees: fifty,
    });
    assert.match(greet, /all 50 of them as a group, without reading out their names/);
    assert.doesNotMatch(greet, /Person49/);
    const answer = buildFacilitatedTurnPrompt({
      deck,
      slide,
      history: [],
      turn: 'answer',
      question: 'Why?',
      askedBy: 'Person49',
      attendees: fifty,
    });
    assert.match(answer, /addressing Person49 by name/);
  });
});
