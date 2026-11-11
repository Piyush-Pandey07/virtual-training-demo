import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { pathToFileURL } from 'node:url';

import { orgsConfigured } from '../orgs/registry';
import { scopedDocuments } from '../orgs/scope';
import { InMemoryDocumentStore } from '../roster/documents';
import { resetRosterStore } from '../roster/registry';
import { DocumentRosterStore } from '../roster/store-documents';
import type { Role, SignedInPerson } from '../roster/types';
import type { FacilitatedGate, FacilitatedRequest } from './facilitation';
import { trainingStore } from './store';
import type { TrainingSession } from './types';

/**
 * Checking a hand-over from a trainer-led session before the trainer speaks (AI-01).
 *
 * facilitation.ts imports the auth guard, which imports `next/navigation` and reads the
 * request's cookies, so it cannot be loaded outside Next as it stands. Rather than
 * change it, this file replaces the guard, and the consent gate, with Node's module
 * mocks, which need
 * `--experimental-test-module-mocks`. `npm test` does not pass that flag, so under it
 * this file runs itself again in a child process that does, and passes or fails with it.
 *
 * Inside the child the gate's own code runs unchanged against the in-memory training
 * store (Firebase is not configured there) and a roster built on an in-memory store.
 */

const MOCKS_FLAG = '--experimental-test-module-mocks';
const CHILD = 'TRAINING_FACILITATION_CHILD';

const ORG = 'acme';
const DECK_ID = 'safety-a1b2c3';

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
const asha = person('asha', 'trainee', { name: 'Asha Rao' });
const ben = person('ben', 'trainee', { name: 'Ben Okafor' });
const cara = person('cara', 'trainee', { name: '', email: 'cara.singh@acme.example' });

