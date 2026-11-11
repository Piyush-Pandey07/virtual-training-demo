/**
 * The rules for batches and trainer-led sessions, apart from the routes that call them.
 *
 * Kept here so the routes stay thin and the rules can be tested without a server:
 * who may create what, which participant ids are acceptable, and what a session's
 * status may move to. Everything takes the signed-in person and builds its stores from
 * their organisation, so nothing here can reach another customer.
 */

import 'server-only';

import { assignmentRefusal } from '../decks/approval';
import { listDecks } from '../decks/registry';
import type { DocumentStore } from '../roster/documents';
import { rosterStore } from '../roster/registry';
import type { SignedInPerson } from '../roster/types';
import { mayManageSession } from './access';
import { newTrainingId, trainingStore } from './store';
import type { AttendanceMark, Batch, TrainingSession } from './types';

export class TrainingRuleError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export interface Options {
  store?: DocumentStore;
  now?: () => string;
}

const nowIso = () => new Date().toISOString();

/**
 * Only an administrator sets up batches and sessions and decides who is in them.
 *
 * A facilitator runs the sessions they are given. Being in a facilitator's batch or
 * session is what lets them see a participant's profile, results and feedback, so if
 * they could choose the people themselves they could put anybody in the company in a
 * batch, read their profile and delete the batch again, which AI-06 keeps even from a
 * company administrator.
 */
function refuseUnlessOrganiser(person: SignedInPerson): void {
  if (!person.platform && person.role !== 'admin') {
    throw new TrainingRuleError(403, 'Only an administrator sets up batches and sessions.');
  }
}

/** The ids in a list that are real people in this company, in their given order, once. */
async function knownPeople(person: SignedInPerson, ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids)) return [];
  const roster = await rosterStore(person.orgId).listPeople();
  const known = new Set(roster.map((entry) => entry.id));
  return [...new Set(ids.filter((id): id is string => typeof id === 'string'))].filter((id) =>
    known.has(id),
  );
}

/**
 * Whom the facilitator of a new batch or session may be.
 *
 * A facilitator sets things up for themselves only. An administrator names any
 * facilitator, or administrator, in the company.
 */
async function chosenFacilitator(person: SignedInPerson, requested: unknown): Promise<string> {
  if (person.role === 'facilitator') return person.id;
  if (typeof requested !== 'string' || !requested) {
    throw new TrainingRuleError(400, 'Choose who will facilitate.');
  }
  const facilitator = await rosterStore(person.orgId).getPerson(requested);
  if (!facilitator || (facilitator.role !== 'facilitator' && facilitator.role !== 'admin')) {
    throw new TrainingRuleError(400, 'That person is not a facilitator in this company.');
  }
  return facilitator.id;
}

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '';
  if (!name) throw new TrainingRuleError(400, 'Give the batch a name.');
  return name.slice(0, 80);
}

// ------------------------------------------------------------------------- batches

export function visibleBatches(person: SignedInPerson, batches: Batch[]): Batch[] {
  if (person.role === 'admin' || person.platform) return batches;
  return batches.filter((batch) => batch.facilitatorId === person.id);
}

export async function createBatch(
  person: SignedInPerson,
  input: { name?: unknown; facilitatorId?: unknown; participantIds?: unknown },
  options: Options = {},
): Promise<Batch> {
  refuseUnlessOrganiser(person);
  const now = (options.now ?? nowIso)();
  const batch: Batch = {
    id: newTrainingId('b'),
    name: cleanName(input.name),
    facilitatorId: await chosenFacilitator(person, input.facilitatorId),
    participantIds: await knownPeople(person, input.participantIds),
    createdBy: person.id,
    createdAt: now,
    updatedAt: now,
  };
  await trainingStore(person.orgId, options.store).saveBatch(batch);
  return batch;
}

