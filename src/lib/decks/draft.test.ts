import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { totalSlides } from '../deck';
import { selectKnowledge } from '../knowledge';
import { buildTurnPrompt } from '../trainer-prompt';
import {
  deckIdFrom,
  draftDeckFrom,
  titleFromFileName,
  type DraftInput,
  type DraftPage,
} from './draft';
import { checkReadyToPublish, parseDeck, serialiseDeck } from './serialise';

function page(pageNumber: number, lines: string[]): DraftPage {
  return { pageNumber, width: 1600, height: 900, lines };
}

/** A plausible small deck: a title card, then two content pages. */
function input(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    fileName: 'Fire Safety Awareness.pdf',
    pages: [
      page(1, ['Fire Safety Awareness', 'Annual refresher']),
      page(2, [
        'Why it matters',
        'A fire doubles in size every thirty seconds',
        'Most injuries happen during evacuation, not from the fire itself',
        'Your assembly point is on the site plan by the main entrance',
      ]),
      page(3, [
        'What to do',
        'Raise the alarm at the nearest call point',
        'Leave by the nearest safe exit and do not use the lifts',
        'Report to your assembly point and wait to be counted',
      ]),
    ],
    ...overrides,
  };
}

describe('naming a deck from its file', () => {
  it('turns separators into words', () => {
    assert.equal(titleFromFileName('fire_safety-awareness.pdf'), 'fire safety awareness');
  });

  it('strips the export date and copy number real files carry', () => {
    // The actual source deck for this project is named exactly like this.
    assert.equal(
      titleFromFileName('Technavious_ISO27001_ISMS Awareness Presentation 04062025 1.pdf'),
      'Technavious ISO27001 ISMS Awareness Presentation',
    );
    assert.equal(titleFromFileName('Induction Pack (2).pdf'), 'Induction Pack');
  });

  it('falls back rather than producing a one-character title', () => {
    assert.equal(titleFromFileName('a.pdf'), 'Uploaded deck');
    assert.equal(titleFromFileName('.pdf'), 'Uploaded deck');
  });
});

describe('deck ids from titles', () => {
  it('slugifies and keeps the suffix, so the same file twice makes two decks', () => {
    assert.equal(deckIdFrom('Fire Safety Awareness', 'a1b2c3'), 'fire-safety-awareness-a1b2c3');
    assert.notEqual(deckIdFrom('X', 'aaa'), deckIdFrom('X', 'bbb'));
  });

  it('produces something usable from a title with no usable characters', () => {
    assert.equal(deckIdFrom('日本語', 'a1b2c3'), 'deck-a1b2c3');
    assert.equal(deckIdFrom('***', 'a1b2c3'), 'deck-a1b2c3');
  });

  it('never leaves a trailing or doubled hyphen', () => {
    const id = deckIdFrom('A -- B  ', 'zzz');
    assert.ok(!id.includes('--'), id);
    assert.match(id, /^[a-z0-9][a-z0-9-]*$/);
  });
});

