import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { preAssessmentClosed } from '../assessments/service';
import { InMemoryDocumentStore } from '../roster/documents';
import type { Role, SignedInPerson } from '../roster/types';
import { removeFromTraining, removeSession, TrainingRuleError, updateBatch } from './service';
import { trainingStore } from './store';
import type { Batch, TrainingSession } from './types';

/**
 * The fixes after the UAT review: the pre-session assessment closes when a trainer-led
 * session starts, and writes to sessions and batches never put back a stale copy.
 */

const ORG = 'acme';

function person(id: string, role: Role): SignedInPerson {
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
  };
}

const admin = person('hr', 'admin');

function session(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: 's-one',
    deckId: 'deck',
    facilitatorId: 'fran',
    batchId: null,
    participantIds: ['asha', 'ravi'],
    scheduledFor: null,
    status: 'scheduled',
    attendance: {},
    createdBy: admin.id,
    createdAt: '2026-11-10T00:00:00.000Z',
    openedAt: null,
    closedAt: null,
    closedBy: null,
    ...overrides,
  };
}

function batch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: 'b-one',
    name: 'Day one',
    facilitatorId: 'fran',
    participantIds: ['asha', 'ravi'],
    createdBy: admin.id,
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    ...overrides,
  } as Batch;
}

describe('the pre-session assessment', () => {
  it('stays open until a trainer-led session starts, then closes', () => {
    assert.equal(preAssessmentClosed(session()), false);
    assert.equal(preAssessmentClosed(session({ status: 'open', openedAt: 'x' })), true);
    assert.equal(preAssessmentClosed(session({ status: 'closed', openedAt: 'x' })), true);
  });

  it('never closes for a one-to-one session, whose start it gates', () => {
    assert.equal(preAssessmentClosed(null), false);
  });
});

describe('deleting a session', () => {
  it('refuses one that has started, and leaves it as it was', async () => {
    const store = new InMemoryDocumentStore();
    const training = trainingStore(ORG, store);
    await training.saveSession(session({ status: 'open', openedAt: '2026-11-13T04:30:00Z' }));
    await assert.rejects(
      removeSession(admin, 's-one', { store }),
      (error: unknown) => error instanceof TrainingRuleError && error.status === 409,
    );
    const kept = await training.getSession('s-one');
    assert.equal(kept?.status, 'open');
    assert.equal(kept?.cancelledAt, undefined);
  });

  it('deletes one that has not started', async () => {
    const store = new InMemoryDocumentStore();
    const training = trainingStore(ORG, store);
    await training.saveSession(session());
    await removeSession(admin, 's-one', { store });
    assert.equal(await training.getSession('s-one'), undefined);
  });
});

describe('removing somebody from training', () => {
  it('takes them out of batches and sessions not yet started, re-read as they stand', async () => {
    const store = new InMemoryDocumentStore();
    const training = trainingStore(ORG, store);
    await training.saveBatch(batch());
    await training.saveSession(session());
    await training.saveSession(session({ id: 's-two', status: 'open', openedAt: 'x' }));
    await removeFromTraining(admin, 'ravi', { store });
    assert.deepEqual((await training.getBatch('b-one'))?.participantIds, ['asha']);
    assert.deepEqual((await training.getSession('s-one'))?.participantIds, ['asha']);
    // A session that ran keeps them: attendance is a record.
    assert.deepEqual((await training.getSession('s-two'))?.participantIds, ['asha', 'ravi']);
  });
});

describe('editing a batch', () => {
  it('changes only what was asked, on the batch as it stands', async () => {
    const store = new InMemoryDocumentStore();
    const training = trainingStore(ORG, store);
    await training.saveBatch(batch());
    const edited = await updateBatch(admin, 'b-one', { name: 'Day two' }, { store });
    assert.equal(edited.name, 'Day two');
    assert.deepEqual(edited.participantIds, ['asha', 'ravi']);
    assert.equal((await training.getBatch('b-one'))?.name, 'Day two');
  });

  it('is refused to a facilitator', async () => {
    const store = new InMemoryDocumentStore();
    await trainingStore(ORG, store).saveBatch(batch());
    await assert.rejects(
      updateBatch(person('fran', 'facilitator'), 'b-one', { name: 'Mine' }, { store }),
      (error: unknown) => error instanceof TrainingRuleError && error.status === 403,
    );
  });
});