export async function updateBatch(
  person: SignedInPerson,
  id: string,
  input: { name?: unknown; facilitatorId?: unknown; participantIds?: unknown },
  options: Options = {},
): Promise<Batch> {
  refuseUnlessOrganiser(person);
  const store = trainingStore(person.orgId, options.store);
  const batch = await store.getBatch(id);
  if (!batch || !visibleBatches(person, [batch]).length) {
    throw new TrainingRuleError(404, 'No such batch.');
  }
  // Everything that needs a read is worked out first, and only the fields that changed
  // are applied to the batch as it stands at the moment of writing, so an edit made in
  // between (somebody removed from the company, say) is not overwritten.
  const changes: Partial<Batch> = {
    ...(input.name !== undefined ? { name: cleanName(input.name) } : {}),
    ...(input.facilitatorId !== undefined && person.role !== 'facilitator'
      ? { facilitatorId: await chosenFacilitator(person, input.facilitatorId) }
      : {}),
    ...(input.participantIds !== undefined
      ? { participantIds: await knownPeople(person, input.participantIds) }
      : {}),
    updatedAt: (options.now ?? nowIso)(),
  };
  return store.updateBatch(id, (current) => {
    if (!current) throw new TrainingRuleError(404, 'No such batch.');
    return { ...current, ...changes };
  });
}

export async function removeBatch(
  person: SignedInPerson,
  id: string,
  options: Options = {},
): Promise<void> {
  refuseUnlessOrganiser(person);
  const store = trainingStore(person.orgId, options.store);
  const batch = await store.getBatch(id);
  if (!batch || !visibleBatches(person, [batch]).length) {
    throw new TrainingRuleError(404, 'No such batch.');
  }
  await store.removeBatch(id);
}

// ------------------------------------------------------------------------ sessions

export function visibleSessions(
  person: SignedInPerson,
  sessions: TrainingSession[],
): TrainingSession[] {
  return sessions.filter((session) => mayManageSession(person, session));
}

export async function createSession(
  person: SignedInPerson,
  input: {
    deckId?: unknown;
    facilitatorId?: unknown;
    batchId?: unknown;
    participantIds?: unknown;
    scheduledFor?: unknown;
  },
  options: Options = {},
): Promise<TrainingSession> {
  refuseUnlessOrganiser(person);
  const store = trainingStore(person.orgId, options.store);
  const decks = await listDecks(person.orgId);
  const deck = decks.find((entry) => entry.id === input.deckId);
  if (!deck) throw new TrainingRuleError(400, 'Choose a deck from this company.');
  // A session assigns its deck to everybody on it, below, so it is held to the same
  // approval as assigning one by one (AI-39), and asked before anything is written.
  const refusal = await assignmentRefusal(person.orgId, deck.id, { store: options.store });
  if (refusal) throw new TrainingRuleError(409, refusal);

  const facilitatorId = await chosenFacilitator(person, input.facilitatorId);

  let batchId: string | null = null;
  let participantIds = await knownPeople(person, input.participantIds);
  if (typeof input.batchId === 'string' && input.batchId) {
    const batch = await store.getBatch(input.batchId);
    if (!batch || !visibleBatches(person, [batch]).length) {
      throw new TrainingRuleError(400, 'That batch is not one you can use.');
    }
    batchId = batch.id;
    // Copied, so a later change to the batch does not rewrite who was listed.
    participantIds = [...new Set([...batch.participantIds, ...participantIds])];
  }
  if (participantIds.length === 0) {
    throw new TrainingRuleError(400, 'List at least one participant, or choose a batch.');
  }

  const scheduled =
    typeof input.scheduledFor === 'string' && !Number.isNaN(Date.parse(input.scheduledFor))
      ? new Date(input.scheduledFor).toISOString()
      : null;

  const now = (options.now ?? nowIso)();
  const session: TrainingSession = {
    id: newTrainingId('s'),
    deckId: deck.id,
    facilitatorId,
    batchId,
    participantIds,
    scheduledFor: scheduled,
    status: 'scheduled',
    attendance: {},
    createdBy: person.id,
    createdAt: now,
    openedAt: null,
    closedAt: null,
    closedBy: null,
  };
  await store.saveSession(session);

  // A participant needs the deck assigned to see it at all, and to do its
  // assessments and feedback on their own device.
  const roster = rosterStore(person.orgId);
  await Promise.all(
    participantIds.map(async (participantId) => {
      if (!(await roster.isAssigned(participantId, deck.id))) {
        await roster.assign({ personId: participantId, deckId: deck.id, assignedBy: person.id });
      }
    }),
  );
  return session;
}

export async function sessionFor(
  person: SignedInPerson,
  id: string,
  options: Options = {},
): Promise<TrainingSession> {
  const session = await trainingStore(person.orgId, options.store).getSession(id);
  if (!session || !mayManageSession(person, session)) {
    throw new TrainingRuleError(404, 'No such session.');
  }
  return session;
}

