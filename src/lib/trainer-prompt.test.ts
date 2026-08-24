import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getSlide, totalSlides } from './deck';
import { ISMS_DECK } from './decks/isms';
import { syntheticDeck } from './__fixtures__/synthetic-deck';
import { buildSystemInstruction, buildTurnPrompt } from './trainer-prompt';
import type { TurnKind } from './types';

const deck = ISMS_DECK;

function prompt(kind: TurnKind, slideId: number, coveredSlideIds: number[], question?: string) {
  return buildTurnPrompt({
    deck,
    kind,
    slide: getSlide(deck, slideId)!,
    history: [],
    question,
    coveredSlideIds,
  });
}

/**
 * The prompt had no input bound.
 *
 * `fullDeckReference` serialised every slide's bullets and presenter notes on the
 * answer, quiz and recap paths, and a whole-deck knowledge turn added every topic
 * in the base. Measured on a sixty slide deck that was around 107,000 tokens on a
 * single closing turn. The bound matters more than the exact figure: without a test
 * the growth is invisible until a client uploads a real deck.
 */
describe('prompt size stays bounded as the deck grows', () => {
  const CEILING = 30_000;

  for (const slideCount of [7, 20, 40, 60]) {
    it(`stays under ${CEILING / 1000}k tokens on a ${slideCount}-slide deck`, () => {
      const big = syntheticDeck(slideCount);
      const midpoint = Math.ceil(slideCount / 2);
      const covered = Array.from({ length: midpoint }, (_, i) => i + 1);

      let worst = 0;
      let worstKind = '';
      for (const kind of ['narrate', 'answer', 'quiz', 'recap'] as TurnKind[]) {
        const chars =
          buildSystemInstruction(big).length +
          buildTurnPrompt({
            deck: big,
            kind,
            slide: getSlide(big, midpoint)!,
            history: [],
            question: kind === 'answer' ? 'how do I classify a document' : undefined,
            coveredSlideIds: covered,
          }).length;
        if (chars > worst) {
          worst = chars;
          worstKind = kind;
        }
      }

      // Four characters to a token is the usual rough conversion for English prose.
      const tokens = Math.round(worst / 4);
      assert.ok(
        tokens < CEILING,
        `worst turn (${worstKind}) on ${slideCount} slides is ~${tokens} tokens`,
      );
    });
  }

  it('grows sub-linearly, so doubling the deck does not double the prompt', () => {
    const size = (slideCount: number) => {
      const big = syntheticDeck(slideCount);
      const covered = Array.from({ length: slideCount }, (_, i) => i + 1);
      return buildTurnPrompt({
        deck: big,
        kind: 'recap',
        slide: getSlide(big, slideCount)!,
        history: [],
        coveredSlideIds: covered,
      }).length;
    };

    const growth = size(60) / size(20);
    assert.ok(growth < 2, `tripling the deck grew the recap prompt ${growth.toFixed(1)}x`);
  });
});

/**
 * A recap or a quiz must not reach for a slide the trainee never saw.
 *
 * The whole deck used to go into both, so the trainer could close a session that
 * stopped at slide 3 by recapping all seven, or examine someone on material that
 * was never taught. That reads as a trainer who was not paying attention, which is
 * the one impression the whole design is trying to avoid.
 */
