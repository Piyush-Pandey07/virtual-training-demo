/**
 * The rules for batches and trainer-led sessions, apart from the routes that call them.
 *
 * Kept here so the routes stay thin and the rules can be tested without a server:
 * who may create what, which participant ids are acceptable, and what a session's
 * status may move to. Everything takes the signed-in person and builds its stores from
 * their organisation, so nothing here can reach another customer.
 */

import 'server-only';

import { bandsOf, checkBands } from '../assessments/scoring';
import { assessmentStore } from '../assessments/store';
import { AUDIT_DETAIL_LENGTH, recordAudit } from '../audit/log';
import { assignmentRefusal } from '../decks/approval';
import { listDecks } from '../decks/registry';
import { notifySessionSetUp } from '../notifications/events';
import type { DocumentStore } from '../roster/documents';
import { rosterStore } from '../roster/registry';
import type { Person, SignedInPerson } from '../roster/types';
import { mayManageSession } from './access';
import { namesOf, refreshedNames } from './names';
import { newTrainingId, trainingStore } from './store';
import type { AttendanceMark, Batch, TrainingSession } from './types';
import { joinedLate, participantCount } from './words';

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

/**
 * The ids in a list that are real people in this company, in their given order, once.
 *
 * Reads the roster, unless the caller has already listed it and passes it in.
 */
