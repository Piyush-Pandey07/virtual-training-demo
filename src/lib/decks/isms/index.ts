/**
 * The ISMS deck, assembled.
 *
 * Until a trainer can upload one, this is the only deck there is, and it is
 * seeded from code rather than storage. That is deliberate: making the engine read
 * a deck value and moving that value into storage are two separate changes, and
 * doing them one at a time means the first can be proved to have changed nothing.
 *
 * Every string in the meta block was a literal spliced into the trainer's prompt
 * before this existed. They are reproduced here word for word, because the test
 * for this refactor is that the generated prompt does not move by a single
 * character.
 */

import type { DeckMeta, DeckRecord } from '../../deck-types';
import { CLASSIFICATION } from './knowledge/classification';
import { FOUNDATIONS } from './knowledge/foundations';
import { INCIDENTS } from './knowledge/incidents';
import { POLICIES } from './knowledge/policies';
import { THREATS } from './knowledge/threats';
import { ISMS_SLIDES } from './slides';

export const ISMS_META: DeckMeta = {
  id: 'isms',
  // Transcribed by hand from the source PowerPoint, with every ISO 27001 control
  // reference checked. The analysis passes refuse to touch it: generated text
  // would be a downgrade, and it has already replaced this title once.
  origin: 'authored',
  title: 'ISMS Awareness Session',
  subtitle: 'ISO/IEC 27001 Information Security Management System',
  spokenSubject: 'ISO 27001 information security management system awareness',
  owner: 'Technavious',
  ownerDescription: 'a data centre lifecycle consultancy',
  trainerRole: 'an information security trainer',
  practitionerCredential:
    'a practitioner who has implemented ISO 27001, sat on both sides of audits, and seen how these controls fail on real projects',
  exampleDomain:
    'site surveys, client audits, single-line diagrams, commissioning records, rack layouts, shared client sites, tender documents',
  exampleContext: 'data centre consultancy work',
  closingReminder: 'the three reporting routes without spelling out addresses',
};

export const ISMS_DECK: DeckRecord = {
  meta: ISMS_META,
  slides: ISMS_SLIDES,
  // Order matters: it is the order topics appear in the index the trainer is
  // shown, and it was chosen to read as a curriculum rather than alphabetically.
  topics: [...FOUNDATIONS, ...THREATS, ...CLASSIFICATION, ...POLICIES, ...INCIDENTS],
};
