import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getSlide } from '../deck';
import type { DeckRecord } from '../deck-types';
import { draftDeckFrom } from '../decks/draft';
import { ISMS_DECK } from '../decks/isms';
import { buildTurnPrompt } from '../trainer-prompt';
import {
  briefReadsAsSummary,
  detailBatches,
  maxKeyPoints,
  mergeSlideDetail,
  type SlideDetail,
} from './slide-detail';

function draft(pages = 5): DeckRecord {
  return draftDeckFrom(
    {
      fileName: 'Something Awareness.pdf',
      pages: Array.from({ length: pages }, (_, index) => ({
        pageNumber: index + 1,
        width: 1600,
        height: 900,
        lines: [`Heading ${index + 1}`, 'a line of body text', 'and another line of it'],
      })),
    },
    'something-abc123',
  );
}

const detail = (pageNumber: number, overrides: Partial<SlideDetail> = {}): SlideDetail => ({
  pageNumber,
  narrationBrief: `Open on the point of page ${pageNumber}, then name the rest without dwelling.`,
  keyPoints: [`First point for ${pageNumber}`, `Second point for ${pageNumber}`],
  discussionPrompts: [`What have you seen like this?`, `Where does that come up for you?`],
  ...overrides,
});

/**
 * The hand-authored deck is the bar, and it is not proportional: forty seconds
 * carries four key points and a hundred and twenty-five carries seven. The cap is
 * there to stop a wall of text, not to ration coverage.
 */
describe('how many points a slide may list', () => {
  it('gives a longer slide more room', () => {
    assert.ok(maxKeyPoints(150) > maxKeyPoints(45));
  });

  it('never leaves a slide with fewer than three', () => {
    for (const seconds of [1, 15, 30, 45]) {
      assert.ok(maxKeyPoints(seconds) >= 3, `${seconds}s gave ${maxKeyPoints(seconds)}`);
    }
  });

  it('never exceeds what the hand-authored deck carries', () => {
    // Slide 3 of the ISMS deck has seven, and it is the busiest.
    for (const seconds of [150, 300, 3600]) {
      assert.ok(maxKeyPoints(seconds) <= 7, `${seconds}s gave ${maxKeyPoints(seconds)}`);
    }
  });

  it('lands near the hand-authored deck on its own slides', () => {
    // Slide 2 is 150s with 6 points, slide 3 is 125s with 7. Within one either way is
    // the most that can be claimed from a sample this size, but a cap that said 3 for
    // a 150 second slide would be visibly wrong.
    assert.ok(Math.abs(maxKeyPoints(150) - 6) <= 1);
    assert.ok(Math.abs(maxKeyPoints(125) - 7) <= 2);
  });
});

describe('applying the teaching detail', () => {
  const deck = draft(5);

  it('fills the three fields on the pages it was given', () => {
    const updated = mergeSlideDetail(deck, [detail(2)]);
    assert.match(updated.slides[1].narrationBrief, /^Open on the point of page 2/);
    assert.equal(updated.slides[1].keyPoints.length, 2);
    assert.equal(updated.slides[1].discussionPrompts.length, 2);
  });

  it('replaces the placeholder brief a draft carries', () => {
    // The reason this pass exists. Before it, an outline-analysed deck still told the
    // trainer "this deck has not been analysed yet", which stopped being true the
    // moment the outline pass shipped.
    assert.match(deck.slides[1].narrationBrief, /has not been analysed yet/);
    const updated = mergeSlideDetail(deck, [detail(2)]);
    assert.ok(!/has not been analysed yet/.test(updated.slides[1].narrationBrief));
  });

  it('leaves a page it was not given exactly as it was', () => {
    const updated = mergeSlideDetail(deck, [detail(1)]);
    assert.deepEqual(updated.slides[3], deck.slides[3]);
  });

  it('ignores an entry for a page that is not in the deck', () => {
    assert.deepEqual(mergeSlideDetail(deck, [detail(99)]).slides, deck.slides);
  });

  it('caps key points at what the slide has time for', () => {
    // A model that returns nine points for a short slide has read the page and
    // misjudged the clock. Taking the first few beats discarding the lot, and the
    // trainer sees what survived.
    const many = Array.from({ length: 12 }, (_, index) => `Point ${index}`);
    const updated = mergeSlideDetail(deck, [detail(1, { keyPoints: many })]);
    assert.equal(updated.slides[0].keyPoints.length, maxKeyPoints(deck.slides[0].targetSeconds));
  });

  it('keeps exactly two discussion prompts', () => {
    const updated = mergeSlideDetail(deck, [
      detail(1, { discussionPrompts: ['a', 'b', 'c', 'd'] }),
    ]);
    assert.equal(updated.slides[0].discussionPrompts.length, 2);
  });

  it('drops blank entries rather than storing them', () => {
    const updated = mergeSlideDetail(deck, [
      detail(1, { keyPoints: ['real point', '   ', '', 'another'] }),
    ]);
    assert.deepEqual(updated.slides[0].keyPoints, ['real point', 'another']);
  });

  it('keeps what was there when a field comes back empty', () => {
    const before = mergeSlideDetail(deck, [detail(1)]);
    const after = mergeSlideDetail(before, [
      detail(1, { narrationBrief: '   ', keyPoints: [], discussionPrompts: [] }),
    ]);
    assert.equal(after.slides[0].narrationBrief, before.slides[0].narrationBrief);
    assert.deepEqual(after.slides[0].keyPoints, before.slides[0].keyPoints);
  });

  it('touches nothing the outline pass owns', () => {
    const updated = mergeSlideDetail(deck, [detail(1)]);
    for (const field of [
      'title',
      'shortLabel',
      'summary',
      'role',
      'targetSeconds',
      'image',
    ] as const) {
      assert.deepEqual(updated.slides[0][field], deck.slides[0][field], field);
    }
  });

  it('adds no expertise, which is a later pass', () => {
    assert.deepEqual(mergeSlideDetail(deck, [detail(1)]).topics, []);
  });
});