async function knownPeople(
  person: SignedInPerson,
  ids: unknown,
  listed?: readonly Person[],
): Promise<string[]> {
  if (!Array.isArray(ids)) return [];
  const roster = listed ?? (await rosterStore(person.orgId).listPeople());
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

/**
 * How the audit history names somebody: by their email address, as every other entry
 * about a person does ("Added <email> by hand", "Changed <email> from trainee to
 * facilitator"). An account id means nothing to whoever reads the history (D-13).
 *
 * Somebody no longer on the roster, removed since, is named by their id, which is all
 * that is left of them here, rather than the entry, or the change it records, failing.
 */
function auditNames(people: readonly Person[]): (personId: string) => string {
  const emails = new Map(people.map((entry) => [entry.id, entry.email]));
  return (personId) => emails.get(personId) || personId;
}

/** How many people an audit entry names one by one. A larger number is counted instead. */
const NAMED_AT_MOST = 5;

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

/**
 * The people of the roster given whom the sessions board names for this viewer.
 *
 * An administrator sees the whole company. A facilitator sees only the people of the
 * sessions and batches they can see, never the whole company: everybody listed on them,
 * and whoever runs each, which for a facilitator's own is themselves. Without the
 * facilitators, every one of a facilitator's own sessions named its facilitator
 * "Unknown" (Issue 15).
 */
export function peopleOnBoard<P extends { id: string }>(
  person: SignedInPerson,
  sessions: TrainingSession[],
  batches: Batch[],
  people: readonly P[],
): P[] {
  if (person.platform || person.role === 'admin') return [...people];
  const named = new Set(
    [...visibleSessions(person, sessions), ...visibleBatches(person, batches)].flatMap((entry) =>
      entry.facilitatorId ? [entry.facilitatorId, ...entry.participantIds] : entry.participantIds,
    ),
  );
  return people.filter((entry) => named.has(entry.id));
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

  // Listed once, for both who may be on it and the names it keeps of them (D-20).
  const roster = await rosterStore(person.orgId).listPeople();
  let batchId: string | null = null;
  let participantIds = await knownPeople(person, input.participantIds, roster);
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

  // The deck's pre-session bands, or the defaults, as the session's own: a copy, so the
  // facilitator can change them for this group without changing them for the deck.
  const levelBands = bandsOf(
    await assessmentStore(person.orgId, options.store).getBank(deck.id, 'pre'),
  );

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
    levelBands,
    people: namesOf(roster, [facilitatorId, ...participantIds]),
  };
  await store.saveSession(session);

  // A participant needs the deck assigned to see it at all, and to do its
  // assessments and feedback on their own device.
  await assignDeck(person, deck.id, participantIds);
  // Technavious's training team is emailed about every session set up (AI-35). Never throws.
  await notifySessionSetUp(person, session, deck.title, { store: options.store });
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
 * Marks attendance, changes the level bands, opens, closes or cancels a session.
 *
 * Only the facilitator, or an administrator, may change it at all, and a closed session
 * stays closed: its record is what reports and retention rely on. The level bands may
 * only change while the session is still scheduled. Closing asks for every
 * listed participant to be marked first, so an absence is a decision rather than an
 * omission. A session that has not started may be cancelled instead, by the same
 * people; it is kept, shown as cancelled, and can never be opened.
 *
 * Each mark is timed when it changes, in the same write, so somebody marked present
 * after the session opened shows as having joined late (AI-26), and their pre-session
 * assessment closes at that moment and no earlier.
 */
export async function changeSession(
  person: SignedInPerson,
  id: string,
  input: { attendance?: unknown; status?: unknown; levelBands?: unknown },
  options: Options = {},
): Promise<TrainingSession> {
  await sessionFor(person, id, options);
  // Checked before the write, so bands that make no sense change nothing else either.
  let levelBands: TrainingSession['levelBands'];
  if (input.levelBands !== undefined) {
    const checked = checkBands(input.levelBands);
    if (!checked.ok) throw new TrainingRuleError(400, checked.error);
    levelBands = checked.bands;
  }
  const now = (options.now ?? nowIso)();
  // Closing refreshes the names the session keeps from the roster (D-20), so the record
  // names everybody as they were when it closed. Read before the write, since the change
  // inside it may run more than once and must not wait on a read, and a roster that cannot
  // be read leaves the names as they were kept rather than stopping the session closing.
  const roster =
    input.status === 'closed'
      ? await rosterStore(person.orgId)
          .listPeople()
          .catch(() => null)
      : null;
  // What this request changed, for the audit history. Worked out inside the write, so it
  // describes the session as it stood when the change was made.
  let marked: [string, AttendanceMark][] = [];
  let cancelled = false;
  const saved = await trainingStore(person.orgId, options.store).updateSession(id, (current) => {
    marked = [];
    cancelled = false;
    if (!current) throw new TrainingRuleError(404, 'No such session.');
    // The bands decide each participant's level and so how the trainer pitches the session
    // (AI-51). Once it has opened the trainer is already pitching to the room, and moving
    // the bands then would quietly regrade people part way through, so they are settled
    // beforehand. Checked first, so a closed or cancelled session gives the same reason.
    if (levelBands && current.status !== 'scheduled') {
      throw new TrainingRuleError(
        409,
        'Level bands are fixed once the session has started. Set them before it opens.',
      );
    }
    if (current.status === 'closed') {
      throw new TrainingRuleError(
        409,
        'This session is closed and can no longer be changed. A closed session cannot be reopened: set up a new one instead.',
      );
    }
    if (current.status === 'cancelled') {
      throw new TrainingRuleError(
        409,
        'This session was cancelled and can no longer be changed. To run it after all, set up a new one.',
      );
    }
    if (input.status === 'cancelled') {
      if (current.status !== 'scheduled') {
        throw new TrainingRuleError(409, 'Only a session that has not started can be cancelled.');
      }
      cancelled = true;
      return { ...current, status: 'cancelled', cancelledAt: now, cancelledBy: person.id };
    }
    const attendance = { ...current.attendance };
    const attendanceAt = { ...current.attendanceAt };
    if (input.attendance && typeof input.attendance === 'object') {
      for (const [personId, mark] of Object.entries(input.attendance as Record<string, unknown>)) {
        if (!current.participantIds.includes(personId)) continue;
        if (mark !== 'present' && mark !== 'absent') continue;
        // Marking somebody as they already are keeps the time they were first marked so,
        // or a second click on Present would make an on-time arrival late.
        if (attendance[personId] === mark) continue;
        attendance[personId] = mark;
        attendanceAt[personId] = now;
        marked.push([personId, mark]);
      }
    }
    let next: TrainingSession = {
      ...current,
      attendance,
      attendanceAt,
      ...(levelBands ? { levelBands } : {}),
    };
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
        ...(roster ? { people: refreshedNames(next, roster) } : {}),
      };
    }
    return next;
  });

  if (cancelled) {
    await recordAudit(
      person,
      {
        action: 'cancelled',
        subjectType: 'training-session',
        subjectId: id,
        detail: `Cancelled the session on ${saved.deckId} before it started`,
      },
      { store: options.store },
    );
  }
  if (marked.length > 0) {
    // One listing of the roster names everybody the entry names, rather than a read for
    // each, and none is made for a room that is only counted. The marks are saved by now,
    // so a roster that cannot be read leaves the ids in the entry rather than losing it.
    const people =
      marked.length <= NAMED_AT_MOST
        ? (roster ??
          (await rosterStore(person.orgId)
            .listPeople()
            .catch(() => [] as Person[])))
        : [];
    await recordAudit(
      person,
      {
        action: 'updated',
        subjectType: 'training-session',
        subjectId: id,
        detail: attendanceDetail(saved, marked, auditNames(people)),
      },
      { store: options.store },
    );
  }
  if (levelBands) {
    // They decide every participant's level for this session, and so how it is pitched.
    await recordAudit(
      person,
      {
        action: 'updated',
        subjectType: 'training-session',
        subjectId: id,
        detail: `Set the level bands: Intermediate from ${levelBands.intermediateFrom}%, Advanced from ${levelBands.advancedFrom}%`,
      },
      { store: options.store },
    );
  }
  return saved;
}

