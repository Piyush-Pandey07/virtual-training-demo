import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DeckMeta, DeckRecord } from '../deck-types';
import { draftDeckFrom } from '../decks/draft';
import { ISMS_DECK } from '../decks/isms';
import {
  mergeDeckMeta,
  mergeSlideOutlines,
  outlineBatches,
  secondsForDepth,
  type DeckMetaAnalysis,
  type SlideOutline,
} from './outline';

const NOW = '2026-01-01T00:00:00.000Z';

function draft(pages = 5): DeckRecord {
  return draftDeckFrom(
    {
      fileName: 'Something Awareness.pdf',
      pages: Array.from({ length: pages }, (_, index) => ({
        pageNumber: index + 1,
        width: 1600,
        height: 900,
        lines: [`Heading ${index + 1}`, 'a line of body text on the page', 'and another one'],
      })),
    },
    'something-abc123',
  );
}

function analysis(overrides: Partial<DeckMetaAnalysis> = {}): DeckMetaAnalysis {
  return {
    title: 'Fire Safety Awareness',
    subtitle: 'Evacuation, alarms and your responsibilities',
    spokenSubject: 'Fire Safety Awareness And Evacuation',
    owner: 'Acme Industries',
    ownerNamedInDeck: true,
    ownerDescription: 'a manufacturing business',
    trainerRole: 'a fire safety officer',
    practitionerCredential: 'someone who has run evacuation drills on live sites',
    exampleDomain: 'assembly points, fire doors, alarm panels, drill records',
    exampleContext: 'site operations',
    closingReminder: 'where your assembly point is',
    ...overrides,
  };
}

/**
 * The owner guard is the sharpest thing in this file.
 *
 * `owner` is spliced into "the deck is the authority on ___ policy" and spoken to a
 * trainee. A model asked who a deck belongs to will supply a plausible company name
 * whether or not the deck named one, and the result is a trainer confidently
 * asserting something false about the trainee's own employer.
 */
describe('applying the deck-level analysis', () => {
  const existing = draft().meta;

  it('takes an organisation the deck actually named', () => {
    const meta = mergeDeckMeta(existing, analysis(), NOW);
    assert.equal(meta.owner, 'Acme Industries');
    assert.equal(meta.ownerDescription, 'a manufacturing business');
  });

  it('refuses an organisation the deck did not name', () => {
    const meta = mergeDeckMeta(
      existing,
      analysis({ owner: 'Acme Industries', ownerNamedInDeck: false }),
      NOW,
    );
    assert.equal(meta.owner, 'your organisation');
    assert.equal(meta.ownerDescription, 'the organisation this deck belongs to');
  });

  it('refuses a neutral placeholder dressed up as a real answer', () => {
    // Models set the flag true and return the placeholder anyway often enough that
    // trusting the flag alone is not sufficient.
    const meta = mergeDeckMeta(
      existing,
      analysis({ owner: 'Your Organisation', ownerNamedInDeck: true }),
      NOW,
    );
    assert.equal(meta.owner, 'your organisation');
  });

  it('refuses an empty organisation even when flagged as named', () => {
    const meta = mergeDeckMeta(existing, analysis({ owner: '   ', ownerNamedInDeck: true }), NOW);
    assert.equal(meta.owner, 'your organisation');
  });

  it('lowercases the spoken subject, since it lands mid-sentence', () => {
    const meta = mergeDeckMeta(existing, analysis(), NOW);
    assert.equal(meta.spokenSubject, 'fire safety awareness and evacuation');
  });

  it('keeps what was there when a field comes back blank', () => {
    const meta = mergeDeckMeta(existing, analysis({ title: '', trainerRole: '  ' }), NOW);
    assert.equal(meta.title, existing.title);
    assert.equal(meta.trainerRole, existing.trainerRole);
  });

  it('records when it ran and against which prompt', () => {
    const meta = mergeDeckMeta(existing, analysis(), NOW);
    assert.equal(meta.outlineAnalysedAt, NOW);
    assert.ok((meta.outlinePromptVersion ?? 0) >= 1);
  });

  it('changes nothing structural', () => {
    const before = draft();
    const meta = mergeDeckMeta(before.meta, analysis(), NOW);
    assert.equal(meta.id, before.meta.id);
  });
});