/**
 * A brief that opens "This page covers..." is a description, and the trainer already
 * has one of those in the slide's summary. Measured: with the instruction in the
 * prompt body, four briefs in five opened that way; moved into the schema field's own
 * description, none did.
 */
describe('spotting a brief that is really a summary', () => {
  const summaries = [
    'This page covers the four classification tiers.',
    'This slide explains what an ISMS is.',
    'The page details the reporting routes.',
  ];

  for (const brief of summaries) {
    it(`flags "${brief.slice(0, 40)}..."`, () => {
      assert.equal(briefReadsAsSummary(brief), true);
    });
  }

  const briefs = [
    'Build the definition in two steps, and stress the word systematically.',
    'Name all six, then go properly into the two that matter most.',
    'Open on why this matters before naming anything.',
    // Slide 7 of the hand-authored deck opens exactly like this. The first version of
    // the detector keyed on the opener and flagged it, which is what caught the flaw:
    // "completes" tells the trainer where the page sits, and that is an instruction.
    'This slide completes the reporting routes with the two phone numbers.',
  ];

  for (const brief of briefs) {
    it(`leaves "${brief.slice(0, 40)}..." alone`, () => {
      assert.equal(briefReadsAsSummary(brief), false);
    });
  }

  it('agrees that every hand-authored brief is a brief', () => {
    for (const slide of ISMS_DECK.slides) {
      assert.equal(
        briefReadsAsSummary(slide.narrationBrief),
        false,
        `slide ${slide.id}: ${slide.narrationBrief.slice(0, 60)}`,
      );
    }
  });
});

describe('splitting a deck into batches for this pass', () => {
  it('covers every page exactly once', () => {
    for (const pages of [1, 5, 12, 37]) {
      const deck = draft(pages);
      assert.deepEqual(
        detailBatches(deck).flat(),
        deck.slides.map((slide) => slide.id),
        `${pages} pages`,
      );
    }
  });

  it('uses smaller batches than the outline pass, since each page returns more', () => {
    assert.ok(detailBatches(draft(20))[0].length <= 5);
  });
});

/**
 * The point of the pass: what it writes has to reach the spoken prompt.
 */
describe('what the teaching detail changes about a narration', () => {
  it('puts the brief and the key points in front of the trainer', () => {
    const deck = mergeSlideDetail(draft(5), [
      detail(2, {
        narrationBrief: 'Open on the assembly point, then name the alarm types in a clause.',
        keyPoints: ['The assembly point is on the site plan', 'Never use the lifts'],
      }),
    ]);

    const prompt = buildTurnPrompt({
      deck,
      kind: 'narrate',
      slide: getSlide(deck, 2)!,
      history: [],
      coveredSlideIds: [1],
    });

    assert.ok(prompt.includes('Open on the assembly point'));
    assert.ok(prompt.includes('The assembly point is on the site plan'));
    assert.ok(prompt.includes('Never use the lifts'));
  });

  it('restores the section headings that an empty draft suppresses', () => {
    // slideBriefing skips these headings when the lists are empty, which is what
    // stops a draft handing the model a heading with nothing under it.
    const bare = draft(5);
    const bareprompt = buildTurnPrompt({
      deck: bare,
      kind: 'narrate',
      slide: getSlide(bare, 2)!,
      history: [],
      coveredSlideIds: [1],
    });
    assert.ok(!bareprompt.includes('Points to cover before moving on:'));

    const filled = mergeSlideDetail(bare, [detail(2)]);
    const filledPrompt = buildTurnPrompt({
      deck: filled,
      kind: 'narrate',
      slide: getSlide(filled, 2)!,
      history: [],
      coveredSlideIds: [1],
    });
    assert.ok(filledPrompt.includes('Points to cover before moving on:'));
    assert.ok(filledPrompt.includes('Ways you could invite a response:'));
  });
});
