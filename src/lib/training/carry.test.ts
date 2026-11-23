import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { scopedDocuments } from '../orgs/scope';
import { findProfile, saveUploadedProfile } from '../profiles/store';
import { InMemoryDocumentStore } from '../roster/documents';
import { recordLeaver } from '../roster/leavers';
import { localPersonId } from '../roster/store';
import { DocumentRosterStore } from '../roster/store-documents';
import type { Role, SignedInPerson } from '../roster/types';
import { facilitatesPerson, mayManageSession, sessionsListing } from './access';
import { carryTrainingRecords, upsertPersonWithTraining } from './carry';
import { repairOrg } from './repair';
import { visibleBatches } from './service';
import { trainingStore } from './store';
import type { Batch, TrainingSession } from './types';

/**
 * Somebody listed before their first sign-in stays listed after it (D-18).
 *
 * An administrator can add somebody who has never signed in, under a placeholder id, and
 * list them in sessions and batches, as a participant or as the facilitator. Signing in
 * replaces the placeholder with their real id; these are the tests that their sessions and
 * batches come with it, from both sign-in routes' one way of writing the roster, and that
 * the repair script finds and rewrites what was left behind before.
 *
 * Driven through the in-memory document store, with the roster built on it, so the code
 * under test is the deployed code.
 */

const ORG = 'acme';
const ASHA = 'asha@acme.example';
const FRAN = 'fran@acme.example';

function signedIn(id: string, role: Role, email: string): SignedInPerson {
  return {
    id,
    orgId: ORG,
    homeOrgId: ORG,
    platform: false,
    email,
    emailKey: email,
    name: id,
    role,
    createdAt: '2026-11-01T00:00:00.000Z',
    lastSeenAt: '2026-11-20T00:00:00.000Z',
  };
}

function session(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: 's-room1',
    deckId: 'safety-a1b2c3',
    facilitatorId: 'fran',
    batchId: null,
    participantIds: ['ben'],
    scheduledFor: '2026-11-25T09:00:00.000Z',
    status: 'scheduled',
    attendance: {},
    createdBy: 'hr',
    createdAt: '2026-11-18T00:00:00.000Z',
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
    facilitatorId: 'fran',
    participantIds: ['ben'],
    createdBy: 'hr',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    ...overrides,
  };
}

let store: InMemoryDocumentStore;
let roster: DocumentRosterStore;
const training = () => trainingStore(ORG, store);

beforeEach(() => {
  store = new InMemoryDocumentStore();
  roster = new DocumentRosterStore(scopedDocuments(store, ORG));
});

afterEach(() => {
  mock.restoreAll();
});

