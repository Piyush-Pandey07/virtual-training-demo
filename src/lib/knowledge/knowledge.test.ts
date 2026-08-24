import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { totalSlides } from '../deck';
import { ISMS_DECK } from '../decks/isms';
import { bestSlideForQuestion, renderKnowledge, selectKnowledge } from './index';

/**
 * The ISMS deck is the fixture now rather than the subject.
 *
 * Every case below was written against the deck when it was compiled into the
 * engine, and they are kept exactly as they were: they are the regression suite
 * proving that making the deck a parameter changed none of the behaviour.
 */
const deck = ISMS_DECK;

describe('knowledge base integrity', () => {
  it('has a unique id for every topic', () => {
    const ids = deck.topics.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('only references slides that exist', () => {
    for (const topic of deck.topics) {
      assert.ok(topic.slideIds.length > 0, `${topic.id} belongs to no slide`);
      for (const id of topic.slideIds) {
        assert.ok(id >= 1 && id <= totalSlides(deck), `${topic.id} references slide ${id}`);
      }
    }
  });

  it('gives every slide something to teach from', () => {
    for (const slide of deck.slides) {
      const core = selectKnowledge({ deck, slideId: slide.id }).filter((s) => s.weight === 'core');
      assert.ok(core.length > 0, `slide ${slide.id} has no expertise behind it`);
    }
  });

  it('carries substance in every topic, not just a title', () => {
    for (const topic of deck.topics) {
      assert.ok(topic.explanation.length > 0, `${topic.id} has no explanation`);
      assert.ok(topic.triggers.length > 0, `${topic.id} can never be retrieved`);
    }
  });

  /**
   * Stem triggers such as "classif" and "tailgat" only work if matching is by
   * word prefix. Whole-word matching made every stem in the base dead, and a
   * question about classification scored zero against the classification topic.
   */
  it('matches stem triggers by word prefix', () => {
    const match = bestSlideForQuestion(deck, 'what are the four classification tiers', 2);
    assert.equal(match?.slideId, 5);
  });
});

describe('selectKnowledge', () => {
  it('carries every topic on the slide when narrating, none dropped', () => {
    const selected = selectKnowledge({ deck, slideId: 2 });
    const onSlide = deck.topics.filter((t) => t.slideIds.includes(2));
    assert.equal(selected.length, onSlide.length);
  });

  /**
   * Handing over all seven of slide 2's topics at depth was what made narration
   * run half again past its budget. The model uses what it is given, whatever the
   * prompt says about brevity, so the choosing happens here.
   */
  it('teaches only the slide priorities at depth, and carries the rest compactly', () => {
    const selected = selectKnowledge({ deck, slideId: 2 });
    const core = selected.filter((s) => s.weight === 'core');
    assert.ok(core.length <= 4, `${core.length} topics at full depth is too many to teach`);
    assert.ok(
      selected.some((s) => s.weight === 'supporting'),
      'nothing was demoted',
    );
  });

  it('promotes by declared narration priority, not authoring order', () => {
    const core = selectKnowledge({ deck, slideId: 2 })
      .filter((s) => s.weight === 'core')
      .map((s) => s.topic.id);
    // Slide 2's brief says spend the time on these two, so they must survive the cap.
    assert.ok(core.includes('threat-spear-phishing'));
    assert.ok(core.includes('threat-passwords'));
  });

  it('keeps a small slide entirely at depth, since there is room for it', () => {
    const selected = selectKnowledge({ deck, slideId: 5 });
    assert.ok(selected.every((s) => s.weight === 'core'));
  });

  it('promotes only what the question reaches for, so the answer is not buried', () => {
    const selected = selectKnowledge({
      deck,
      slideId: 2,
      question: 'how do I spot a phishing email',
    });
    const core = selected.filter((s) => s.weight === 'core');
    assert.ok(core.length <= 3, 'too many topics kept at full depth');
    assert.ok(core.some((s) => s.topic.id === 'threat-spear-phishing'));
  });

  it('keeps a narrower prompt for a question than for a narration', () => {
    const narrating = renderKnowledge(selectKnowledge({ deck, slideId: 2 })).length;
    const asking = renderKnowledge(
      selectKnowledge({ deck, slideId: 2, question: 'how do I spot a phishing email' }),
    ).length;
    assert.ok(asking < narrating, 'question turns should not carry the whole slide at depth');
  });

  it('still gives context when nothing on the slide matches the question', () => {
    const core = selectKnowledge({
      deck,
      slideId: 4,
      question: 'what is the weather like today',
    }).filter((s) => s.weight === 'core');
    assert.ok(core.length > 0);
  });

  /**
   * This replaces a test that asserted the opposite.
   *
   * A whole-deck turn used to pull in every topic in the base, which the old test
   * pinned as correct. It was not: it let a recap draw on slides the trainee never
   * saw, and on a sixty slide deck it was around a hundred thousand tokens of
   * expertise per closing turn.
   */
  it('draws only on what was taught, on a recap or quiz', () => {
    const covered = [1, 2, 3];
    const selected = selectKnowledge({
      deck,
      slideId: 3,
      wholeDeck: true,
      coveredSlideIds: covered,
    });

    for (const entry of selected) {
      assert.ok(
        entry.topic.slideIds.some((id) => covered.includes(id)),
        `${entry.topic.id} belongs to slides ${entry.topic.slideIds.join(',')}, none of them taught`,
      );
    }
  });

  it('reaches wider than the slide on screen on a recap', () => {
    const onSlideThree = selectKnowledge({ deck, slideId: 3 }).length;
    const acrossSession = selectKnowledge({
      deck,
      slideId: 3,
      wholeDeck: true,
      coveredSlideIds: [1, 2, 3],
    }).length;
    assert.ok(acrossSession > onSlideThree, 'a recap should span more than the current slide');
  });

  it('bounds a recap so a large deck cannot flood the turn', () => {
    const selected = selectKnowledge({
      deck,
      slideId: 7,
      wholeDeck: true,
      coveredSlideIds: [1, 2, 3, 4, 5, 6, 7],
    });
    const core = selected.filter((s) => s.weight === 'core');
    assert.ok(core.length <= 5, `${core.length} topics at full depth in one closing turn`);
    // Everything beyond the core is named rather than reproduced.
    assert.ok(selected.some((s) => s.weight === 'headline'));
  });

  it('falls back to the slide on screen when a quiz comes before any teaching', () => {
    const selected = selectKnowledge({ deck, slideId: 2, wholeDeck: true, coveredSlideIds: [] });
    for (const entry of selected) {
      assert.ok(entry.topic.slideIds.includes(2), `${entry.topic.id} is not on slide 2`);
    }
  });
});

/**
 * How many topics a slide teaches at depth is a function of the time it has.
 *
 * It used to be the constant 4 for every slide, documented as being sized for
 * "slide 2 has seven topics", which is a fact about one deck.
 */
describe('the narration depth cap follows the slide budget', () => {
  it('gives a long slide more topics at depth than a short one', () => {
    const short = deck.slides.reduce((a, b) => (a.targetSeconds < b.targetSeconds ? a : b));
    const long = deck.slides.reduce((a, b) => (a.targetSeconds > b.targetSeconds ? a : b));

    const coreCount = (slideId: number) =>
      selectKnowledge({ deck, slideId }).filter((s) => s.weight === 'core').length;

    // Only meaningful where both slides have more topics than the cap allows.
    assert.ok(short.targetSeconds < long.targetSeconds);
    assert.ok(coreCount(long.id) >= coreCount(short.id));
  });

  it('never leaves a slide with nothing at depth', () => {
    for (const slide of deck.slides) {
      const core = selectKnowledge({ deck, slideId: slide.id }).filter((s) => s.weight === 'core');
      assert.ok(core.length > 0, `slide ${slide.id} has no topic at depth`);
    }
  });

  it('caps a 115 second slide below a 150 second one', () => {
    // Slide 6 has five topics in 115 seconds, slide 2 has seven in 150. Under the
    // old constant both got four, which was too many for slide 6.
    const core = (id: number) =>
      selectKnowledge({ deck, slideId: id }).filter((s) => s.weight === 'core').length;
    assert.equal(core(2), 4);
    assert.equal(core(6), 3);
  });
});

describe('bestSlideForQuestion', () => {
  const cases: Array<[number, string, number | null]> = [
    [2, 'what are the four classification tiers', 5],
    [2, 'how do I report a phishing email', 6],
    [1, 'can I use my own laptop', 4],
    [3, 'is public wifi safe', 2],
    [2, 'what is an ISMS exactly', 3],
    // Already on the right slide, so the deck should stay put.
    [2, 'how do I spot a phishing email', null],
    [5, 'where would a site survey report sit', null],
    [4, 'which policies apply to me', null],
    [6, 'what counts as an incident', null],
    [3, 'how many controls are in Annex A', null],
  ];

  for (const [current, question, expected] of cases) {
    it(`on slide ${current}, "${question}" goes to ${expected ?? 'nowhere'}`, () => {
      assert.equal(bestSlideForQuestion(deck, question, current)?.slideId ?? null, expected);
    });
  }

  it('never sends a question to a slide that teaches nothing', () => {
    // Slide 1 of this deck is a title card. The rule is not about slide 1
    // though, it is about the `teaches` flag, so the expectation is derived.
    const silent = new Set(deck.slides.filter((s) => !s.teaches).map((s) => s.id));
    assert.ok(silent.size > 0, 'this fixture no longer exercises the rule');

    for (const topic of deck.topics) {
      for (const trigger of topic.triggers) {
        const landed = bestSlideForQuestion(deck, trigger, 4)?.slideId;
        if (landed !== undefined) {
          assert.ok(!silent.has(landed), `"${trigger}" landed on silent slide ${landed}`);
        }
      }
    }
  });

  it('stays put when there is nothing to match', () => {
    assert.equal(bestSlideForQuestion(deck, '', 3), null);
    assert.equal(bestSlideForQuestion(deck, 'hello there', 3), null);
  });
});