describe('building a draft deck from a rendered PDF', () => {
  const deck = draftDeckFrom(input(), 'fire-safety-abc123');

  it('makes one slide per page, numbered by page', () => {
    assert.equal(totalSlides(deck), 3);
    assert.deepEqual(
      deck.slides.map((slide) => slide.id),
      [1, 2, 3],
    );
  });

  it('points each slide at its own render', () => {
    assert.equal(deck.slides[1].image, '/api/decks/fire-safety-abc123/assets/pages/2.webp');
  });

  it('carries the page size, so the stage is not forced to assume 16:9', () => {
    assert.equal(deck.slides[0].width, 1600);
    assert.equal(deck.slides[0].height, 900);
  });

  it('uses the text on the page as the slide content', () => {
    assert.ok(deck.slides[1].bullets.includes('A fire doubles in size every thirty seconds'));
  });

  it('takes the deck title from the file and the subtitle from the first page', () => {
    assert.equal(deck.meta.title, 'Fire Safety Awareness');
    assert.equal(deck.meta.subtitle, 'Annual refresher');
  });

  it('prefers the PDF metadata title when it has one', () => {
    const titled = draftDeckFrom(
      input({ documentTitle: 'Fire Safety, 2026 Edition' }),
      'fire-safety-abc123',
    );
    assert.equal(titled.meta.title, 'Fire Safety, 2026 Edition');
  });

  it('treats a sparse opening page as a title card', () => {
    assert.equal(deck.slides[0].teaches, false);
    assert.equal(deck.slides[1].teaches, true);
  });

  it('does not silence a sparse page in the middle', () => {
    // A section divider still deserves a sentence, and marking it silent would stop
    // a question ever navigating there.
    const withDivider = draftDeckFrom(
      input({
        pages: [page(1, ['Title']), page(2, ['Part Two']), page(3, ['Lots', 'of', 'content here'])],
      }),
      'd-1',
    );
    assert.equal(withDivider.slides[1].teaches, true);
  });

  it('gives a busier page a longer budget than a sparse one', () => {
    assert.ok(deck.slides[2].targetSeconds > deck.slides[0].targetSeconds);
  });

  it('keeps every budget inside what a person can listen to', () => {
    const wall = draftDeckFrom(
      input({
        pages: [
          page(
            1,
            Array.from({ length: 150 }, () => 'a fairly long line of text'),
          ),
        ],
      }),
      'd-2',
    );
    for (const slide of wall.slides) {
      assert.ok(slide.targetSeconds >= 30 && slide.targetSeconds <= 180, `${slide.targetSeconds}s`);
    }
  });

  it('bounds a wall of text rather than sending all of it to the model', () => {
    const wall = draftDeckFrom(
      input({
        pages: [
          page(
            1,
            Array.from({ length: 500 }, (_, i) => `line ${i}`),
          ),
        ],
      }),
      'd-3',
    );
    assert.ok(wall.slides[0].bullets.length <= 40);
  });

  it('invents no presenter notes and no author notes', () => {
    for (const slide of deck.slides) {
      assert.deepEqual(slide.speakerNotes, []);
      assert.deepEqual(slide.internalNotes, []);
    }
  });

  it('claims no expertise it does not have', () => {
    // The honest state of a deck that has been read but not analysed.
    assert.deepEqual(deck.topics, []);
  });
});

describe('a draft deck is storable but not publishable', () => {
  const deck = draftDeckFrom(input(), 'fire-safety-abc123');

  it('survives a round trip through storage', () => {
    const parsed = parseDeck(serialiseDeck(deck));
    assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('; '));
    assert.deepEqual(parsed.record, deck);
  });

  it('fails the publish check, naming the expertise it lacks', () => {
    const problems = checkReadyToPublish(deck);
    assert.ok(problems.length > 0);
    assert.ok(problems.some((problem) => problem.includes('no expertise behind it')));
  });
});

/**
 * The point of building a real deck rather than a placeholder: a draft can be
 * previewed. If it could not produce a prompt, there would be nothing to look at
 * between uploading a deck and analysing it.
 */
describe('a draft deck can still run a session', () => {
  const deck = draftDeckFrom(input(), 'fire-safety-abc123');

  it('produces a narration prompt carrying the slide text', () => {
    const prompt = buildTurnPrompt({
      deck,
      kind: 'narrate',
      slide: deck.slides[1],
      history: [],
      coveredSlideIds: [1],
    });

    assert.ok(prompt.includes('A fire doubles in size every thirty seconds'));
    assert.ok(prompt.includes('words'), 'the length budget is missing');
  });

  it('tells the trainer it is working from the slide alone', () => {
    assert.ok(deck.slides[1].narrationBrief.includes('has not been analysed'));
  });

  it('selects no expertise, without falling over', () => {
    assert.deepEqual(selectKnowledge({ deck, slideId: 2 }), []);
  });

  it('answers a question without an empty section header dangling', () => {
    const prompt = buildTurnPrompt({
      deck,
      kind: 'answer',
      slide: deck.slides[1],
      history: [],
      question: 'where do I go when the alarm sounds',
      coveredSlideIds: [1, 2],
    });

    // keyPoints and discussionPrompts are empty on a draft, and a heading with
    // nothing under it reads to the model as a section it failed to fill in.
    assert.ok(!/Points to cover before moving on:\s*\n\s*\n/.test(prompt));
    assert.ok(!/Ways you could invite a response:\s*\n\s*\n/.test(prompt));
  });
});
