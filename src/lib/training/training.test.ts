import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  isAdministrator,
  isCompanyAdmin,
  isFacilitator,
  mayRunSessions,
  seesAllSessions,
} from '../auth/permissions';
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
import { facilitatesDeck, facilitatesPerson, mayManageSession, sessionsListing } from './access';
import {
  changeSession,
  createBatch,
  createSession,
  removeBatch,
  removeSession,
  sessionFor,
  TrainingRuleError,
  updateBatch,
  visibleBatches,
  visibleSessions,
} from './service';
import { trainingStore } from './store';
import type { Batch, TrainingSession } from './types';

/**
 * The rules for batches and trainer-led sessions (BRD v2.3: AI-38, AI-01, AI-32), and
 * the role checks they rest on.
 *
 * Driven through the in-memory document store, with the roster and deck library swapped
 * for ones built on it, so the service code is the deployed code. The rules under test:
 * only an administrator (Technavious or a customer's own) sets up batches and sessions;
 * a facilitator runs only the sessions they are given and sees only their own; and a
 * closed session is a record nobody can change.
 *
 * Left to other tests: facilitation.ts, in facilitation.test.ts, because it imports the
 * auth guard and so cannot be loaded without replacing it; and removeFromTraining, the
 * detail of updateBatch and which sessions removeSession accepts, which are being made
 * transactional separately.
 */

const ORG = 'acme';
const DECK_ID = 'safety-a1b2c3';
const DRAFT_ID = 'draft-d4e5f6';
const NOW = '2026-11-13T09:00:00.000Z';
const LATER = '2026-11-13T11:00:00.000Z';

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

/** Technavious staff looking inside Acme. Not on Acme's roster. */
const technavious = person('srikant', 'admin', { platform: true, homeOrgId: 'technavious' });
/** An administrator of Technavious's own organisation, which also makes them one. */
const technaviousAdmin = person('tara', 'admin', { homeOrgId: 'technavious' });
/** Acme's own administrator. */
const companyAdmin = person('hr', 'admin');
const fran = person('fran', 'facilitator');
const felix = person('felix', 'facilitator');
const asha = person('asha', 'trainee', { name: 'Asha Rao' });
const ben = person('ben', 'trainee', { name: 'Ben Okafor' });
const cara = person('cara', 'trainee', { name: 'Cara Singh' });

function deck(id: string): DeckRecord {
  return {
    meta: { ...ISMS_DECK.meta, id, origin: 'uploaded' },
    slides: ISMS_DECK.slides.map((slide) => ({ ...slide })),
    topics: ISMS_DECK.topics.map((topic) => ({ ...topic })),
  };
}

let store: InMemoryDocumentStore;
let roster: DocumentRosterStore;
let savedApprovers: string | undefined;

const options = () => ({ store, now: () => NOW });

/** A rule broken with this status, and words matching the pattern if one is given. */
function refused(status: number, pattern?: RegExp) {
  return (error: unknown) => {
    assert.ok(error instanceof TrainingRuleError, `expected a TrainingRuleError, got ${error}`);
    assert.equal(error.status, status);
    if (pattern) assert.match(error.message, pattern);
    return true;
  };
}

function session(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: 's-room1',
    deckId: DECK_ID,
    facilitatorId: fran.id,
    batchId: null,
    participantIds: [asha.id, ben.id],
    scheduledFor: '2026-11-13T09:00:00.000Z',
    status: 'scheduled',
    attendance: {},
    createdBy: companyAdmin.id,
    createdAt: '2026-11-08T00:00:00.000Z',
    openedAt: null,
    closedAt: null,
    closedBy: null,
    ...overrides,
  };
}

function batch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: 'b-morning',
    name: 'Morning shift',
    facilitatorId: fran.id,
    participantIds: [asha.id],
    createdBy: companyAdmin.id,
    createdAt: '2026-11-08T00:00:00.000Z',
    updatedAt: '2026-11-08T00:00:00.000Z',
    ...overrides,
  };
}

async function saved(overrides: Partial<TrainingSession> = {}): Promise<TrainingSession> {
  const value = session(overrides);
  await trainingStore(ORG, store).saveSession(value);
  return value;
}

