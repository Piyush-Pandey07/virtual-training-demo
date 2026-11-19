import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { saveBank, setLevelBands } from '../assessments/service';
import { DEFAULT_LEVEL_BANDS } from '../assessments/types';
import { auditHistory } from '../audit/log';
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
 * until it opens (AI-51).
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

  // A UAT dry run reported the 1 to 99 limits as the browser's alone. They are the
  // server's: each kind of bad value is pinned here with the status and the words the
  // screen shows for it. `advancedFrom` is the stored edge, one more than what is typed
  // as "Advanced above".
  it('are refused outside 1 to 99, not whole, or the wrong way round, saying which', async () => {
    const intermediateLimits = '"Intermediate from" must be a whole number from 1 to 99.';
    const advancedLimits = '"Advanced above" must be a whole number from 1 to 99.';
    const wrongWayRound =
      '"Advanced above" cannot be lower than "Intermediate from", because that would leave no score for Intermediate.';
    const created = await create();
    for (const [levelBands, message] of [
      // Out of range.
      [{ intermediateFrom: 0, advancedFrom: 71 }, intermediateLimits],
      [{ intermediateFrom: -5, advancedFrom: 71 }, intermediateLimits],
      [{ intermediateFrom: 100, advancedFrom: 101 }, intermediateLimits],
      [{ intermediateFrom: 150, advancedFrom: 71 }, intermediateLimits],
      [{ intermediateFrom: 40, advancedFrom: 101 }, advancedLimits],
      [{ intermediateFrom: 40, advancedFrom: 1 }, advancedLimits],
      // Not a whole number, or not a number at all.
      [{ intermediateFrom: 40.5, advancedFrom: 71 }, intermediateLimits],
      [{ intermediateFrom: '40', advancedFrom: 71 }, intermediateLimits],
      [{ advancedFrom: 71 }, intermediateLimits],
      [{ intermediateFrom: 40, advancedFrom: 70.5 }, advancedLimits],
      [{ intermediateFrom: 40, advancedFrom: '71' }, advancedLimits],
      [{ intermediateFrom: 40 }, advancedLimits],
      [null, intermediateLimits],
      ['above 70', intermediateLimits],
      // The wrong way round: Intermediate at or above where Advanced starts.
      [{ intermediateFrom: 60, advancedFrom: 60 }, wrongWayRound],
      [{ intermediateFrom: 71, advancedFrom: 41 }, wrongWayRound],
    ] as const) {
      await assert.rejects(
        changeSession(fran, created.id, { levelBands }, options()),
        (error: unknown) => {
          refused(400)(error);
          assert.equal((error as Error).message, message);
          return true;
        },
        JSON.stringify(levelBands),
      );
    }
    const stored = (await trainingStore(ORG, store).getSession(created.id)) as TrainingSession;
    assert.deepEqual(stored.levelBands, DEFAULT_LEVEL_BANDS);
  });

  it('may be the limits themselves, 1 and 99, in either box', async () => {
    const created = await create();
    for (const levelBands of [
      // Intermediate from 1, Advanced above 1.
      { intermediateFrom: 1, advancedFrom: 2 },
      // Intermediate from 99, Advanced above 99.
      { intermediateFrom: 99, advancedFrom: 100 },
      // Advanced above the very score Intermediate starts at.
      { intermediateFrom: 40, advancedFrom: 41 },
    ]) {
      const changed = await changeSession(fran, created.id, { levelBands }, options());
      assert.deepEqual(changed.levelBands, levelBands);
    }
  });

  it('when refused, reach the screen in the words the server gave', () => {
    const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    // The service refuses with the reason, and the route sends it as it is.
    assert.match(
      read('src/lib/training/service.ts'),
      /const checked = checkBands\(input\.levelBands\);\s*if \(!checked\.ok\) throw new TrainingRuleError\(400, checked\.error\);/,
    );
    assert.match(
      read('src/lib/training/route-helpers.ts'),
      /if \(error instanceof TrainingRuleError\) \{\s*return Response\.json\(\{ error: error\.message \}, \{ status: error\.status \}\);/,
    );
    assert.match(
      read('src/app/sessions/[id]/SessionRecord.tsx'),
      /return reply\.error \?\? 'The bands could not be saved\. Try again\.';/,
    );
    // The form shows that sentence under the boxes as it is typed, from the same check,
    // and switches the browser's own validation off so its bubble is not the message.
    const form = read('src/components/LevelBandsForm.tsx');
    assert.match(form, /<form\s+noValidate\b/);
    assert.match(
      form,
      /\{checked\.ok \? \(changed \? describeBands\(checked\.bands\) : ''\) : checked\.error\}/,
    );
    assert.match(form, /role=\{message\.error \? 'alert' : 'status'\}/);
    // The number fields take their limits from the rule, so the two cannot drift apart.
    assert.equal(form.match(/min=\{BAND_LIMITS\.min\}/g)?.length, 2);
    assert.equal(form.match(/max=\{BAND_LIMITS\.max\}/g)?.length, 2);
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

  // AI-51: once the trainer is pitching to the room, moving the bands would regrade people
  // part way through, so they are settled before the session opens.
  it('are fixed once the session has started, for everybody who could change them', async () => {
    const created = await create();
    await changeSession(fran, created.id, { status: 'open' }, options());
    for (const who of [fran, companyAdmin, technavious]) {
      await assert.rejects(
        changeSession(
          who,
          created.id,
          { levelBands: { intermediateFrom: 10, advancedFrom: 20 } },
          options(),
        ),
        (error: unknown) => {
          refused(409)(error);
          assert.equal(
            (error as Error).message,
            'Level bands are fixed once the session has started. Set them before it opens.',
          );
          return true;
        },
        who.id,
      );
    }
    const stored = (await trainingStore(ORG, store).getSession(created.id)) as TrainingSession;
    assert.deepEqual(stored.levelBands, DEFAULT_LEVEL_BANDS);
  });

  it('when refused for a started session, take nothing else sent with them', async () => {
    const created = await create();
    await changeSession(fran, created.id, { status: 'open' }, options());
    await assert.rejects(
      changeSession(
        fran,
        created.id,
        {
          levelBands: { intermediateFrom: 10, advancedFrom: 20 },
          attendance: { [asha.id]: 'present' },
        },
        options(),
      ),
      refused(409),
    );
    const stored = (await trainingStore(ORG, store).getSession(created.id)) as TrainingSession;
    assert.deepEqual(stored.attendance, {});
    // Marking attendance on its own still works on an open session.
    const marked = await changeSession(
      fran,
      created.id,
      { attendance: { [asha.id]: 'present' } },
      options(),
    );
    assert.equal(marked.attendance[asha.id], 'present');
  });

  it('give the same reason once the session is closed or cancelled', async () => {
    const message = 'Level bands are fixed once the session has started. Set them before it opens.';
    const closed = await create();
    await changeSession(
      fran,
      closed.id,
      { attendance: { [asha.id]: 'present' }, status: 'closed' },
      options(),
    );
    const cancelled = await create();
    await changeSession(fran, cancelled.id, { status: 'cancelled' }, options());
    for (const id of [closed.id, cancelled.id]) {
      await assert.rejects(
        changeSession(
          fran,
          id,
          { levelBands: { intermediateFrom: 10, advancedFrom: 20 } },
          options(),
        ),
        { message },
        id,
      );
    }
  });

  it('may be set in the same change that opens the session', async () => {
    const created = await create();
    const opened = await changeSession(
      fran,
      created.id,
      { levelBands: { intermediateFrom: 35, advancedFrom: 66 }, status: 'open' },
      options(),
    );
    assert.equal(opened.status, 'open');
    assert.deepEqual(opened.levelBands, { intermediateFrom: 35, advancedFrom: 66 });
  });

  it('are in the audit history when set beforehand, and not when refused afterwards', async () => {
    const created = await create();
    await changeSession(
      fran,
      created.id,
      { levelBands: { intermediateFrom: 35, advancedFrom: 66 } },
      options(),
    );
    await changeSession(fran, created.id, { status: 'open' }, options());
    await changeSession(
      fran,
      created.id,
      { levelBands: { intermediateFrom: 10, advancedFrom: 20 } },
      options(),
    ).catch(() => undefined);
    // The entries are written after the call returns, as after a response.
    await new Promise((resolve) => setImmediate(resolve));
    const entries = await auditHistory(
      ORG,
      { month: new Date().toISOString().slice(0, 7), subjectType: 'training-session' },
      { store },
    );
    assert.deepEqual(
      entries
        .filter((entry) => entry.detail.startsWith('Set the level bands'))
        .map((entry) => entry.detail),
      ['Set the level bands: Intermediate from 35%, Advanced from 66%'],
    );
  });
});