if (process.env[CHILD] !== '1') {
  describe('the facilitation rules, with the auth guard replaced', () => {
    it('pass in a child process with module mocks enabled', () => {
      // Without Firebase, so the gate's stores are the in-memory ones and nothing real
      // can be reached from a test.
      const env: NodeJS.ProcessEnv = { ...process.env, [CHILD]: '1' };
      for (const key of Object.keys(env)) {
        if (key.startsWith('FIREBASE_')) delete env[key];
      }
      delete env.NODE_TEST_CONTEXT;
      const run = spawnSync(
        process.execPath,
        [
          MOCKS_FLAG,
          '--import',
          'tsx',
          '--conditions',
          'react-server',
          '--test',
          '--test-reporter=tap',
          __filename,
        ],
        { cwd: resolve(__dirname, '../../..'), env, encoding: 'utf8', timeout: 120_000 },
      );
      const output = `${run.stdout}\n${run.stderr}`;
      assert.equal(run.status, 0, output);
      assert.match(run.stdout, /^# fail 0$/m, output);
      // A child that ran nothing would also exit cleanly.
      const passed = Number(/^# pass (\d+)$/m.exec(run.stdout)?.[1] ?? 0);
      assert.ok(passed >= 20, `only ${passed} facilitation tests ran\n${output}`);
    });
  });
} else {
  /** Who the replaced guard says is signed in. Null is signed out. */
  let signedIn: SignedInPerson | null = null;
  /** Who the replaced consent gate says has still to agree to the privacy notice. */
  let unconsented = new Set<string>();

  class SignedOut extends Error {}

  mock.module(pathToFileURL(resolve(__dirname, '../auth/guard.ts')).href, {
    namedExports: {
      requireUser: async () => {
        if (!signedIn) throw new SignedOut('Sign in to do that.');
        return signedIn;
      },
      unauthorisedResponse: (error: unknown) =>
        error instanceof SignedOut
          ? Response.json({ error: error.message }, { status: 401 })
          : null,
    },
  });

  // Replaced too, because it caches with React's per-request `cache` and reads the
  // profile store; which people need consent is decided by the test instead.
  mock.module(pathToFileURL(resolve(__dirname, '../profiles/gate.ts')).href, {
    namedExports: {
      needsConsent: async (who: { id: string }) => unconsented.has(who.id),
    },
  });

  let facilitation: typeof import('./facilitation');

  before(async () => {
    assert.equal(orgsConfigured(), false, 'the child must not have Firebase configured');
    facilitation = await import('./facilitation');
  });

  const training = () => trainingStore(ORG);

  function session(overrides: Partial<TrainingSession> = {}): TrainingSession {
    return {
      id: 's-room1',
      deckId: DECK_ID,
      facilitatorId: fran.id,
      batchId: null,
      participantIds: [asha.id, ben.id, cara.id],
      scheduledFor: '2026-11-13T09:00:00.000Z',
      status: 'open',
      attendance: {},
      createdBy: companyAdmin.id,
      createdAt: '2026-11-08T00:00:00.000Z',
      openedAt: '2026-11-13T09:00:00.000Z',
      closedAt: null,
      closedBy: null,
      ...overrides,
    };
  }

  async function saved(overrides: Partial<TrainingSession> = {}): Promise<TrainingSession> {
    const value = session(overrides);
    await training().saveSession(value);
    return value;
  }

  const request = (extra: Partial<FacilitatedRequest> = {}): FacilitatedRequest => ({
    sessionId: 's-room1',
    turn: 'answer',
    ...extra,
  });

  async function refusal(gate: FacilitatedGate): Promise<{ status: number; body: unknown }> {
    assert.equal(gate.ok, false, 'expected the hand-over to be refused');
    if (gate.ok) throw new Error('unreachable');
    return { status: gate.response.status, body: await gate.response.json() };
  }

  function room(gate: FacilitatedGate) {
    assert.equal(gate.ok, true, 'expected the hand-over to be allowed');
    if (!gate.ok) throw new Error('unreachable');
    return gate;
  }

  beforeEach(async () => {
    signedIn = fran;
    unconsented = new Set();
    const roster = new DocumentRosterStore(scopedDocuments(new InMemoryDocumentStore(), ORG));
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
  });

  afterEach(async () => {
    // The training store here is the module's own in-memory fallback, shared by every
    // case, so each case clears what it wrote.
    for (const entry of await training().listSessions()) await training().removeSession(entry.id);
    resetRosterStore();
  });

  describe('the facilitated part of a chat request', () => {
    it('is read when it names a session and a known turn', () => {
      for (const turn of ['explain', 'answer', 'greet', 'engage'] as const) {
        assert.deepEqual(facilitation.parseFacilitated({ sessionId: 's-1', turn }), {
          sessionId: 's-1',
          turn,
        });
      }
    });

    it('keeps who asked, trimmed, and drops a blank or non-string one', () => {
      const { parseFacilitated } = facilitation;
      assert.deepEqual(parseFacilitated({ sessionId: 's-1', turn: 'answer', askedBy: '  Asha ' }), {
        sessionId: 's-1',
        turn: 'answer',
        askedBy: 'Asha',
      });
      for (const askedBy of ['   ', '', 7, null]) {
        assert.deepEqual(parseFacilitated({ sessionId: 's-1', turn: 'answer', askedBy }), {
          sessionId: 's-1',
          turn: 'answer',
        });
      }
    });

    it('is null for a one-to-one turn or anything malformed', () => {
      for (const raw of [
        undefined,
        null,
        'facilitated',
        42,
        {},
        { turn: 'answer' },
        { sessionId: '', turn: 'answer' },
        { sessionId: 5, turn: 'answer' },
        { sessionId: 's-1' },
        { sessionId: 's-1', turn: 'lecture' },
        { sessionId: 's-1', turn: 'ANSWER' },
      ]) {
        assert.equal(facilitation.parseFacilitated(raw), null, JSON.stringify(raw));
      }
    });
  });

  describe('the name a participant is addressed by', () => {
    it('is their first name', () => {
      const { addressName } = facilitation;
      assert.equal(addressName({ name: 'Asha Rao', email: 'asha@acme.example' }), 'Asha');
      assert.equal(addressName({ name: '  Ben   Okafor ', email: 'b@acme.example' }), 'Ben');
    });

    it('is the first part of their email when they have no name', () => {
      const { addressName } = facilitation;
      assert.equal(addressName({ email: 'cara.singh@acme.example' }), 'cara.singh');
      assert.equal(addressName({ name: '', email: 'cara@acme.example' }), 'cara');
      assert.equal(addressName({ name: '   ', email: 'cara@acme.example' }), 'cara');
    });
  });

  describe('checking a hand-over', () => {
    it('lets the session’s facilitator hand over, and describes the room', async () => {
      const record = await saved();
      const gate = room(await facilitation.checkFacilitated(request(), DECK_ID));
      assert.equal(gate.person.id, fran.id);
      assert.deepEqual(gate.room.session, record);
      assert.deepEqual(gate.room.attendees, ['Asha', 'Ben', 'cara.singh']);
      assert.equal('askedBy' in gate.room, false);
    });

    it('lets any administrator hand over, a company administrator included', async () => {
      await saved();
      for (const who of [companyAdmin, technavious]) {
        signedIn = who;
        const gate = room(await facilitation.checkFacilitated(request(), DECK_ID));
        assert.equal(gate.person.id, who.id);
      }
    });

    it('is not found when the request names no deck, so no default deck is taught', async () => {
      await saved();
      for (const deckId of [undefined, '']) {
        const gate = await facilitation.checkFacilitated(request(), deckId);
        assert.equal((await refusal(gate)).status, 404, JSON.stringify(deckId));
      }
    });

    it('refuses a facilitator who has not agreed to the privacy notice', async () => {
      await saved();
      unconsented.add(fran.id);
      const { status, body } = await refusal(
        await facilitation.checkFacilitated(request(), DECK_ID),
      );
      assert.equal(status, 403);
      assert.match((body as { error: string }).error, /privacy notice/);
      assert.equal((body as { retry: boolean }).retry, false);
    });

    it('asks for consent only of the person running it, not the participants', async () => {
      await saved();
      unconsented = new Set([asha.id, ben.id]);
      room(await facilitation.checkFacilitated(request(), DECK_ID));
    });

    it('says not found, rather than asking for consent, to somebody who may not run it', async () => {
      await saved({ facilitatorId: felix.id });
      unconsented.add(fran.id);
      const { status } = await refusal(await facilitation.checkFacilitated(request(), DECK_ID));
      assert.equal(status, 404);
    });

    it('allows a session that is scheduled but not yet open', async () => {
      await saved({ status: 'scheduled', openedAt: null });
      room(await facilitation.checkFacilitated(request(), DECK_ID));
    });

    it('refuses somebody signed out', async () => {
      await saved();
      signedIn = null;
      const { status } = await refusal(await facilitation.checkFacilitated(request(), DECK_ID));
      assert.equal(status, 401);
    });

    it('is not found for a facilitator whose colleague runs the session', async () => {
      await saved({ facilitatorId: felix.id });
      const { status } = await refusal(await facilitation.checkFacilitated(request(), DECK_ID));
      assert.equal(status, 404);
    });

    it('is not found for a participant, even one listed on the session', async () => {
      await saved();
      signedIn = asha;
      const { status } = await refusal(await facilitation.checkFacilitated(request(), DECK_ID));
      assert.equal(status, 404);
    });

    it('is not found for a session that does not exist, or one in another company', async () => {
      await saved();
      const missing = await facilitation.checkFacilitated(
        request({ sessionId: 's-none' }),
        DECK_ID,
      );
      assert.equal((await refusal(missing)).status, 404);

      signedIn = person('gina', 'admin', { orgId: 'globex', homeOrgId: 'globex' });
      const elsewhere = await facilitation.checkFacilitated(request(), DECK_ID);
      assert.equal((await refusal(elsewhere)).status, 404);
    });

    it('is not found when the session is for a different deck', async () => {
      await saved();
      const gate = await facilitation.checkFacilitated(request(), 'isms');
      assert.equal((await refusal(gate)).status, 404);
    });

    it('refuses a closed session, and says it will not come back', async () => {
      await saved({
        status: 'closed',
        closedAt: '2026-11-13T11:00:00.000Z',
        closedBy: fran.id,
        attendance: { [asha.id]: 'present', [ben.id]: 'present', [cara.id]: 'present' },
      });
      for (const who of [fran, technavious]) {
        signedIn = who;
        const { status, body } = await refusal(
          await facilitation.checkFacilitated(request(), DECK_ID),
        );
        assert.equal(status, 409);
        assert.deepEqual(body, {
          error: 'This session is closed.',
          code: 'unavailable',
          retry: false,
        });
      }
    });

    it('leaves out of the room anybody marked absent, and keeps the unmarked', async () => {
      await saved({ attendance: { [asha.id]: 'present', [ben.id]: 'absent' } });
      const gate = room(await facilitation.checkFacilitated(request(), DECK_ID));
      assert.deepEqual(gate.room.attendees, ['Asha', 'cara.singh']);
    });

    it('leaves out a listed id that is no longer on the roster', async () => {
      await saved({ participantIds: [asha.id, 'gone'] });
      const gate = room(await facilitation.checkFacilitated(request(), DECK_ID));
      assert.deepEqual(gate.room.attendees, ['Asha']);
    });

    it('names who asked only if they are an attendee, as the roster spells it', async () => {
      await saved({ attendance: { [ben.id]: 'absent' } });
      const asked = async (askedBy: string) =>
        room(await facilitation.checkFacilitated(request({ askedBy }), DECK_ID)).room.askedBy;

      assert.equal(await asked('Asha'), 'Asha');
      assert.equal(await asked('aSHA'), 'Asha');
      assert.equal(await asked('cara.singh'), 'cara.singh');
      // Marked absent, not on the list at all, or a full name rather than the first.
      assert.equal(await asked('Ben'), undefined);
      assert.equal(await asked('Felix'), undefined);
      assert.equal(await asked('Asha Rao'), undefined);
    });
  });
}