async function savedBatch(overrides: Partial<Batch> = {}): Promise<Batch> {
  const value = batch(overrides);
  await trainingStore(ORG, store).saveBatch(value);
  return value;
}

const stored = (id: string) => trainingStore(ORG, store).getSession(id);

beforeEach(async () => {
  savedApprovers = process.env.DECK_APPROVERS;
  delete process.env.DECK_APPROVERS;

  store = new InMemoryDocumentStore();
  roster = new DocumentRosterStore(scopedDocuments(store, ORG));
  resetRosterStore(roster, ORG);
  for (const who of [companyAdmin, fran, felix, asha, ben, cara]) {
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
  await decks.save(deck(DRAFT_ID), 'draft');
});

afterEach(() => {
  if (savedApprovers === undefined) delete process.env.DECK_APPROVERS;
  else process.env.DECK_APPROVERS = savedApprovers;
  resetDeckStore();
  resetRosterStore();
});

// ----------------------------------------------------------------- permissions

describe('who is which kind of person', () => {
  it('makes platform staff and administrators of Technavious itself the administrator', () => {
    assert.equal(isAdministrator(technavious), true);
    assert.equal(isAdministrator(technaviousAdmin), true);
    assert.equal(isAdministrator(companyAdmin), false);
    assert.equal(isAdministrator(fran), false);
    assert.equal(isAdministrator(asha), false);
  });

  it('does not let a customer make itself Technavious by its role alone', () => {
    // Acting inside Technavious's organisation is not the same as belonging to it.
    const visitor = person('vic', 'admin', { orgId: 'technavious', homeOrgId: 'acme' });
    assert.equal(isAdministrator(visitor), false);
    assert.equal(isAdministrator({ role: 'admin', platform: false }), false);
  });

  it('makes a company administrator an admin of a customer who is not Technavious', () => {
    assert.equal(isCompanyAdmin(companyAdmin), true);
    assert.equal(isCompanyAdmin(technavious), false);
    assert.equal(isCompanyAdmin(technaviousAdmin), false);
    assert.equal(isCompanyAdmin(fran), false);
    assert.equal(isCompanyAdmin(asha), false);
  });

  it('tells a facilitator by their role', () => {
    assert.equal(isFacilitator(fran), true);
    assert.equal(isFacilitator(companyAdmin), false);
    assert.equal(isFacilitator(technavious), false);
    assert.equal(isFacilitator(asha), false);
  });

  it('lets facilitators and both kinds of administrator run sessions, and no participant', () => {
    for (const who of [fran, companyAdmin, technavious, technaviousAdmin]) {
      assert.equal(mayRunSessions(who), true, who.id);
    }
    assert.equal(mayRunSessions(asha), false);
    // Platform staff run sessions whatever role their row carries.
    assert.equal(mayRunSessions({ role: 'trainee', platform: true }), true);
  });

  it('shows every session to administrators, and a facilitator only their own', () => {
    for (const who of [companyAdmin, technavious, technaviousAdmin]) {
      assert.equal(seesAllSessions(who), true, who.id);
    }
    assert.equal(seesAllSessions(fran), false);
    assert.equal(seesAllSessions(asha), false);
  });
});

// ---------------------------------------------------------------------- access

describe('who may manage a session', () => {
  const frans = session();

  it('lets its own facilitator and any administrator manage it', () => {
    assert.equal(mayManageSession(fran, frans), true);
    assert.equal(mayManageSession(companyAdmin, frans), true);
    assert.equal(mayManageSession(technavious, frans), true);
  });

  it('refuses another facilitator, and a participant even one listed on it', () => {
    assert.equal(mayManageSession(felix, frans), false);
    assert.equal(mayManageSession(asha, frans), false);
  });

  it('does not let a participant manage a session by being named its facilitator', () => {
    // Only the facilitator role counts; a stray id on the record is not enough.
    assert.equal(mayManageSession(asha, session({ facilitatorId: asha.id })), false);
  });

  it('filters a list to the sessions the viewer manages', () => {
    const felixs = session({ id: 's-room2', facilitatorId: felix.id });
    const all = [frans, felixs];
    assert.deepEqual(
      visibleSessions(fran, all).map((entry) => entry.id),
      ['s-room1'],
    );
    assert.deepEqual(
      visibleSessions(felix, all).map((entry) => entry.id),
      ['s-room2'],
    );
    assert.equal(visibleSessions(companyAdmin, all).length, 2);
    assert.equal(visibleSessions(technavious, all).length, 2);
    assert.equal(visibleSessions(asha, all).length, 0);
  });
});

describe('whom a facilitator facilitates', () => {
  it('is everybody listed on their sessions and in their batches', async () => {
    await saved({ participantIds: [asha.id] });
    await savedBatch({ participantIds: [ben.id] });
    assert.equal(await facilitatesPerson(fran, asha.id, { store }), true);
    assert.equal(await facilitatesPerson(fran, ben.id, { store }), true);
    assert.equal(await facilitatesPerson(fran, cara.id, { store }), false);
  });

  it('is nobody on another facilitator’s session or batch', async () => {
    await saved({ facilitatorId: felix.id, participantIds: [asha.id] });
    await savedBatch({ facilitatorId: felix.id, participantIds: [ben.id] });
    assert.equal(await facilitatesPerson(fran, asha.id, { store }), false);
    assert.equal(await facilitatesPerson(fran, ben.id, { store }), false);
    assert.equal(await facilitatesPerson(felix, asha.id, { store }), true);
    assert.equal(await facilitatesPerson(felix, ben.id, { store }), true);
  });

  it('is only ever answered yes for the facilitator role', async () => {
    await saved({ participantIds: [asha.id, ben.id] });
    // Administrators see people by other rules; this one is for facilitators only.
    assert.equal(await facilitatesPerson(companyAdmin, asha.id, { store }), false);
    assert.equal(await facilitatesPerson(technavious, asha.id, { store }), false);
    assert.equal(await facilitatesPerson(ben, asha.id, { store }), false);
  });
});

describe('whether a facilitator may show a deck', () => {
  it('is true for a facilitator running a session on that deck', async () => {
    await saved();
    assert.equal(await facilitatesDeck(fran, DECK_ID, { store }), true);
  });

  it('is false for another deck, or with no sessions at all', async () => {
    assert.equal(await facilitatesDeck(fran, DECK_ID, { store }), false);
    await saved();
    assert.equal(await facilitatesDeck(fran, 'isms', { store }), false);
  });

  it('is false for a facilitator whose colleague runs the session on that deck', async () => {
    await saved({ facilitatorId: felix.id });
    assert.equal(await facilitatesDeck(fran, DECK_ID, { store }), false);
    assert.equal(await facilitatesDeck(felix, DECK_ID, { store }), true);
  });

  it('is false for anybody who is not a facilitator, even one named on the session', async () => {
    await saved({ facilitatorId: asha.id });
    assert.equal(await facilitatesDeck(asha, DECK_ID, { store }), false);
    await saved({ id: 's-room2', facilitatorId: companyAdmin.id });
    assert.equal(await facilitatesDeck(companyAdmin, DECK_ID, { store }), false);
  });
});

describe('the sessions a participant may join', () => {
  it('are the ones that list them, whoever runs them', async () => {
    await saved({ id: 's-a', participantIds: [asha.id] });
    await saved({ id: 's-b', facilitatorId: felix.id, participantIds: [asha.id, ben.id] });
    await saved({ id: 's-c', participantIds: [ben.id] });
    const listed = await sessionsListing(asha, { store });
    assert.deepEqual(listed.map((entry) => entry.id).sort(), ['s-a', 's-b']);
    assert.deepEqual(await sessionsListing(cara, { store }), []);
  });
});

// --------------------------------------------------------------------- batches

describe('which batches a person sees', () => {
  const frans = batch();
  const felixs = batch({ id: 'b-evening', facilitatorId: felix.id });
  const unowned = batch({ id: 'b-new', facilitatorId: null });

  it('is every batch for an administrator of either kind', () => {
    for (const who of [companyAdmin, technavious]) {
      assert.equal(visibleBatches(who, [frans, felixs, unowned]).length, 3, who.id);
    }
  });

  it('is only their own for a facilitator, and none for a participant', () => {
    assert.deepEqual(
      visibleBatches(fran, [frans, felixs, unowned]).map((entry) => entry.id),
      ['b-morning'],
    );
    assert.deepEqual(visibleBatches(asha, [frans, felixs, unowned]), []);
  });
});

const ONLY_ADMIN = /Only an administrator sets up batches and sessions/;

describe('setting up batches', () => {
  it('is refused to a facilitator, for their own batch as much as anybody else’s', async () => {
    await savedBatch();
    await assert.rejects(
      createBatch(fran, { name: 'Morning', participantIds: [asha.id] }, options()),
      refused(403, ONLY_ADMIN),
    );
    await assert.rejects(
      updateBatch(fran, 'b-morning', { participantIds: [cara.id] }, options()),
      refused(403, ONLY_ADMIN),
    );
    await assert.rejects(removeBatch(fran, 'b-morning', options()), refused(403, ONLY_ADMIN));

    const training = trainingStore(ORG, store);
    assert.deepEqual(await training.listBatches(), [batch()]);
  });

  it('is refused to a participant and to every other facilitator', async () => {
    await savedBatch();
    for (const who of [asha, felix]) {
      await assert.rejects(createBatch(who, { name: 'Mine' }, options()), refused(403), who.id);
      await assert.rejects(updateBatch(who, 'b-morning', {}, options()), refused(403), who.id);
      await assert.rejects(removeBatch(who, 'b-morning', options()), refused(403), who.id);
    }
  });

  it('is open to a company administrator and to Technavious', async () => {
    for (const who of [companyAdmin, technavious]) {
      const created = await createBatch(
        who,
        { name: 'Evening', facilitatorId: felix.id, participantIds: [asha.id] },
        options(),
      );
      assert.equal(created.facilitatorId, felix.id, who.id);
      assert.equal(created.createdBy, who.id);
      assert.equal(created.createdAt, NOW);
      assert.match(created.id, /^b-/);
      assert.deepEqual(await trainingStore(ORG, store).getBatch(created.id), created);

      const renamed = await updateBatch(who, created.id, { name: 'Late' }, options());
      assert.equal(renamed.name, 'Late');

      await removeBatch(who, created.id, options());
      assert.equal(await trainingStore(ORG, store).getBatch(created.id), undefined);
    }
  });
});

describe('creating a batch', () => {
  it('lets an administrator name a facilitator or an administrator', async () => {
    const forFelix = await createBatch(
      companyAdmin,
      { name: 'Evening', facilitatorId: felix.id },
      options(),
    );
    assert.equal(forFelix.facilitatorId, felix.id);
    const forThemselves = await createBatch(
      companyAdmin,
      { name: 'Leads', facilitatorId: companyAdmin.id },
      options(),
    );
    assert.equal(forThemselves.facilitatorId, companyAdmin.id);
  });

  it('refuses an administrator who names nobody, a participant, or a stranger', async () => {
    for (const facilitatorId of [undefined, '', asha.id, 'nobody', technavious.id]) {
      await assert.rejects(
        createBatch(companyAdmin, { name: 'Evening', facilitatorId }, options()),
        refused(400),
        String(facilitatorId),
      );
    }
    await assert.rejects(
      createBatch(companyAdmin, { name: 'Evening' }, options()),
      refused(400, /Choose who will facilitate/),
    );
    await assert.rejects(
      createBatch(companyAdmin, { name: 'Evening', facilitatorId: asha.id }, options()),
      refused(400, /not a facilitator/),
    );
    assert.deepEqual(await trainingStore(ORG, store).listBatches(), []);
  });

  it('needs a name, cleaned of control characters and kept to 80 characters', async () => {
    const make = (name: unknown) =>
      createBatch(companyAdmin, { name, facilitatorId: fran.id }, options());
    for (const name of [undefined, '', '   ', 42, '\u0000\u0007']) {
      await assert.rejects(make(name), refused(400, /name/), JSON.stringify(name));
    }
    assert.equal((await make('  Morning\nshift\t')).name, 'Morning shift');
    assert.equal((await make('x'.repeat(200))).name.length, 80);
  });

  it('keeps only real people in the company, once each, in the order given', async () => {
    const created = await createBatch(
      companyAdmin,
      {
        name: 'Morning',
        facilitatorId: fran.id,
        participantIds: [ben.id, 'stranger', asha.id, ben.id, 7, null],
      },
      options(),
    );
    assert.deepEqual(created.participantIds, [ben.id, asha.id]);
    const notAList = await createBatch(
      companyAdmin,
      { name: 'Empty', facilitatorId: fran.id, participantIds: 'asha' },
      options(),
    );
    assert.deepEqual(notAList.participantIds, []);
  });
});

describe('removing a batch', () => {
  it('is not found for a batch that does not exist', async () => {
    await assert.rejects(removeBatch(companyAdmin, 'b-none', options()), refused(404));
  });
});

// -------------------------------------------------------------------- sessions

describe('creating a trainer-led session', () => {
  type Input = Parameters<typeof createSession>[1];

  /** A session set up by Acme's administrator for Fran, unless the input says otherwise. */
  const create = (input: Input, who: SignedInPerson = companyAdmin) =>
    createSession(who, { facilitatorId: fran.id, ...input }, options());

  beforeEach(async () => {
    await approveDeck(technavious, DECK_ID, { store });
  });

  it('is created on an approved deck, and assigns the deck to everybody on it', async () => {
    const created = await create({
      deckId: DECK_ID,
      participantIds: [asha.id, ben.id],
      scheduledFor: '2026-11-14T10:00Z',
    });
    assert.match(created.id, /^s-/);
    assert.equal(created.deckId, DECK_ID);
    assert.equal(created.facilitatorId, fran.id);
    assert.equal(created.status, 'scheduled');
    assert.deepEqual(created.participantIds, [asha.id, ben.id]);
    assert.deepEqual(created.attendance, {});
    assert.equal(created.scheduledFor, '2026-11-14T10:00:00.000Z');
    assert.equal(created.createdBy, companyAdmin.id);
    assert.equal(created.createdAt, NOW);
    assert.equal(created.openedAt, null);
    assert.equal(created.closedAt, null);
    assert.deepEqual(await stored(created.id), created);

    assert.equal(await roster.isAssigned(asha.id, DECK_ID), true);
    assert.equal(await roster.isAssigned(ben.id, DECK_ID), true);
    assert.equal(await roster.isAssigned(cara.id, DECK_ID), false);
  });

  it('is refused to a facilitator, even for a session they would run, and nothing is written', async () => {
    for (const who of [fran, felix, asha]) {
      await assert.rejects(
        create({ deckId: DECK_ID, participantIds: [asha.id] }, who),
        refused(403, ONLY_ADMIN),
        who.id,
      );
    }
    assert.deepEqual(await trainingStore(ORG, store).listSessions(), []);
    assert.equal(await roster.isAssigned(asha.id, DECK_ID), false);
  });

  it('lets an administrator of either kind name the facilitator', async () => {
    const byCompany = await create({
      deckId: DECK_ID,
      facilitatorId: felix.id,
      participantIds: [asha.id],
    });
    assert.equal(byCompany.facilitatorId, felix.id);
    assert.equal(byCompany.createdBy, companyAdmin.id);
    const byTechnavious = await create(
      { deckId: DECK_ID, facilitatorId: companyAdmin.id, participantIds: [asha.id] },
      technavious,
    );
    assert.equal(byTechnavious.facilitatorId, companyAdmin.id);
    assert.equal(byTechnavious.createdBy, technavious.id);
  });

  it('refuses a facilitator who is not a facilitator or administrator in the company', async () => {
    // Technavious staff are not on the customer's roster, so cannot be named either.
    for (const facilitatorId of [undefined, '', asha.id, 'nobody', technavious.id]) {
      await assert.rejects(
        create({ deckId: DECK_ID, facilitatorId, participantIds: [asha.id] }),
        refused(400),
        String(facilitatorId),
      );
    }
    assert.deepEqual(await trainingStore(ORG, store).listSessions(), []);
    assert.equal(await roster.isAssigned(asha.id, DECK_ID), false);
  });

  it('does not assign the deck twice to somebody who already has it', async () => {
    await roster.assign({ personId: asha.id, deckId: DECK_ID, assignedBy: 'earlier' });
    await create({ deckId: DECK_ID, participantIds: [asha.id] });
    const assignments = await roster.listAssignmentsForPerson(asha.id);
    assert.equal(assignments.filter((entry) => entry.deckId === DECK_ID).length, 1);
    assert.equal(assignments[0]?.assignedBy, 'earlier');
  });

  it('refuses a deck that is not in this company', async () => {
    await assert.rejects(
      create({ deckId: 'elsewhere-zzzzzz', participantIds: [asha.id] }),
      refused(400, /Choose a deck/),
    );
    await assert.rejects(create({ participantIds: [asha.id] }), refused(400, /Choose a deck/));
  });

  it('refuses a deck nobody has approved, and writes and assigns nothing', async () => {
    await assert.rejects(
      create({ deckId: 'isms', participantIds: [asha.id] }),
      refused(409, /not been approved/),
    );
    assert.deepEqual(await trainingStore(ORG, store).listSessions(), []);
    assert.equal(await roster.isAssigned(asha.id, 'isms'), false);
  });

  it('refuses a deck that is still a draft', async () => {
    await assert.rejects(create({ deckId: DRAFT_ID, participantIds: [asha.id] }), refused(409));
    assert.equal(await roster.isAssigned(asha.id, DRAFT_ID), false);
  });

  it('refuses an approved deck once it has been taken back to a draft', async () => {
    const decks = new DocumentDeckStore(scopedDocuments(store, ORG));
    resetDeckStore(decks, ORG);
    await decks.save(deck(DECK_ID), 'draft');
    await assert.rejects(
      create({ deckId: DECK_ID, participantIds: [asha.id] }),
      refused(409, /needs approving again/),
    );
    assert.deepEqual(await trainingStore(ORG, store).listSessions(), []);
    assert.equal(await roster.isAssigned(asha.id, DECK_ID), false);
  });

  it('drops unknown participants, and refuses a session left with nobody on it', async () => {
    const created = await create({
      deckId: DECK_ID,
      participantIds: ['stranger', asha.id, asha.id],
    });
    assert.deepEqual(created.participantIds, [asha.id]);
    assert.equal(await roster.isAssigned('stranger', DECK_ID), false);

    for (const participantIds of [undefined, [], ['stranger'], 'asha']) {
      await assert.rejects(
        create({ deckId: DECK_ID, participantIds }),
        refused(400, /at least one participant/),
        JSON.stringify(participantIds),
      );
    }
  });

  it('copies the people from a batch, with any named as well', async () => {
    await savedBatch({ participantIds: [asha.id, ben.id] });
    const created = await create({
      deckId: DECK_ID,
      batchId: 'b-morning',
      participantIds: [cara.id, asha.id],
    });
    assert.equal(created.batchId, 'b-morning');
    assert.deepEqual(created.participantIds, [asha.id, ben.id, cara.id]);
    assert.equal(await roster.isAssigned(ben.id, DECK_ID), true);

    // Copied, not linked: a later change to the batch leaves the session's list alone.
    await trainingStore(ORG, store).saveBatch(batch({ participantIds: [] }));
    assert.deepEqual((await stored(created.id))?.participantIds, [asha.id, ben.id, cara.id]);
  });

  it('lets an administrator use any facilitator’s batch, and refuses one that does not exist', async () => {
    await savedBatch({ facilitatorId: felix.id });
    const created = await create({ deckId: DECK_ID, batchId: 'b-morning' });
    assert.deepEqual(created.participantIds, [asha.id]);
    await assert.rejects(
      create({ deckId: DECK_ID, batchId: 'b-none', participantIds: [asha.id] }),
      refused(400, /not one you can use/),
    );
  });

  it('keeps no date that is not one', async () => {
    for (const scheduledFor of [undefined, 'next Tuesday', 1731488400000, '']) {
      const created = await create({ deckId: DECK_ID, participantIds: [asha.id], scheduledFor });
      assert.equal(created.scheduledFor, null, String(scheduledFor));
    }
  });
});

describe('reading one session', () => {
  it('gives it to its facilitator and to administrators', async () => {
    await saved();
    for (const who of [fran, companyAdmin, technavious]) {
      assert.equal((await sessionFor(who, 's-room1', options())).id, 's-room1', who.id);
    }
  });

  it('is not found for another facilitator, a participant, or a session that does not exist', async () => {
    await saved();
    await assert.rejects(sessionFor(felix, 's-room1', options()), refused(404));
    await assert.rejects(sessionFor(asha, 's-room1', options()), refused(404));
    await assert.rejects(sessionFor(fran, 's-none', options()), refused(404));
  });
});

describe('changing a session', () => {
  it('marks attendance for listed participants, and ignores anybody else', async () => {
    await saved();
    const next = await changeSession(
      fran,
      's-room1',
      { attendance: { [asha.id]: 'present', [cara.id]: 'present', stranger: 'absent' } },
      options(),
    );
    assert.deepEqual(next.attendance, { [asha.id]: 'present' });
    assert.deepEqual((await stored('s-room1'))?.attendance, { [asha.id]: 'present' });
  });

  it('accepts only present or absent, and keeps earlier marks', async () => {
    await saved({ attendance: { [asha.id]: 'present' } });
    const next = await changeSession(
      fran,
      's-room1',
      { attendance: { [asha.id]: 'late', [ben.id]: 'absent' } },
      options(),
    );
    assert.deepEqual(next.attendance, { [asha.id]: 'present', [ben.id]: 'absent' });
    const changed = await changeSession(
      fran,
      's-room1',
      { attendance: { [asha.id]: 'absent' } },
      options(),
    );
    assert.equal(changed.attendance[asha.id], 'absent');
  });

  it('ignores attendance that is not an object of marks', async () => {
    await saved();
    for (const attendance of ['present', 7, null, [asha.id]]) {
      const next = await changeSession(fran, 's-room1', { attendance }, options());
      assert.deepEqual(next.attendance, {}, JSON.stringify(attendance));
    }
  });

  it('opens a scheduled session once, and records when', async () => {
    await saved();
    const opened = await changeSession(fran, 's-room1', { status: 'open' }, options());
    assert.equal(opened.status, 'open');
    assert.equal(opened.openedAt, NOW);
    const again = await changeSession(
      fran,
      's-room1',
      { status: 'open' },
      { store, now: () => LATER },
    );
    assert.equal(again.openedAt, NOW);
  });

  it('cannot be moved back to scheduled, or to a status that does not exist', async () => {
    await saved({ status: 'open', openedAt: NOW });
    for (const status of ['scheduled', 'cancelled', 1]) {
      const next = await changeSession(fran, 's-room1', { status }, options());
      assert.equal(next.status, 'open', String(status));
    }
  });

  it('refuses to close while anybody listed is unmarked, and says how many', async () => {
    await saved({ status: 'open', openedAt: NOW, participantIds: [asha.id, ben.id, cara.id] });
    await assert.rejects(
      changeSession(fran, 's-room1', { status: 'closed' }, options()),
      refused(409, /Mark 3 participants present or absent/),
    );
    await assert.rejects(
      changeSession(
        fran,
        's-room1',
        { status: 'closed', attendance: { [asha.id]: 'present', [ben.id]: 'absent' } },
        options(),
      ),
      refused(409, /Mark one participant present or absent/),
    );
    const unchanged = await stored('s-room1');
    assert.equal(unchanged?.status, 'open');
    // The refused close wrote none of its marks either.
    assert.deepEqual(unchanged?.attendance, {});
  });

  it('closes once everybody is marked, in the same request as the last marks', async () => {
    await saved({ status: 'open', openedAt: NOW, attendance: { [asha.id]: 'present' } });
    const closed = await changeSession(
      fran,
      's-room1',
      { status: 'closed', attendance: { [ben.id]: 'absent' } },
      { store, now: () => LATER },
    );
    assert.equal(closed.status, 'closed');
    assert.equal(closed.closedAt, LATER);
    assert.equal(closed.closedBy, fran.id);
    assert.deepEqual(closed.attendance, { [asha.id]: 'present', [ben.id]: 'absent' });
  });

  it('records which administrator closed it', async () => {
    await saved({
      status: 'open',
      openedAt: NOW,
      attendance: { [asha.id]: 'present', [ben.id]: 'present' },
    });
    const closed = await changeSession(companyAdmin, 's-room1', { status: 'closed' }, options());
    assert.equal(closed.closedBy, companyAdmin.id);
  });

  it('cannot be changed in any way once closed', async () => {
    const record = await saved({
      status: 'closed',
      openedAt: NOW,
      closedAt: LATER,
      closedBy: fran.id,
      attendance: { [asha.id]: 'present', [ben.id]: 'absent' },
    });
    for (const input of [
      { attendance: { [ben.id]: 'present' } },
      { status: 'open' },
      { status: 'closed' },
      {},
    ]) {
      await assert.rejects(
        changeSession(fran, 's-room1', input, options()),
        refused(409, /closed/),
        JSON.stringify(input),
      );
      await assert.rejects(
        changeSession(technavious, 's-room1', input, options()),
        refused(409, /closed/),
      );
    }
    assert.deepEqual(await stored('s-room1'), record);
  });

  it('may be changed by any administrator, including a company administrator', async () => {
    await saved();
    const marked = await changeSession(
      companyAdmin,
      's-room1',
      { attendance: { [asha.id]: 'present' } },
      options(),
    );
    assert.equal(marked.attendance[asha.id], 'present');
    const opened = await changeSession(technavious, 's-room1', { status: 'open' }, options());
    assert.equal(opened.status, 'open');
  });

  it('is not found for another facilitator or a participant, and nothing changes', async () => {
    const record = await saved({ status: 'open', openedAt: NOW });
    for (const who of [felix, asha]) {
      await assert.rejects(
        changeSession(who, 's-room1', { attendance: { [asha.id]: 'absent' } }, options()),
        refused(404),
        who.id,
      );
      await assert.rejects(
        changeSession(who, 's-room1', { status: 'closed' }, options()),
        refused(404),
      );
    }
    assert.deepEqual(await stored('s-room1'), record);
  });

  it('is not found for a session that does not exist', async () => {
    await assert.rejects(
      changeSession(fran, 's-none', { status: 'open' }, options()),
      refused(404),
    );
    assert.equal(await stored('s-none'), undefined);
  });
});

describe('deleting a session', () => {
  // Only who may delete is asserted here. What may be deleted, and how, is being
  // reworked separately (made transactional), and is left to that change's own tests.
  it('is refused to a facilitator, even their own session, and it stays', async () => {
    const record = await saved();
    for (const who of [fran, felix, asha]) {
      await assert.rejects(
        removeSession(who, 's-room1', options()),
        refused(403, ONLY_ADMIN),
        who.id,
      );
    }
    assert.deepEqual(await stored('s-room1'), record);
  });

  it('deletes one that has not started, for an administrator of either kind', async () => {
    for (const who of [companyAdmin, technavious]) {
      await saved();
      await removeSession(who, 's-room1', options());
      assert.equal(await stored('s-room1'), undefined, who.id);
    }
  });

  it('is not found for an administrator when the session does not exist', async () => {
    await assert.rejects(removeSession(companyAdmin, 's-none', options()), refused(404));
  });
});

describe('one company’s training', () => {
  it('cannot be reached from another', async () => {
    await saved();
    await savedBatch();
    const globex = person('gina', 'admin', { orgId: 'globex', homeOrgId: 'globex' });
    await assert.rejects(sessionFor(globex, 's-room1', options()), refused(404));
    await assert.rejects(
      changeSession(globex, 's-room1', { status: 'open' }, options()),
      refused(404),
    );
    await assert.rejects(removeBatch(globex, 'b-morning', options()), refused(404));
    assert.equal((await stored('s-room1'))?.status, 'scheduled');
  });
});