describe('carrying somebody to their real id', () => {
  const OLD = localPersonId(ASHA);

  it('rewrites everything a session and a batch say about the old id, and nothing else', async () => {
    await training().saveSession(
      session({
        participantIds: ['ben', OLD],
        status: 'closed',
        attendance: { ben: 'present', [OLD]: 'absent' },
        attendanceAt: { ben: '2026-11-25T09:01:00.000Z', [OLD]: '2026-11-25T09:02:00.000Z' },
        people: {
          ben: { name: 'Ben', email: 'ben@acme.example' },
          [OLD]: { name: '', email: ASHA },
        },
        openedAt: '2026-11-25T09:00:00.000Z',
        closedAt: '2026-11-25T11:00:00.000Z',
        closedBy: 'fran',
      }),
    );
    await training().saveSession(session({ id: 's-other', participantIds: ['ben'] }));
    await training().saveBatch(batch({ participantIds: [OLD, 'ben'] }));

    const carried = await carryTrainingRecords(ORG, OLD, 'asha-uid', { store });
    assert.deepEqual(carried, { sessions: ['s-room1'], batches: ['b-morning'] });

    const moved = (await training().getSession('s-room1'))!;
    assert.deepEqual(moved.participantIds, ['ben', 'asha-uid']);
    assert.deepEqual(moved.attendance, { ben: 'present', 'asha-uid': 'absent' });
    assert.deepEqual(moved.attendanceAt, {
      ben: '2026-11-25T09:01:00.000Z',
      'asha-uid': '2026-11-25T09:02:00.000Z',
    });
    assert.deepEqual(moved.people, {
      ben: { name: 'Ben', email: 'ben@acme.example' },
      'asha-uid': { name: '', email: ASHA },
    });
    // What the session says about anybody else, and when, is untouched.
    assert.equal(moved.status, 'closed');
    assert.equal(moved.closedBy, 'fran');
    assert.deepEqual((await training().getBatch('b-morning'))!.participantIds, ['asha-uid', 'ben']);
    assert.deepEqual(await training().getSession('s-other'), session({ id: 's-other' }));
  });

  it('carries a facilitator, and whoever set a session or batch up', async () => {
    const OLD_FRAN = localPersonId(FRAN);
    await training().saveSession(session({ facilitatorId: OLD_FRAN, createdBy: OLD_FRAN }));
    await training().saveBatch(batch({ facilitatorId: OLD_FRAN }));
    await carryTrainingRecords(ORG, OLD_FRAN, 'fran-uid', { store });
    const moved = (await training().getSession('s-room1'))!;
    assert.equal(moved.facilitatorId, 'fran-uid');
    assert.equal(moved.createdBy, 'fran-uid');
    assert.equal((await training().getBatch('b-morning'))!.facilitatorId, 'fran-uid');
  });

  it('lists somebody once, keeping a mark already made under their real id', async () => {
    // Listed again under their real id after a carry was missed, and marked then.
    await training().saveSession(
      session({
        participantIds: [OLD, 'ben', 'asha-uid'],
        attendance: { [OLD]: 'absent', 'asha-uid': 'present' },
        attendanceAt: { [OLD]: '2026-11-25T09:00:00.000Z', 'asha-uid': '2026-11-25T09:30:00.000Z' },
      }),
    );
    await carryTrainingRecords(ORG, OLD, 'asha-uid', { store });
    const moved = (await training().getSession('s-room1'))!;
    assert.deepEqual(moved.participantIds, ['asha-uid', 'ben']);
    assert.deepEqual(moved.attendance, { 'asha-uid': 'present' });
    assert.deepEqual(moved.attendanceAt, { 'asha-uid': '2026-11-25T09:30:00.000Z' });
  });

  it('finds nothing to do a second time', async () => {
    await training().saveSession(session({ participantIds: [OLD] }));
    await carryTrainingRecords(ORG, OLD, 'asha-uid', { store });
    const before = await training().getSession('s-room1');
    assert.deepEqual(await carryTrainingRecords(ORG, OLD, 'asha-uid', { store }), {
      sessions: [],
      batches: [],
    });
    assert.deepEqual(await training().getSession('s-room1'), before);
  });
});