/**
 * Asked as a rating rather than in seconds, so the mapping to time stays in code.
 * Asked for directly, models return round numbers unrelated to each other and
 * occasionally ten minutes.
 */
describe('turning a depth rating into a time budget', () => {
  it('rises with depth', () => {
    const seconds = [1, 2, 3, 4, 5].map(secondsForDepth);
    for (let i = 1; i < seconds.length; i += 1) {
      assert.ok(seconds[i] > seconds[i - 1], seconds.join(','));
    }
  });

  it('stays inside what a person can listen to', () => {
    for (const depth of [-5, 0, 1, 3, 5, 9, 100]) {
      const seconds = secondsForDepth(depth);
      assert.ok(seconds >= 40 && seconds <= 180, `depth ${depth} gave ${seconds}s`);
    }
  });

  it('rounds a fractional rating rather than falling over', () => {
    assert.equal(secondsForDepth(3.4), secondsForDepth(3));
    assert.equal(secondsForDepth(3.6), secondsForDepth(4));
  });
});

describe('applying slide outlines', () => {
  const deck = draft(5);

  const outline = (pageNumber: number, overrides: Partial<SlideOutline> = {}): SlideOutline => ({
    pageNumber,
    title: `Real heading ${pageNumber}`,
    shortLabel: `Label ${pageNumber}`,
    summary: `What page ${pageNumber} is about`,
    role: 'content',
    teachingDepth: 3,
    ...overrides,
  });

  it('applies each entry to its own slide', () => {
    const updated = mergeSlideOutlines(deck, [outline(2), outline(4)]);
    assert.equal(updated.slides[1].title, 'Real heading 2');
    assert.equal(updated.slides[3].title, 'Real heading 4');
  });

  it('leaves a page the model skipped exactly as it was', () => {
    // A partial answer should degrade, not blank half the deck.
    const updated = mergeSlideOutlines(deck, [outline(1)]);
    assert.deepEqual(updated.slides[2], deck.slides[2]);
  });

  it('ignores an entry for a page that is not in the deck', () => {
    const updated = mergeSlideOutlines(deck, [outline(99)]);
    assert.deepEqual(updated.slides, deck.slides);
  });

  it('derives teaches from the role, so the two cannot disagree', () => {
    const updated = mergeSlideOutlines(deck, [
      outline(1, { role: 'title' }),
      outline(2, { role: 'divider' }),
      outline(3, { role: 'closing' }),
      outline(4, { role: 'content' }),
    ]);
    assert.equal(updated.slides[0].teaches, false, 'a cover page teaches nothing');
    assert.equal(updated.slides[1].teaches, true, 'a divider is still worth a sentence');
    assert.equal(updated.slides[2].teaches, true);
    assert.equal(updated.slides[3].teaches, true);
  });

  it('falls back to content on a role it does not recognise', () => {
    const updated = mergeSlideOutlines(deck, [
      outline(1, { role: 'nonsense' as SlideOutline['role'] }),
    ]);
    assert.equal(updated.slides[0].role, 'content');
    assert.equal(updated.slides[0].teaches, true);
  });

  it('trims a rail label to what the rail can show', () => {
    const updated = mergeSlideOutlines(deck, [
      outline(1, { shortLabel: 'an extremely long label that would push the numbers off screen' }),
    ]);
    assert.ok(updated.slides[0].shortLabel.length <= 24, updated.slides[0].shortLabel);
  });

  it('keeps the existing text when an entry comes back blank', () => {
    const updated = mergeSlideOutlines(deck, [outline(1, { title: '', summary: '   ' })]);
    assert.equal(updated.slides[0].title, deck.slides[0].title);
    assert.equal(updated.slides[0].summary, deck.slides[0].summary);
  });

  it('never overwrites what the page actually printed', () => {
    // printedTitle is the only record of what the page looked like, and re-analysis
    // has to read the page rather than its own previous answer.
    const withPrinted: DeckRecord = {
      ...deck,
      slides: deck.slides.map((slide) => ({ ...slide, printedTitle: `printed ${slide.id}` })),
    };
    const updated = mergeSlideOutlines(withPrinted, [outline(1), outline(2)]);
    assert.equal(updated.slides[0].printedTitle, 'printed 1');
    assert.equal(updated.slides[1].printedTitle, 'printed 2');
  });

  it('leaves the slide images alone', () => {
    const updated = mergeSlideOutlines(
      deck,
      deck.slides.map((slide) => outline(slide.id)),
    );
    for (const [index, slide] of updated.slides.entries()) {
      assert.equal(slide.image, deck.slides[index].image);
    }
  });

  it('adds no expertise, which is a later pass', () => {
    const updated = mergeSlideOutlines(deck, [outline(1)]);
    assert.deepEqual(updated.topics, []);
  });
});

