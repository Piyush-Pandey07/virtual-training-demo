import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DeckRecord } from '../deck-types';
import { draftDeckFrom } from '../decks/draft';
import { checkReadyToPublish } from '../decks/serialise';
import { bestSlideForQuestion, selectKnowledge } from '../knowledge';
import {
  backfillSlideIds,
  maxTopicsForSlide,
  mergeTopics,
  toKnowledgeTopics,
  topicBatches,
  type GeneratedTopic,
} from './topics';

/**
 * A draft whose first page is a title card, as a real deck's is: few enough words
 * that draftDeckFrom marks it as teaching nothing.
 */
function draft(pages = 5): DeckRecord {
  return draftDeckFrom(
    {
      fileName: 'Fire Safety.pdf',
      pages: Array.from({ length: pages }, (_, index) => ({
        pageNumber: index + 1,
        width: 1600,
        height: 900,
        lines:
          index === 0
            ? ['Fire Safety']
            : [
                `Heading ${index + 1}`,
                'evacuation routes and the assembly point',
                'who is responsible for the roll call',
              ],
      })),
    },
    'fire-safety-abc123',
  );
}

const topic = (overrides: Partial<GeneratedTopic> = {}): GeneratedTopic => ({
  title: 'Evacuation routes',
  slideIds: [2],
  triggers: ['evacuation', 'assembly point', 'fire exit'],
  explanation: ['Leave by the nearest marked exit.', 'Never use the lifts.'],
  examples: ['A stairwell blocked by deliveries is the usual failure.'],
  misconceptions: [{ belief: 'The lift is faster', correction: 'Lifts are recalled on an alarm.' }],
  faqs: [{ q: 'Where is the assembly point?', a: 'Marked on the site plan by each exit.' }],
  outOfScope: ['Which extinguisher suits which fire.'],
  ...overrides,
});

describe('how much expertise a slide gets', () => {
  const deck = draft(5);

  it('gives a title card one topic, since it teaches nothing', () => {
    assert.equal(deck.slides[0].teaches, false);
    assert.equal(maxTopicsForSlide(deck.slides[0]), 1);
  });

  it('never leaves a teaching slide with fewer than two', () => {
    // One topic gives selectKnowledge nothing to rank, so two is the floor.
    for (const seconds of [1, 20, 45]) {
      const slide = { ...deck.slides[1], targetSeconds: seconds };
      assert.ok(maxTopicsForSlide(slide) >= 2, `${seconds}s gave ${maxTopicsForSlide(slide)}`);
    }
  });

  it('gives a longer slide more room, up to what the hand-authored deck carries', () => {
    const at = (seconds: number) =>
      maxTopicsForSlide({ ...deck.slides[1], targetSeconds: seconds });
    assert.ok(at(180) > at(45));
    for (const seconds of [180, 600, 3600]) assert.ok(at(seconds) <= 6, `${seconds}s`);
  });
});

describe('turning what the model returned into topics', () => {
  const deck = draft(5);

  it('assigns an id from the title', () => {
    const [made] = toKnowledgeTopics([topic()], deck, [2], new Set());
    assert.equal(made.id, 'evacuation-routes');
  });

  it('never repeats an id, so no topic becomes unreachable', () => {
    const made = toKnowledgeTopics([topic(), topic(), topic()], deck, [2], new Set());
    assert.equal(new Set(made.map((t) => t.id)).size, 3);
  });

  it('does not collide with an id an earlier batch already took', () => {
    const taken = new Set(['evacuation-routes']);
    const [made] = toKnowledgeTopics([topic()], deck, [2], taken);
    assert.notEqual(made.id, 'evacuation-routes');
  });

  it('orders priority by the order returned', () => {
    const made = toKnowledgeTopics(
      [topic({ title: 'First' }), topic({ title: 'Second' })],
      deck,
      [2],
      new Set(),
    );
    assert.deepEqual(
      made.map((entry) => entry.narrationPriority),
      [10, 20],
    );
  });

  it('drops a slide id outside the batch rather than storing something unvalidatable', () => {
    const [made] = toKnowledgeTopics([topic({ slideIds: [2, 4, 99] })], deck, [2], new Set());
    assert.deepEqual(made.slideIds, [2]);
  });

  const broken: Array<[string, GeneratedTopic]> = [
    ['no slide to attach to', topic({ slideIds: [] })],
    ['nothing to reach it by', topic({ triggers: [] })],
    ['nothing to say', topic({ explanation: [] })],
    ['no title', topic({ title: '  ' })],
  ];

  for (const [what, entry] of broken) {
    it(`refuses a topic with ${what}`, () => {
      // The deck validator refuses all four on the way to storage, so keeping one
      // would fail the whole save rather than the one topic.
      assert.deepEqual(toKnowledgeTopics([entry], deck, [2], new Set()), []);
    });
  }

  it('never invents a standard reference', () => {
    // The one field deliberately left ungenerated: a wrong control number repeated in
    // an audit is active harm, and hedging a fabricated one is worse than silence.
    const withRefs = { ...topic(), standardRefs: ['A.5.7 Threat intelligence'] } as GeneratedTopic;
    const [made] = toKnowledgeTopics([withRefs], deck, [2], new Set());
    assert.equal(made.standardRefs, undefined);
  });

  it('drops blank entries instead of storing them', () => {
    const [made] = toKnowledgeTopics(
      [topic({ triggers: ['real', '  ', ''], explanation: ['a line', '   '] })],
      deck,
      [2],
      new Set(),
    );
    assert.deepEqual(made.triggers, ['real']);
    assert.deepEqual(made.explanation, ['a line']);
  });

  it('leaves an optional list off entirely when it comes back empty', () => {
    const [made] = toKnowledgeTopics(
      [topic({ examples: [], misconceptions: [], faqs: [], outOfScope: [] })],
      deck,
      [2],
      new Set(),
    );
    for (const field of ['examples', 'misconceptions', 'faqs', 'outOfScope'] as const) {
      assert.equal(made[field], undefined, field);
    }
  });
});