/**
 * The audit line for some attendance marks: names a few, and counts a whole room.
 *
 * A few long addresses can make the named line longer than an entry keeps. It is counted
 * then too, since an entry cut off part way through an address could name somebody else.
 */
function attendanceDetail(
  session: TrainingSession,
  marked: [string, AttendanceMark][],
  nameOf: (personId: string) => string,
): string {
  const word = (personId: string, mark: AttendanceMark) =>
    mark === 'present' && joinedLate(session, personId) ? 'present, joined late' : mark;
  if (marked.length <= NAMED_AT_MOST) {
    const named = `Marked ${marked.map(([personId, mark]) => `${nameOf(personId)} ${word(personId, mark)}`).join('; ')}`;
    if (named.length <= AUDIT_DETAIL_LENGTH) return named;
  }
  const present = marked.filter(([, mark]) => mark === 'present').length;
  return `Marked ${participantCount(marked.length)}: ${present} present, ${marked.length - present} absent`;
}

/** The highest slide a request may record: far beyond any deck, and a bound on what is kept. */
const HIGHEST_SLIDE = 1000;

/**
 * Keeps the slide the facilitator's run screen is on, so reopening the screen carries on
 * there (UAT issue 17). It used to start at slide 1 every time, on a reload, on coming back
 * from the attendance page, or on another device.
 *
 * Only the session's facilitator, or an administrator, may move it, as for every other
 * change to a session, and only while the session can still be run: a closed or cancelled
 * one has no run screen, and its record is left as it is.
 *
 * Written on the free Firestore plan, so it costs as little as it can. The run screen
 * sends a move only once it has settled (see run-position.ts), so a run of Next presses is
 * one write rather than one each. Here the check and the write are one transaction, one
 * read and at most one write, and a slide the record already holds writes nothing: the
 * change gives up before the write, as `removeFromTraining` does for a session gone.
 *
 * The slide is not checked against the deck. That would read the deck on every move, and
 * the run page reads the deck anyway and starts at the first slide when the one kept is no
 * longer in it.
 */
export async function recordCurrentSlide(
  person: SignedInPerson,
  id: string,
  slideId: unknown,
  options: Options = {},
): Promise<number> {
  if (
    typeof slideId !== 'number' ||
    !Number.isInteger(slideId) ||
    slideId < 1 ||
    slideId > HIGHEST_SLIDE
  ) {
    throw new TrainingRuleError(400, 'Name the slide by its number.');
  }
  const unchanged = Symbol('unchanged');
  try {
    await trainingStore(person.orgId, options.store).updateSession(id, (current) => {
      // The same answer for a session that does not exist and one this person may not run,
      // as `sessionFor` gives, so a facilitator cannot learn of another's.
      if (!current || !mayManageSession(person, current)) {
        throw new TrainingRuleError(404, 'No such session.');
      }
      if (current.status === 'closed') {
        throw new TrainingRuleError(409, 'This session is closed and can no longer be run.');
      }
      if (current.status === 'cancelled') {
        throw new TrainingRuleError(409, 'This session was cancelled and can never be run.');
      }
      if (current.currentSlideId === slideId) throw unchanged;
      return { ...current, currentSlideId: slideId };
    });
  } catch (error) {
    if (error !== unchanged) throw error;
  }
  return slideId;
}

/**
 * Adds participants to a session that has not finished (AI-26).
 *
 * Somebody who turns up on the day without being listed can still be let in: an
 * administrator lists them, which assigns them the deck exactly as setting the session
 * up does, approval check included, and they then do their profile and pre-session
 * assessment on their own device before being marked present. Nobody is taken off a
 * session this way: a listed participant is part of its record.
 */
