/**
 * A data centre fundamentals deck in the style of the CDFA material, for the lesson plan
 * tests (AI-43).
 *
 * Eight slides, laid out the way such a deck usually is: a cover, what a data centre is,
 * the components of the data hall, power over two slides, cooling, tiers and redundancy,
 * and a summary. The sample lesson plan in public/samples is written against it, so the
 * two can be matched exactly, and its variant adds a section this deck deliberately lacks.
 */

import type { DeckRecord, DeckSlide } from '../deck-types';
import type { KnowledgeTopic } from '../knowledge/types';
import { ISMS_DECK } from '../decks/isms';

function slide(
  id: number,
  title: string,
  shortLabel: string,
  bullets: string[],
  targetSeconds: number,
  role: DeckSlide['role'] = 'content',
): DeckSlide {
  return {
    id,
    title,
    shortLabel,
    summary: bullets[0] ?? title,
    image: `/slides/slide${Math.min(id, 7)}.png`,
    bullets,
    speakerNotes: [],
    internalNotes: [],
    narrationBrief: `Teach ${title.toLowerCase()} to a new starter.`,
    keyPoints: bullets.slice(1),
    discussionPrompts: [],
    targetSeconds,
    teaches: role !== 'title',
    role,
  };
}

export const DATA_CENTRE_SLIDES: DeckSlide[] = [
  slide(1, 'Data Centre Fundamentals', 'Welcome', ['Data Centre Fundamentals'], 40, 'title'),
  slide(
    2,
    'What is a data centre?',
    'What it is',
    [
      'A secure facility that houses IT equipment',
      'Keeps servers, storage and networks running around the clock',
      'Availability is the whole point',
    ],
    120,
  ),
  slide(
    3,
    'Inside the data hall: key components',
    'Components',
    [
      'Racks, servers and network equipment',
      'Power distribution and cooling units',
      'Fire detection and the building management system',
    ],
    150,
  ),
  slide(
    4,
    'Power: from utility to rack',
    'Power path',
    [
      'The utility feed arrives at the HV/MV substation',
      'Transformers step the voltage down',
      'Switchgear and power distribution units feed the racks',
    ],
    130,
  ),
  slide(
    5,
    'UPS and generators',
    'UPS',
    [
      'The UPS bridges the gap when utility power fails',
      'Generators carry the load for hours',
      'Batteries and fuel need regular testing',
    ],
    120,
  ),
  slide(
    6,
    'Cooling the data hall',
    'Cooling',
    [
      'Hot aisle and cold aisle containment',
      'CRAC and CRAH units remove heat',
      'Free cooling where the climate allows',
    ],
    130,
  ),
  slide(
    7,
    'Tier levels and redundancy',
    'Tiers',
    [
      'Tier I to Tier IV',
      'N, N+1 and 2N redundancy',
      'Concurrent maintainability and fault tolerance',
    ],
    140,
  ),
  slide(
    8,
    'Summary and key takeaways',
    'Summary',
    ['Availability depends on power, cooling and redundancy working together'],
    90,
    'closing',
  ),
];

const TOPICS: KnowledgeTopic[] = DATA_CENTRE_SLIDES.filter((entry) => entry.teaches).map(
  (entry) => ({
    id: `dc-${entry.id}`,
    title: entry.title,
    slideIds: [entry.id],
    triggers: [entry.shortLabel.toLowerCase()],
    explanation: entry.bullets,
  }),
);

export function dataCentreDeck(id = 'data-centre'): DeckRecord {
  return {
    meta: {
      ...ISMS_DECK.meta,
      id,
      origin: 'uploaded',
      title: 'Data Centre Fundamentals',
      subtitle: 'CDFA foundation module',
      spokenSubject: 'data centre fundamentals',
    },
    slides: DATA_CENTRE_SLIDES.map((entry) => ({ ...entry })),
    topics: TOPICS.map((topic) => ({ ...topic })),
  };
}