describe('applying a batch of expertise', () => {
  const deck = draft(5);

  it('adds the topics for that batch', () => {
    assert.equal(mergeTopics(deck, [2], [topic()]).topics.length, 1);
  });

  it('re-running a batch replaces its topics rather than duplicating them', () => {
    const once = mergeTopics(deck, [2], [topic()]);
    const twice = mergeTopics(once, [2], [topic()]);
    assert.equal(twice.topics.length, 1);
  });

  it('leaves another batch alone', () => {
    const first = mergeTopics(deck, [2], [topic()]);
    const second = mergeTopics(first, [3], [topic({ title: 'Roll call', slideIds: [3] })]);
    assert.deepEqual(second.topics.map((t) => t.title).sort(), ['Evacuation routes', 'Roll call']);
  });

  it('touches nothing the earlier passes own', () => {
    assert.deepEqual(mergeTopics(deck, [2], [topic()]).slides, deck.slides);
  });
});

describe('matching expertise to the slides it can teach', () => {
  const deck = draft(5);

  it('attaches a topic to a slide it genuinely covers', () => {
    // Slide 3 carries the same evacuation wording as slide 2, but the model wrote the
    // topic against slide 2, so nothing sits behind slide 3 until this runs.
    const merged = mergeTopics(deck, [2], [topic()]);
    assert.ok(!merged.topics.some((t) => t.slideIds.includes(3)));

    const filled = backfillSlideIds(merged);
    assert.ok(filled.topics.some((t) => t.slideIds.includes(3)));
  });

  it('uses the same matcher the trainer uses at run time', () => {
    // The point of doing it this way: a topic attached here is one the retriever
    // would genuinely have found, so the two cannot disagree about a slide.
    const filled = backfillSlideIds(mergeTopics(deck, [2], [topic()]));
    assert.ok(selectKnowledge({ deck: filled, slideId: 3 }).length > 0);
  });

  it('leaves a title card without expertise, which the publish check also allows', () => {
    const filled = backfillSlideIds(mergeTopics(deck, [2], [topic()]));
    assert.ok(!filled.topics.some((t) => t.slideIds.includes(1)));
  });

  it('attaches nothing to a slide no topic matches', () => {
    // Better that the publish check refuses than that the least-bad topic is attached
    // to a slide it has nothing to do with.
    const unrelated = topic({ title: 'Invoice approval', triggers: ['invoice', 'purchase order'] });
    const filled = backfillSlideIds(mergeTopics(deck, [2], [unrelated]));
    assert.ok(!filled.topics.some((t) => t.slideIds.includes(4)));
  });

  it('does nothing to a deck that has no expertise yet', () => {
    assert.deepEqual(backfillSlideIds(deck), deck);
  });
});

describe('splitting a deck into batches for this pass', () => {
  it('skips the slides that teach nothing', () => {
    assert.ok(!topicBatches(draft(5)).flat().includes(1));
  });

  it('covers every teaching slide exactly once', () => {
    for (const pages of [1, 5, 12, 37]) {
      const deck = draft(pages);
      assert.deepEqual(
        topicBatches(deck).flat(),
        deck.slides.filter((slide) => slide.teaches).map((slide) => slide.id),
        `${pages} pages`,
      );
    }
  });

  it('uses smaller batches than either earlier pass, since a topic returns more', () => {
    assert.ok(topicBatches(draft(20))[0].length <= 3);
  });
});

/**
 * What the pass is actually for. Without it an uploaded deck is not merely shallower
 * than the hand-authored one: a question never moves the deck at all, because
 * bestSlideForQuestion scores topics and there are none to score.
 */
describe('what expertise changes about an uploaded deck', () => {
  function analysed(): DeckRecord {
    let deck = draft(5);
    deck = mergeTopics(deck, [2], [topic()]);
    deck = mergeTopics(
      deck,
      [3],
      [
        topic({
          title: 'The roll call',
          slideIds: [3],
          triggers: ['roll call', 'headcount', 'who is missing'],
          explanation: ['The fire marshal counts heads against the visitor book.'],
        }),
      ],
    );
    deck = mergeTopics(
      deck,
      [4],
      [
        topic({
          title: 'Reporting a fault',
          slideIds: [4],
          triggers: ['broken alarm', 'report a fault', 'blocked exit'],
          explanation: ['A blocked exit is reported the same day, not at the next inspection.'],
        }),
      ],
    );
    return backfillSlideIds(deck);
  }

  it('lets a question move the deck, which it could not do before', () => {
    assert.equal(bestSlideForQuestion(draft(5), 'who does the roll call', 2), null);
    assert.equal(bestSlideForQuestion(analysed(), 'who does the roll call', 2)?.slideId, 3);
  });

  it('never sends a question to a slide that teaches nothing', () => {
    const deck = analysed();
    for (const question of ['fire safety', 'evacuation', 'roll call', 'blocked exit']) {
      assert.notEqual(bestSlideForQuestion(deck, question, 5)?.slideId, 1, question);
    }
  });

  it('gives the trainer something behind every teaching slide', () => {
    const deck = analysed();
    for (const slide of deck.slides.filter((s) => s.teaches)) {
      assert.ok(selectKnowledge({ deck, slideId: slide.id }).length > 0, `slide ${slide.id}`);
    }
  });

  it('is what unblocks publish', () => {
    assert.ok(checkReadyToPublish(draft(5)).length > 0);
    assert.deepEqual(checkReadyToPublish(analysed()), []);
  });
});