export async function addParticipants(
  person: SignedInPerson,
  id: string,
  input: { participantIds?: unknown },
  options: Options = {},
): Promise<TrainingSession> {
  refuseUnlessOrganiser(person);
  const session = await sessionFor(person, id, options);
  if (session.status === 'closed' || session.status === 'cancelled') {
    throw new TrainingRuleError(
      409,
      session.status === 'closed'
        ? 'This session is closed, so nobody can be added. Set up a new one instead.'
        : 'This session was cancelled, so nobody can be added. Set up a new one instead.',
    );
  }
  // Listed once, for both whom to add and how the audit history names them.
  const people = await rosterStore(person.orgId).listPeople();
  const wanted = await knownPeople(person, input.participantIds, people);
  if (wanted.length === 0) throw new TrainingRuleError(400, 'Choose somebody to add.');
  const refusal = await assignmentRefusal(person.orgId, session.deckId, { store: options.store });
  if (refusal) throw new TrainingRuleError(409, refusal);

  let added: string[] = [];
  const saved = await trainingStore(person.orgId, options.store).updateSession(id, (current) => {
    if (!current) throw new TrainingRuleError(404, 'No such session.');
    if (current.status === 'closed' || current.status === 'cancelled') {
      throw new TrainingRuleError(409, 'This session has finished, so nobody can be added.');
    }
    added = wanted.filter((personId) => !current.participantIds.includes(personId));
    return {
      ...current,
      participantIds: [...current.participantIds, ...added],
      // Their names kept with the record from now on, as setting it up keeps them (D-20).
      people: { ...current.people, ...namesOf(people, added) },
    };
  });

  await assignDeck(person, saved.deckId, added);
  if (added.length > 0) {
    await recordAudit(
      person,
      {
        action: 'updated',
        subjectType: 'training-session',
        subjectId: id,
        detail: `Added ${added.length <= NAMED_AT_MOST ? added.map(auditNames(people)).join(', ') : participantCount(added.length)} to the session${saved.status === 'open' ? ' after it started' : ''}`,
      },
      { store: options.store },
    );
  }
  return saved;
}

/**
 * Assigns a deck to everybody listed who does not have it yet, so each can see it and
 * do its assessments and feedback on their own device. A few at a time, so a group of
 * any size is not a burst of hundreds of writes at once.
 */
async function assignDeck(person: SignedInPerson, deckId: string, participantIds: string[]) {
  const roster = rosterStore(person.orgId);
  for (let at = 0; at < participantIds.length; at += ASSIGN_AT_ONCE) {
    await Promise.all(
      participantIds.slice(at, at + ASSIGN_AT_ONCE).map(async (participantId) => {
        if (!(await roster.isAssigned(participantId, deckId))) {
          await roster.assign({ personId: participantId, deckId, assignedBy: person.id });
        }
      }),
    );
  }
}

const ASSIGN_AT_ONCE = 10;

/** A copy of a map keyed by person id without one person's entry. */
function withoutKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  const rest = { ...map };
  delete rest[key];
  return rest;
}

/** A session that has not happened, and never will have once it is cancelled. */
const notHeld = (status: TrainingSession['status']) =>
  status === 'scheduled' || status === 'cancelled';

/**
 * Takes a removed person out of every batch and every session that has not happened,
 * cancelled ones included, which nobody attended. A session that ran keeps them listed,
 * because its attendance is a record (RUL-7).
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
      .filter((session) => notHeld(session.status) && session.participantIds.includes(personId))
      .map((session) =>
        quietly(
          store.updateSession(session.id, (current) => {
            if (!current) throw gone;
            if (!notHeld(current.status)) return current;
            return {
              ...current,
              participantIds: without(current.participantIds),
              // No longer on it, so it has no reason to keep their name either, unless
              // they also run it.
              ...(current.people && current.facilitatorId !== personId
                ? { people: withoutKey(current.people, personId) }
                : {}),
            };
          }),
        ),
      ),
  ]);
}

/**
 * Deletes a session that never happened, for an administrator clearing up a mistake.
 *
 * Not offered on the screens, which cancel instead and so keep the record. A session
 * that started is never deleted: its attendance is a record (RUL-7).
 */
export async function removeSession(
  person: SignedInPerson,
  id: string,
  options: Options = {},
): Promise<void> {
  refuseUnlessOrganiser(person);
  await sessionFor(person, id, options);
  const store = trainingStore(person.orgId, options.store);
  const now = (options.now ?? nowIso)();
  // Checked and cancelled in one transaction, so a first hand-over cannot open it
  // between the check and the delete: the chat route opens only a scheduled session.
  const doomed = await store.updateSession(id, (current) => {
    if (!current) throw new TrainingRuleError(404, 'No such session.');
    if (!notHeld(current.status)) {
      throw new TrainingRuleError(409, 'Only a session that has not started can be deleted.');
    }
    return current.status === 'cancelled'
      ? current
      : { ...current, status: 'cancelled', cancelledAt: now, cancelledBy: person.id };
  });
  await store.removeSession(id);
  await recordAudit(
    person,
    {
      action: 'deleted',
      subjectType: 'training-session',
      subjectId: id,
      detail: `Deleted the session on ${doomed.deckId}, which never started`,
    },
    { store: options.store },
  );
}
