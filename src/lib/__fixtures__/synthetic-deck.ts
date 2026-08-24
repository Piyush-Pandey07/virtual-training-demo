/**
 * A deck the size of a real client deck.
 *
 * The ISMS deck has seven slides, which is small enough to hide every scaling
 * problem the engine has. Built by repeating that deck rather than by inventing
 * filler, because the prose volume per slide is the thing being measured and lorem
 * ipsum would understate it.
 *
 * Shared between the prompt-size script and the tests that bound it, so the number
 * quoted in a commit message and the number a test enforces cannot drift apart.
 */

import type { DeckRecord } from '../deck-types';
import { ISMS_DECK } from '../decks/isms';

export function syntheticDeck(slideCount: number): DeckRecord {
  const source = ISMS_DECK.slides;
  const blocks = Math.ceil(slideCount / source.length);

  const slides = Array.from({ length: slideCount }, (_, index) => ({
    ...source[index % source.length],
    id: index + 1,
    // Only the real first slide is a title card; the repeats teach.
    teaches: index !== 0,
  }));

  const topics = Array.from({ length: blocks }, (_, block) =>
    ISMS_DECK.topics.map((topic) => ({
      ...topic,
      id: `${topic.id}-b${block}`,
      slideIds: topic.slideIds
        .map((id) => id + block * source.length)
        .filter((id) => id >= 1 && id <= slideCount),
    })),
  )
    .flat()
    .filter((topic) => topic.slideIds.length > 0);

  return { meta: { ...ISMS_DECK.meta, id: `synthetic-${slideCount}` }, slides, topics };
}