/**
 * Marks attendance, opens or closes a session.
 *
 * Only the facilitator, or an administrator, may close it, and a closed session stays
 * closed: its record is what reports and retention rely on. Closing asks for every
 * listed participant to be marked first, so an absence is a decision rather than an
 * omission.
 */
export async function changeSession(
  person: SignedInPerson,
  id: string,
  input: { attendance?: unknown; status?: unknown },
  options: Options = {},
): Promise<TrainingSession> {
  await sessionFor(person, id, options);
  const now = (options.now ?? nowIso)();
  return trainingStore(person.orgId, options.store).updateSession(id, (current) => {
    if (!current) throw new TrainingRuleError(404, 'No such session.');
    if (current.status === 'closed') {
      throw new TrainingRuleError(409, 'This session is closed and can no longer be changed.');
    }
    const attendance = { ...current.attendance };
    if (input.attendance && typeof input.attendance === 'object') {
      for (const [personId, mark] of Object.entries(input.attendance as Record<string, unknown>)) {
        if (!current.participantIds.includes(personId)) continue;
        if (mark === 'present' || mark === 'absent') attendance[personId] = mark as AttendanceMark;
      }
    }
    let next: TrainingSession = { ...current, attendance };
    if (input.status === 'open' && current.status === 'scheduled') {
      next = { ...next, status: 'open', openedAt: now };
    }
    if (input.status === 'closed') {
      const unmarked = current.participantIds.filter((participantId) => !attendance[participantId]);
      if (unmarked.length > 0) {
        throw new TrainingRuleError(
          409,
          `Mark ${unmarked.length === 1 ? 'one participant' : `${unmarked.length} participants`} present or absent before closing.`,
        );
      }
      // A session run in the room without ever handing over to the trainer was never
      // opened by the chat route, but it did take place: it is given its start now, so
      // nothing reads it as a session that never happened.
      next = {
        ...next,
        status: 'closed',
        openedAt: next.openedAt ?? now,
        closedAt: now,
        closedBy: person.id,
      };
    }
    return next;
  });
}

/**
 * Takes a removed person out of every batch and every session that has not happened.
 * A session that ran keeps them listed, because its attendance is a record (RUL-7).
 */
export async function removeFromTraining(
  person: SignedInPerson,
  personId: string,
  options: Options = {},
): Promise<void> {
  const store = trainingStore(person.orgId, options.store);
  const [batches, sessions] = await Promise.all([store.listBatches(), store.listSessions()]);
  const without = (ids: string[]) => ids.filter((id) => id !== personId);
  // Each one re-read and changed in a transaction, rather than a copy read above written
  // back: a session opened in between would otherwise go back to scheduled. One that has
  // started by then keeps them, as a session that ran always does. One deleted in between
  // is skipped.
  const gone = Symbol('gone');
  const quietly = (work: Promise<unknown>) =>
    work.catch((error: unknown) => {
      if (error !== gone) throw error;
    });
  await Promise.all([
    ...batches
      .filter((batch) => batch.participantIds.includes(personId))
      .map((batch) =>
        quietly(
          store.updateBatch(batch.id, (current) => {
            if (!current) throw gone;
            return { ...current, participantIds: without(current.participantIds) };
          }),
        ),
      ),
    ...sessions
      .filter(
        (session) => session.status === 'scheduled' && session.participantIds.includes(personId),
      )
      .map((session) =>
        quietly(
          store.updateSession(session.id, (current) => {
            if (!current) throw gone;
            if (current.status !== 'scheduled') return current;
            return { ...current, participantIds: without(current.participantIds) };
          }),
        ),
      ),
  ]);
}

export async function removeSession(
  person: SignedInPerson,
  id: string,
  options: Options = {},
): Promise<void> {
  refuseUnlessOrganiser(person);
  await sessionFor(person, id, options);
  const store = trainingStore(person.orgId, options.store);
  // Checked and marked in one transaction, so a first hand-over cannot open it between
  // the check and the delete: the chat route will not open a session marked cancelled.
  await store.updateSession(id, (current) => {
    if (!current) throw new TrainingRuleError(404, 'No such session.');
    if (current.status !== 'scheduled') {
      throw new TrainingRuleError(409, 'Only a session that has not started can be deleted.');
    }
    return { ...current, cancelledAt: (options.now ?? nowIso)() };
  });
  await store.removeSession(id);
}
