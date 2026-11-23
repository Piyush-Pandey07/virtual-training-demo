/**
 * Carrying somebody's place in trainer-led sessions and batches to a new id (D-18).
 *
 * An administrator can list somebody who has never signed in. The roster gives them a
 * placeholder id then (`localPersonId`), and at their first sign-in replaces it with the
 * uid Firebase gave them, moving their assignments and attempts with it. Sessions and
 * batches are kept in another store and name people by id, and nothing moved them, so
 * they went on naming the placeholder: the participant no longer found the session on
 * their home page, and a facilitator added that way no longer found the sessions and
 * batches they run.
 *
 * So every session and batch that names the old id is rewritten to the new one: the
 * list, the facilitator, the attendance marks and their times, the names the session
 * keeps, and who set it up, closed or cancelled it. Each is re-read and rewritten inside
 * the store's transactional update, so a facilitator marking attendance at that moment
 * is not overwritten by a copy read a little earlier.
 *
 * `upsertPersonWithTraining` is the only way the sign-in routes write somebody to the
 * roster, so neither of them can adopt a uid without carrying the person's training
 * across with it. The repair script, `scripts/repair-placeholder-ids.ts`, uses the same
 * rewriting for anything left behind before this existed, or by a carry that failed.
 */

import 'server-only';

import type { DocumentStore } from '../roster/documents';
import type { PersonInput, RosterStore } from '../roster/store';
import type { Person } from '../roster/types';
import { trainingStore } from './store';
import type { Batch, TrainingSession } from './types';

/** Whether a session names this id anywhere: listed, running it, marked, timed or kept. */
export function sessionNames(session: TrainingSession, id: string): boolean {
  return (
    session.participantIds.includes(id) ||
    session.facilitatorId === id ||
    Object.hasOwn(session.attendance ?? {}, id) ||
    Object.hasOwn(session.attendanceAt ?? {}, id) ||
    Object.hasOwn(session.people ?? {}, id) ||
    session.createdBy === id ||
    session.closedBy === id ||
    session.cancelledBy === id
  );
}

/** Whether a batch names this id: listed, running it, or having set it up. */
export function batchNames(batch: Batch, id: string): boolean {
  return batch.participantIds.includes(id) || batch.facilitatorId === id || batch.createdBy === id;
}

/** A list of ids with one replaced, each id still listed once and in its place. */
function swapped(ids: readonly string[], from: string, to: string): string[] {
  return [...new Set(ids.map((id) => (id === from ? to : id)))];
}

const renamed = (id: string, from: string, to: string) => (id === from ? to : id);

/**
 * A map keyed by person id with the old key's entry moved to the new key. When the new key
 * already has an entry it is kept, unless `replace` says otherwise, and the old one dropped.
 */
function moved<T>(
  map: Record<string, T> | undefined,
  from: string,
  to: string,
  replace = false,
): Record<string, T> | undefined {
  if (!map || !Object.hasOwn(map, from)) return map;
  const { [from]: entry, ...rest } = map;
  return !replace && Object.hasOwn(rest, to) ? rest : { ...rest, [to]: entry as T };
}

/**
 * The session as it would be had it named the new id all along.
 *
 * Both ids can be on it only if somebody listed the person again under their real id
 * after a carry was missed. They are then listed once, and a mark already made under the
 * real id is kept with its time, since it was made after they signed in, by somebody who
 * could see them as they are; otherwise the mark and its time come across together.
 */
export function renamedSession(
  session: TrainingSession,
  from: string,
  to: string,
): TrainingSession {
  if (from === to) return session;
  const markedAlready = Object.hasOwn(session.attendance ?? {}, to);
  const next: TrainingSession = {
    ...session,
    participantIds: swapped(session.participantIds, from, to),
    facilitatorId: renamed(session.facilitatorId, from, to),
    attendance: moved(session.attendance ?? {}, from, to, !markedAlready) ?? {},
    createdBy: renamed(session.createdBy, from, to),
    closedBy: session.closedBy === null ? null : renamed(session.closedBy, from, to),
  };
  const times = session.attendanceAt;
  if (times && Object.hasOwn(times, from)) {
    const { [from]: time, ...rest } = times;
    next.attendanceAt = markedAlready ? rest : { ...rest, [to]: time as string };
  }
  const people = moved(session.people, from, to);
  if (people) next.people = people;
  if (session.cancelledBy !== undefined) next.cancelledBy = renamed(session.cancelledBy, from, to);
  return next;
}