describe('closing turns are limited to what was taught', () => {
  const covered = [1, 2, 3];

  for (const kind of ['quiz', 'recap'] as TurnKind[]) {
    it(`the ${kind} prompt does not put an untaught slide in the reference`, () => {
      const text = prompt(kind, 3, covered);

      for (const slide of deck.slides) {
        if (covered.includes(slide.id)) continue;
        // Every tier of the reference opens a slide with "Slide N:", so its absence
        // means the slide is not in the block at any depth.
        //
        // Deliberately not asserting that the slide's bullet text is absent from the
        // whole prompt: a phrase like "Acceptable Use Policy" is a bullet on slide 4
        // and also appears in the expertise for a slide that *was* taught, which is
        // legitimate. The rule is about the deck reference, not about vocabulary.
        assert.ok(
          !text.includes(`Slide ${slide.id}:`),
          `slide ${slide.id} was never taught but appears in the ${kind} reference`,
        );
      }
    });

    it(`the ${kind} prompt reproduces no untaught slide's bullet list`, () => {
      const text = prompt(kind, 3, covered);

      for (const slide of deck.slides) {
        if (covered.includes(slide.id)) continue;
        // A bulleted line is the reference block's own formatting, so this catches
        // the contents being reproduced without tripping on shared vocabulary.
        for (const bullet of slide.bullets) {
          assert.ok(
            !text.includes(`  - ${bullet}`),
            `slide ${slide.id} was never taught but its bullets are in the ${kind} prompt`,
          );
        }
      }
    });

    it(`the ${kind} prompt says explicitly what was not reached`, () => {
      const text = prompt(kind, 3, covered);
      const untaught = totalSlides(deck) - covered.length;
      assert.ok(text.includes(`did not reach the remaining ${untaught} slide`));
    });

    it(`the ${kind} prompt covers everything that was taught`, () => {
      const text = prompt(kind, 3, covered);
      for (const id of covered) {
        assert.ok(text.includes(`Slide ${id}:`), `taught slide ${id} is missing from the ${kind}`);
      }
    });
  }

  it('falls back to the slide on screen when nothing has been taught yet', () => {
    // Asking for a quiz before any narration is legal, and the honest scope is the
    // slide in front of them.
    const text = prompt('quiz', 2, []);
    assert.ok(text.includes('Slide 2:'));
    assert.ok(!text.includes('Slide 5:'));
  });

  it('says nothing about unreached slides once the whole deck is taught', () => {
    const all = deck.slides.map((slide) => slide.id);
    assert.ok(!prompt('recap', 7, all).includes('did not reach'));
  });
});

/**
 * An answer turn needs to know where things live, not what is on every slide.
 */
describe('the answer turn keeps detail where the conversation is', () => {
  it('carries the current slide and its neighbours in full', () => {
    const text = prompt('answer', 4, [1, 2, 3, 4], 'what about backups');
    for (const id of [3, 4, 5]) {
      const slide = getSlide(deck, id)!;
      assert.ok(
        text.includes(slide.bullets[0]),
        `slide ${id} is next to the current one and should be in full`,
      );
    }
  });

  it('names distant slides without their contents', () => {
    const text = prompt('answer', 1, [1], 'what about backups');
    const distant = getSlide(deck, 6)!;
    assert.ok(text.includes(`Slide 6: ${distant.title}`), 'the trainer cannot see slide 6 exists');
    assert.ok(!text.includes(distant.bullets[0]), 'slide 6 should be named, not reproduced');
  });

  it('still never carries an author-only note', () => {
    // The reason internalNotes exists. Checked on every turn kind, since the
    // reference block is assembled separately for each.
    const notes = deck.slides.flatMap((slide) => slide.internalNotes);
    assert.ok(notes.length > 0, 'this fixture no longer exercises the rule');

    for (const kind of ['narrate', 'answer', 'quiz', 'recap'] as TurnKind[]) {
      for (let id = 1; id <= totalSlides(deck); id += 1) {
        const text = prompt(kind, id, [1, 2, 3, 4, 5, 6, 7], 'what about backups');
        for (const note of notes) {
          assert.ok(!text.includes(note), `${kind} on slide ${id} leaked an internal note`);
        }
        assert.ok(!text.includes('OutThink'), `${kind} on slide ${id} leaked the platform name`);
      }
    }
  });
});

/**
 * A session can end at any point, and the closing turn has to be honest about it.
 */
describe('an early recap does not pretend the deck finished', () => {
  it('drops the closing reminder when the session stopped short', () => {
    const early = prompt('recap', 3, [1, 2, 3]);
    assert.ok(early.includes('ending before the end of the deck'));
    assert.ok(
      !early.includes(deck.meta.closingReminder),
      'the trainer was told to deliver a reminder that lives on a slide it never reached',
    );
  });

  it('gives the full close when the deck was finished', () => {
    const complete = prompt(
      'recap',
      7,
      deck.slides.map((slide) => slide.id),
    );
    assert.ok(complete.includes(deck.meta.closingReminder));
    assert.ok(!complete.includes('ending before the end of the deck'));
  });

  it('does not contradict itself in either case', () => {
    // Telling the trainer both "do not refer to slides you did not reach" and
    // "remind them of the reporting routes" is how this was found.
    for (const covered of [[1], [1, 2, 3], deck.slides.map((s) => s.id)]) {
      const text = prompt('recap', covered[covered.length - 1], covered);
      const forbids = text.includes('Do not recap, quiz or refer to anything on them');
      const asksForReminder = text.includes(deck.meta.closingReminder);
      assert.ok(
        !(forbids && asksForReminder),
        `covered ${covered.join(',')}: the prompt forbids untaught material and then asks for it`,
      );
    }
  });
});