describe('signing in for the first time, after being listed', () => {
  it('keeps a participant in their sessions and batches, so they and their facilitator find them', async () => {
    // Added by an administrator, listed, then signing in: the sign-in route's own call.
    const added = await roster.upsertPerson({ email: ASHA, name: 'Asha', orgId: ORG });
    assert.equal(added.id, localPersonId(ASHA));
    await roster.assign({ personId: added.id, deckId: 'safety-a1b2c3', assignedBy: 'hr' });
    await training().saveSession(session({ participantIds: ['ben', added.id] }));
    await training().saveBatch(batch({ participantIds: [added.id] }));

    const person = await upsertPersonWithTraining(
      roster,
      ORG,
      { id: 'asha-uid', email: ASHA, name: 'Asha Rao', orgId: ORG },
      { store },
    );
    assert.equal(person.id, 'asha-uid');

    const asha = signedIn('asha-uid', 'trainee', ASHA);
    const fran = signedIn('fran', 'facilitator', FRAN);
    assert.deepEqual(
      (await sessionsListing(asha, { store })).map((each) => each.id),
      ['s-room1'],
      'the participant no longer finds their session',
    );
    assert.equal(await facilitatesPerson(fran, 'asha-uid', { store }), true);
    assert.deepEqual((await training().getBatch('b-morning'))!.participantIds, ['asha-uid']);
    // The roster's own carrying, of what it keeps, still happens alongside.
    assert.equal(await roster.isAssigned('asha-uid', 'safety-a1b2c3'), true);
  });

  it('keeps a facilitator running the sessions and batches they were given', async () => {
    const added = await roster.upsertPerson({ email: FRAN, role: 'facilitator', orgId: ORG });
    await training().saveSession(session({ facilitatorId: added.id }));
    await training().saveBatch(batch({ facilitatorId: added.id }));

    await upsertPersonWithTraining(roster, ORG, { id: 'fran-uid', email: FRAN }, { store });

    const fran = signedIn('fran-uid', 'facilitator', FRAN);
    const sessions = await training().sessionsFacilitatedBy('fran-uid');
    assert.deepEqual(
      sessions.map((each) => each.id),
      ['s-room1'],
    );
    assert.equal(mayManageSession(fran, sessions[0]!), true);
    assert.deepEqual(
      visibleBatches(fran, await training().listBatches()).map((each) => each.id),
      ['b-morning'],
    );
    assert.equal((await roster.getPerson('fran-uid'))?.role, 'facilitator');
  });

  it('still finds a profile uploaded before they signed in, by their address', async () => {
    const added = await roster.upsertPerson({ email: ASHA, orgId: ORG });
    await saveUploadedProfile(
      { id: added.id, orgId: ORG, emailKey: added.emailKey },
      { name: 'Asha Rao', department: 'Facilities' },
      'hr',
      { store },
    );
    const person = await upsertPersonWithTraining(
      roster,
      ORG,
      { id: 'asha-uid', email: ASHA },
      {
        store,
      },
    );
    const found = await findProfile(
      { id: person.id, orgId: ORG, emailKey: person.emailKey },
      { store },
    );
    assert.equal(found?.department, 'Facilities');
  });

  it('does not look at sessions for somebody whose id has not changed', async () => {
    await roster.upsertPerson({ id: 'asha-uid', email: ASHA, orgId: ORG });
    await training().saveSession(session({ participantIds: ['asha-uid'] }));
    const listed = mock.method(store, 'all');
    await upsertPersonWithTraining(roster, ORG, { id: 'asha-uid', email: ASHA }, { store });
    assert.equal(
      listed.mock.calls.filter((call) => String(call.arguments[0]).endsWith('trainingSessions'))
        .length,
      0,
    );
  });

  it('signs them in even when their sessions cannot be carried, and says so in the log', async () => {
    await roster.upsertPerson({ email: ASHA, orgId: ORG });
    // The training store refuses every write; the roster, on a store of its own, does not.
    const broken = new InMemoryDocumentStore();
    await trainingStore(ORG, broken).saveSession(
      session({ participantIds: [localPersonId(ASHA)] }),
    );
    mock.method(broken, 'update', async () => {
      throw new Error('Firestore is unavailable');
    });
    const logged = mock.method(console, 'error', () => undefined);

    const person = await upsertPersonWithTraining(
      roster,
      ORG,
      { id: 'asha-uid', email: ASHA },
      { store: broken },
    );
    assert.equal(person.id, 'asha-uid');
    assert.equal((await roster.getPerson('asha-uid'))?.email, ASHA);
    assert.equal(logged.mock.callCount(), 1);
    assert.match(String(logged.mock.calls[0]!.arguments[0]), /asha-uid.*Firestore is unavailable/);
  });
});