describe('splitting a deck into batches', () => {
  it('covers every page exactly once', () => {
    for (const pages of [1, 5, 10, 11, 37, 60]) {
      const deck = draft(pages);
      const flat = outlineBatches(deck).flat();
      assert.deepEqual(
        flat,
        deck.slides.map((slide) => slide.id),
        `${pages} pages`,
      );
    }
  });

  it('respects the batch size', () => {
    const batches = outlineBatches(draft(25), 10);
    assert.deepEqual(
      batches.map((batch) => batch.length),
      [10, 10, 5],
    );
  });

  it('handles an exact multiple without an empty batch at the end', () => {
    const batches = outlineBatches(draft(20), 10);
    assert.equal(batches.length, 2);
  });

  it('keeps a large deck to a workable number of steps', () => {
    // Each batch is one model call inside one request, so this is what decides
    // whether a sixty-page deck is analysable at all.
    assert.ok(outlineBatches(draft(60)).length <= 8);
  });
});

/**
 * The point of the outline pass: an analysed deck stops sounding like a placeholder.
 */
describe('what analysis changes about a session', () => {
  it('replaces the placeholder meta with something speakable', () => {
    const before = draft();
    assert.equal(before.meta.owner, 'your organisation');

    const after: DeckRecord = {
      ...before,
      meta: mergeDeckMeta(before.meta, analysis(), NOW),
    };
    assert.equal(after.meta.owner, 'Acme Industries');
    assert.equal(after.meta.trainerRole, 'a fire safety officer');
    assert.notEqual(after.meta.spokenSubject, before.meta.spokenSubject);
  });

  it('still needs expertise before it can be published', () => {
    // Deliberate. The outline says what the deck is; it does not give the trainer
    // anything to teach beyond the slides.
    const before = draft();
    const meta: DeckMeta = mergeDeckMeta(before.meta, analysis(), NOW);
    const after = mergeSlideOutlines(
      { ...before, meta },
      before.slides.map((slide) => ({
        pageNumber: slide.id,
        title: 'x',
        shortLabel: 'x',
        summary: 'x',
        role: 'content' as const,
        teachingDepth: 3,
      })),
    );
    assert.deepEqual(after.topics, []);
  });
});

describe('the hand-authored deck is left alone by all of this', () => {
  it('has no role or printedTitle, and does not need them', () => {
    for (const slide of ISMS_DECK.slides) {
      assert.equal(slide.role, undefined);
      assert.equal(slide.printedTitle, undefined);
    }
  });

  it('has never been analysed, and says so', () => {
    assert.equal(ISMS_DECK.meta.outlineAnalysedAt, undefined);
  });
});

/**
 * Analysis must not rewrite a deck a person wrote.
 *
 * Found by pointing the analyse endpoint at the built-in deck. It accepted, and
 * replaced the hand-written title with the literal text off the cover page, en dash
 * and all. `readOnly` did not stop it: that is about where a deck lives, and the
 * built-in deck is seeded into real storage on first use, which makes it writable.
 * The question that matters is where the content came from.
 */
describe('provenance decides what analysis may touch', () => {
  it('marks the hand-authored deck as authored', () => {
    assert.equal(ISMS_DECK.meta.origin, 'authored');
  });

  it('marks an uploaded deck as uploaded', () => {
    assert.equal(draft().meta.origin, 'uploaded');
  });

  it('is checkable without loading a store', () => {
    // The route decides from the record alone, so this is the whole guard.
    const authored = ISMS_DECK.meta.origin === 'authored';
    const uploaded = draft().meta.origin === 'authored';
    assert.equal(authored, true);
    assert.equal(uploaded, false);
  });
});