/** The batch as it would be had it named the new id all along. */
export function renamedBatch(batch: Batch, from: string, to: string): Batch {
  if (from === to) return batch;
  return {
    ...batch,
    participantIds: swapped(batch.participantIds, from, to),
    facilitatorId: batch.facilitatorId === null ? null : renamed(batch.facilitatorId, from, to),
    createdBy: renamed(batch.createdBy, from, to),
  };
}

/** The sessions and batches a carry rewrote, by id. */
export interface Carried {
  sessions: string[];
  batches: string[];
}

/**
 * Rewrites every session and batch of this organisation that names `from` to name `to`.
 *
 * Idempotent: run again, it finds nothing naming the old id and writes nothing. One that
 * was deleted in between is skipped. Every rewrite is tried even if one fails, and then
 * the failure is thrown, so as much as possible is carried and the caller still learns
 * that something was not.
 */
export async function carryTrainingRecords(
  orgId: string,
  from: string,
  to: string,
  options: { store?: DocumentStore } = {},
): Promise<Carried> {
  const carried: Carried = { sessions: [], batches: [] };
  if (from === to) return carried;
  const store = trainingStore(orgId, options.store);
  const [batches, sessions] = await Promise.all([store.listBatches(), store.listSessions()]);

  const gone = Symbol('gone');
  const outcomes = await Promise.allSettled([
    ...batches
      .filter((batch) => batchNames(batch, from))
      .map(async (batch) => {
        await store.updateBatch(batch.id, (current) => {
          if (!current) throw gone;
          return renamedBatch(current, from, to);
        });
        carried.batches.push(batch.id);
      }),
    ...sessions
      .filter((session) => sessionNames(session, from))
      .map(async (session) => {
        await store.updateSession(session.id, (current) => {
          if (!current) throw gone;
          return renamedSession(current, from, to);
        });
        carried.sessions.push(session.id);
      }),
  ]);

  const failed = outcomes.filter(
    (outcome): outcome is PromiseRejectedResult =>
      outcome.status === 'rejected' && outcome.reason !== gone,
  );
  if (failed.length > 0) {
    const first = failed[0]!.reason as Error | undefined;
    throw new Error(
      `${failed.length} ${failed.length === 1 ? 'session or batch' : 'sessions or batches'} could not be rewritten: ${first?.message ?? String(first)}`,
      { cause: first },
    );
  }
  return carried;
}

/**
 * Writes somebody to the roster under the id they have just been given, and when that
 * moves them off another id, carries their sessions and batches across with them.
 *
 * The roster does not say when an upsert was a move, so who they were is read first, by
 * address, as the roster itself finds them. Two sign-ins at the same moment may both see
 * the old id and both carry, and the second then finds nothing left naming it.
 *
 * The carrying is best effort and never fails the sign-in. Somebody who cannot get in at
 * all is worse off than somebody missing from a session list, which the repair script
 * puts right; a failure is logged so that it is known about, as the sign-in route's other
 * best-effort steps are.
 */
export async function upsertPersonWithTraining(
  roster: RosterStore,
  orgId: string,
  input: PersonInput & { id: string },
  options: { store?: DocumentStore } = {},
): Promise<Person> {
  const failed = (what: string) => (error: unknown) => {
    console.error(
      `[training] could not ${what} for ${input.id} in "${orgId}": ${(error as Error)?.message ?? error}`,
    );
    return undefined;
  };
  const before = await roster
    .getPersonByEmail(input.email)
    .catch(failed('look up the id sessions and batches name'));
  const person = await roster.upsertPerson(input);
  if (before && before.id !== person.id) {
    await carryTrainingRecords(orgId, before.id, person.id, options).catch(
      failed('carry sessions and batches to their new id'),
    );
  }
  return person;
}