describe('repairing what was left behind (scripts/repair-placeholder-ids.ts)', () => {
  const OLD_ASHA = localPersonId(ASHA);
  const OLD_BEN = localPersonId('ben@acme.example');
  const OLD_CARA = localPersonId('cara@acme.example');

  beforeEach(async () => {
    // Fran and Asha signed in before signing in carried sessions; Ben has not signed in
    // yet; Cara signed in and has been removed since.
    await roster.upsertPerson({ id: 'fran', email: FRAN, name: 'Fran', role: 'facilitator' });
    await roster.upsertPerson({ email: ASHA, name: 'Asha' });
    await roster.upsertPerson({ id: 'asha-uid', email: ASHA, name: 'Asha Rao' });
    await roster.upsertPerson({ email: 'ben@acme.example', name: 'Ben' });
    await recordLeaver(
      ORG,
      { id: 'cara-uid', name: 'Cara', email: 'cara@acme.example', emailKey: 'cara@acme.example' },
      'hr',
      { store },
    );
    await training().saveSession(
      session({
        participantIds: [OLD_ASHA, OLD_BEN, OLD_CARA],
        status: 'closed',
        attendance: { [OLD_ASHA]: 'present', [OLD_BEN]: 'absent', [OLD_CARA]: 'present' },
        openedAt: '2026-11-19T09:00:00.000Z',
        closedAt: '2026-11-19T11:00:00.000Z',
        closedBy: 'fran',
      }),
    );
    await training().saveSession(session({ id: 's-next', participantIds: [OLD_ASHA, OLD_CARA] }));
    await training().saveBatch(batch({ participantIds: [OLD_ASHA, OLD_CARA] }));
  });

  const repair = (apply: boolean) => repairOrg(ORG, { apply, store, roster });

  it('reports what it would change, and changes nothing', async () => {
    const before = await training().listSessions();
    const report = await repair(false);
    assert.equal(report.applied, false);
    assert.deepEqual(
      report.lines.map((line) => `${line.kind} ${line.id}`),
      ['session s-room1', 'session s-next', 'batch b-morning'],
    );
    assert.ok(
      report.lines[0]!.changes.includes(`${OLD_ASHA} is now asha-uid (${ASHA})`),
      report.lines[0]!.changes.join('; '),
    );
    assert.deepEqual(await training().listSessions(), before);
  });

  it('rewrites placeholders to real ids, takes off a leaver as removing them would have, and fills the names', async () => {
    const report = await repair(true);
    assert.ok(report.lines.every((line) => !line.failed));

    const held = (await training().getSession('s-room1'))!;
    // A session that took place keeps everybody on it, a leaver included, under the id
    // their records are under; Ben has not signed in, so he is still his placeholder.
    assert.deepEqual(held.participantIds, ['asha-uid', OLD_BEN, 'cara-uid']);
    assert.deepEqual(held.attendance, {
      'asha-uid': 'present',
      [OLD_BEN]: 'absent',
      'cara-uid': 'present',
    });
    assert.deepEqual(held.people, {
      fran: { name: 'Fran', email: FRAN },
      'asha-uid': { name: 'Asha Rao', email: ASHA },
      [OLD_BEN]: { name: 'Ben', email: 'ben@acme.example' },
      'cara-uid': { name: 'Cara', email: 'cara@acme.example' },
    });

    // One that has not happened, and the batch, lose the leaver, as removing her does.
    const next = (await training().getSession('s-next'))!;
    assert.deepEqual(next.participantIds, ['asha-uid']);
    assert.deepEqual(Object.keys(next.people ?? {}).sort(), ['asha-uid', 'fran']);
    assert.deepEqual((await training().getBatch('b-morning'))!.participantIds, ['asha-uid']);

    const again = await repair(true);
    assert.deepEqual(again.lines, [], 'a second run found more to do');
  });

  it('leaves alone a placeholder that two people’s addresses give, and says so', async () => {
    // "a.b" and "a-b" make the same placeholder, so it cannot be told whose it was.
    await roster.upsertPerson({ id: 'ab-dot', email: 'a.b@acme.example' });
    await roster.upsertPerson({ id: 'ab-dash', email: 'a-b@acme.example' });
    const shared = localPersonId('a.b@acme.example');
    assert.equal(shared, localPersonId('a-b@acme.example'));
    await training().saveSession(session({ id: 's-shared', participantIds: [shared] }));

    const report = await repair(true);
    assert.deepEqual(
      report.leftAlone.map((each) => each.placeholder),
      [shared],
    );
    assert.deepEqual((await training().getSession('s-shared'))!.participantIds, [shared]);
  });
});
