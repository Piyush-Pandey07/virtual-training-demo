/**
 * The "Introduction to Data Centers" deck as it is on the live site, for the lesson plan
 * tests (AI-43): the same nineteen slides, with their titles, short labels, summaries,
 * roles and timings, and nothing else of them.
 *
 * The sample lesson plans in public/samples are written for this deck, because it is the
 * data centre deck an administrator actually has. They were first written against an
 * eight-slide outline of a fundamentals course (data-centre-deck.ts), and uploaded to
 * the real deck the sample with one deliberate gap reported seven (UAT dry run of
 * 18 November). The tests read the samples exactly as they ship and line them up against
 * this, so a sample that drifts from the deck fails here.
 */

import type { DeckRecord, DeckSlide } from '../deck-types';
import { ISMS_DECK } from '../decks/isms';

type Row = [
  id: number,
  title: string,
  shortLabel: string,
  summary: string,
  targetSeconds: number,
  role: NonNullable<DeckSlide['role']>,
];

const ROWS: Row[] = [
  [
    1,
    'Introduction to Data Centers',
    'Intro to Data Centers',
    'This page introduces the session on data centers, outlining five key topics to be covered.',
    75,
    'title',
  ],
  [
    2,
    'Learning Objectives',
    'Learning Objectives',
    'The session aims to enable participants to define data centers, explain their purpose, identify business drivers, understand digital infrastructure, and recognize their everyday impact.',
    75,
    'content',
  ],
  [
    3,
    'The Digital World Around Us',
    'Digital World',
    'Data centers silently power nearly every digital action, including communication, finance, entertainment, and productivity.',
    105,
    'content',
  ],
  [
    4,
    'Key Outputs of a Data Center',
    'Data Center Outputs',
    'A data center is a specialized facility providing computing, storage, connectivity, and service delivery for digital information.',
    105,
    'content',
  ],
  [
    5,
    'Basic Data Center Components',
    'Basic Components',
    'Data centers comprise IT infrastructure like servers and storage, and facility infrastructure such as power, cooling, security, and fire protection.',
    135,
    'content',
  ],
  [
    6,
    'Data Center as a System',
    'System View',
    'A data center is an engineered ecosystem where power, cooling, networking, monitoring, and security components play critical, interconnected roles.',
    135,
    'content',
  ],
  [
    7,
    'Why Do Data Centers Exist?',
    'Why Data Centers',
    'Data centers exist to fulfill four fundamental functions: compute, store, connect, and protect digital services.',
    135,
    'content',
  ],
  [
    8,
    'Data Centers and Business Operations',
    'Business Operations',
    'Data centers are essential for critical services across industries like banking, healthcare, manufacturing, government, retail, and telecom.',
    135,
    'content',
  ],
  [
    9,
    'Business Drivers for Data Centers',
    'Business Drivers',
    'Organizations invest in data centers due to digital transformation, data growth, cloud adoption, business continuity, regulatory compliance, and customer expectations.',
    135,
    'content',
  ],
  [
    10,
    'The Data Growth Explosion',
    'Data Growth',
    'The unprecedented global data growth, driven by smartphones, IoT, social media, video, AI, and enterprise systems, necessitates continuous data center scaling.',
    135,
    'content',
  ],
  [
    11,
    'What is Digital Infrastructure?',
    'Digital Infrastructure',
    'Digital infrastructure encompasses technologies and facilities like data centers, telecom networks, cloud platforms, and edge facilities that enable global digital communication.',
    135,
    'content',
  ],
  [
    12,
    'Data Centers Within the Digital Ecosystem',
    'Data Centers in Ecosyste',
    'Data centers are central to the digital economy, connecting users and applications through a layered technology stack that supports services like search, banking, and streaming.',
    135,
    'content',
  ],
  [
    13,
    'Characteristics of Modern Data Centers',
    'Modern DC Characteristic',
    'Modern data centers are designed with six key characteristics: availability, reliability, scalability, security, maintainability, and efficiency to meet business demands.',
    170,
    'content',
  ],
  [
    14,
    'The Future of Data Centers',
    'Future of Data Centers',
    'The data center industry is rapidly evolving, driven by trends like AI, edge computing, sustainability, and automation, requiring adaptation from professionals.',
    135,
    'content',
  ],
  [
    15,
    "India's Data Center Market",
    'India DC Market',
    "India's data center market is rapidly growing, driven by digital adoption, government policy, and hyperscaler investment, with significant capacity expansion and key industry hubs.",
    135,
    'content',
  ],
  [
    16,
    "India's Regulatory Landscape for Data Centers",
    'India DC Regulations',
    "India's data center market is shaped by the DPDP Act and sector-specific data localisation rules, creating mandatory demand for local data center capacity.",
    170,
    'content',
  ],
  [
    17,
    "India's Leading Data Center Operators",
    'India DC Operators',
    "India's data center landscape features a mix of home-grown and global operators, all expanding capacity and requiring MEPF-qualified teams for construction and operations.",
    135,
    'content',
  ],
  [
    18,
    'Session Summary',
    'Session Summary',
    'This session covered how data centers support the digital economy, their core functions, critical business dependence, their role in the broader digital ecosystem, and key modern characteristics.',
    75,
    'closing',
  ],
  [
    19,
    'Review Questions',
    'Review Questions',
    'Test your understanding of data center definitions, importance, business drivers, digital infrastructure, and modern data center characteristics with these review questions.',
    45,
    'closing',
  ],
];

export const INTRODUCTION_SLIDES: DeckSlide[] = ROWS.map(
  ([id, title, shortLabel, summary, targetSeconds, role]) => ({
    id,
    title,
    shortLabel,
    summary,
    image: `/slides/slide${Math.min(id, 7)}.png`,
    bullets: [],
    speakerNotes: [],
    internalNotes: [],
    narrationBrief: summary,
    keyPoints: [],
    discussionPrompts: [],
    targetSeconds,
    teaches: role !== 'title',
    role,
  }),
);

export function introductionDeck(id = 'introduction-to-data-centers'): DeckRecord {
  return {
    meta: {
      ...ISMS_DECK.meta,
      id,
      origin: 'uploaded',
      title: 'Introduction to Data Centers',
      subtitle: 'CDFA',
      spokenSubject: 'data centres',
    },
    slides: INTRODUCTION_SLIDES.map((slide) => ({ ...slide })),
    topics: [],
  };
}
