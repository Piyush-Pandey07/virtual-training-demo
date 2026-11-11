import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { saveBank, setLevelBands } from '../assessments/service';
import { DEFAULT_LEVEL_BANDS } from '../assessments/types';
import type { DeckRecord } from '../deck-types';
import { approveDeck } from '../decks/approval';
import { ISMS_DECK } from '../decks/isms';
import { resetDeckStore } from '../decks/registry';
import { DocumentDeckStore } from '../decks/store-documents';
import { scopedDocuments } from '../orgs/scope';
import { InMemoryDocumentStore } from '../roster/documents';
import { resetRosterStore } from '../roster/registry';
import { DocumentRosterStore } from '../roster/store-documents';
import type { Role, SignedInPerson } from '../roster/types';
import { changeSession, createSession, TrainingRuleError } from './service';
import { trainingStore } from './store';
import type { TrainingSession } from './types';

/**
 * A trainer-led session's own level bands: filled when it is set up, from the deck's
 * pre-session bands or the defaults, and changed by its facilitator or an administrator
 * until it closes.
 *
 * Kept apart from training.test.ts, with its own copy of the setup, so the two change
 * independently.
 */

const ORG = 'acme';
const DECK_ID = 'safety-a1b2c3';
const NOW = '2026-11-13T09:00:00.000Z';

function person(id: string, role: Role, extra: Partial<SignedInPerson> = {}): SignedInPerson {
  return {
    id,
    orgId: ORG,
    homeOrgId: ORG,
    platform: false,
    email: `${id}@acme.example`,
    emailKey: `${id}@acme.example`,
    name: id,
    role,
    createdAt: '2026-11-01T00:00:00.000Z',
    lastSeenAt: null,
    ...extra,
  };
}

const technavious = person('srikant', 'admin', { platform: true, homeOrgId: 'technavious' });
const companyAdmin = person('hr', 'admin');
const fran = person('fran', 'facilitator');
const felix = person('felix', 'facilitator');
const asha = person('asha', 'trainee');

let store: InMemoryDocumentStore;
let savedApprovers: string | undefined;
const options = () => ({ store, now: () => NOW });

function refused(status: number) {
  return (error: unknown) => {
    assert.ok(error instanceof TrainingRuleError, `expected a TrainingRuleError, got ${error}`);
    assert.equal(error.status, status);
    return true;
  };
}

function deck(id: string): DeckRecord {
  return {
    meta: { ...ISMS_DECK.meta, id, origin: 'uploaded' },
    slides: ISMS_DECK.slides.map((slide) => ({ ...slide })),
    topics: ISMS_DECK.topics.map((topic) => ({ ...topic })),
  };
}

beforeEach(async () => {
  savedApprovers = process.env.DECK_APPROVERS;
  delete process.env.DECK_APPROVERS;

  store = new InMemoryDocumentStore();
  const roster = new DocumentRosterStore(scopedDocuments(store, ORG));
  resetRosterStore(roster, ORG);
  for (const who of [companyAdmin, fran, felix, asha]) {
    await roster.upsertPerson({
      id: who.id,
      email: who.email,
      name: who.name,
      role: who.role,
      orgId: ORG,
    });
  }
  const decks = new DocumentDeckStore(scopedDocuments(store, ORG));
  resetDeckStore(decks, ORG);
  await decks.save(deck(DECK_ID), 'published');
  await approveDeck(technavious, DECK_ID, { store });
});

afterEach(() => {
  if (savedApprovers === undefined) delete process.env.DECK_APPROVERS;
  else process.env.DECK_APPROVERS = savedApprovers;
  resetDeckStore();
  resetRosterStore();
});

const create = () =>
  createSession(
    companyAdmin,
    { deckId: DECK_ID, facilitatorId: fran.id, participantIds: [asha.id] },
    options(),
  );

const QUESTIONS = [{ question: 'Which?', options: ['Right', 'Wrong'], correctIndex: 0 }];

describe("a trainer-led session's level bands", () => {
  it('are the defaults when the deck has no pre-session bands', async () => {
    const created = await create();
    assert.deepEqual(created.levelBands, DEFAULT_LEVEL_BANDS);
    assert.deepEqual(created.levelBands, { intermediateFrom: 40, advancedFrom: 71 });
    assert.deepEqual((await trainingStore(ORG, store).getSession(created.id))?.levelBands, {
      intermediateFrom: 40,
      advancedFrom: 71,
    });
  });

  it("are filled from the deck's pre-session bands, as a copy", async () => {
    await saveBank(technavious, DECK_ID, 'pre', QUESTIONS, 'upload', { store });
    await setLevelBands(
      technavious,
      DECK_ID,
      { intermediateFrom: 30, advancedFrom: 81 },
      { store },
    );
    const created = await create();
    assert.deepEqual(created.levelBands, { intermediateFrom: 30, advancedFrom: 81 });

    // Changing the session's bands leaves the deck's alone, and the other way round.
    await changeSession(
      fran,
      created.id,
      { levelBands: { intermediateFrom: 50, advancedFrom: 91 } },
      options(),
    );
    await setLevelBands(
      technavious,
      DECK_ID,
      { intermediateFrom: 10, advancedFrom: 20 },
      { store },
    );
    assert.deepEqual((await trainingStore(ORG, store).getSession(created.id))?.levelBands, {
      intermediateFrom: 50,
      advancedFrom: 91,
    });
  });

  it("can be changed by the session's facilitator and by administrators", async () => {
    const created = await create();
    for (const [who, bands] of [
      [fran, { intermediateFrom: 35, advancedFrom: 66 }],
      [companyAdmin, { intermediateFrom: 45, advancedFrom: 76 }],
      [technavious, { intermediateFrom: 50, advancedFrom: 81 }],
    ] as const) {
      const changed = await changeSession(who, created.id, { levelBands: bands }, options());
      assert.deepEqual(changed.levelBands, bands, who.id);
    }
  });

  it('cannot be changed by another facilitator or a participant', async () => {
    const created = await create();
    for (const who of [felix, asha]) {
      await assert.rejects(
        changeSession(
          who,
          created.id,
          { levelBands: { intermediateFrom: 10, advancedFrom: 20 } },
          options(),
        ),
        refused(404),
        who.id,
      );
    }
    assert.deepEqual(
      (await trainingStore(ORG, store).getSession(created.id))?.levelBands,
      DEFAULT_LEVEL_BANDS,
    );
  });

  it('refuses bands that make no sense, and changes nothing else with them', async () => {
    const created = await create();
    for (const levelBands of [
      { intermediateFrom: 60, advancedFrom: 60 },
      { intermediateFrom: 0, advancedFrom: 50 },
      { intermediateFrom: 40, advancedFrom: 101 },
      'above 70',
      null,
    ]) {
      await assert.rejects(
        changeSession(
          fran,
          created.id,
          { levelBands, attendance: { [asha.id]: 'present' } },
          options(),
        ),
        refused(400),
        JSON.stringify(levelBands),
      );
    }
    const stored = (await trainingStore(ORG, store).getSession(created.id)) as TrainingSession;
    assert.deepEqual(stored.levelBands, DEFAULT_LEVEL_BANDS);
    assert.deepEqual(stored.attendance, {});
  });

  it('are kept when anything else about the session changes', async () => {
    const created = await create();
    const changed = await changeSession(
      fran,
      created.id,
      { attendance: { [asha.id]: 'present' } },
      options(),
    );
    assert.deepEqual(changed.levelBands, DEFAULT_LEVEL_BANDS);
  });

  it('cannot be changed once the session is closed', async () => {
    const created = await create();
    await changeSession(
      fran,
      created.id,
      { attendance: { [asha.id]: 'present' }, status: 'closed' },
      options(),
    );
    await assert.rejects(
      changeSession(
        fran,
        created.id,
        { levelBands: { intermediateFrom: 10, advancedFrom: 20 } },
        options(),
      ),
      refused(409),
    );
  });
});
