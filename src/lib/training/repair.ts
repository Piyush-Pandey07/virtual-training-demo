/**
 * Putting right what D-18 and D-20 left in one organisation's sessions and batches before
 * they were fixed. Run by `scripts/repair-placeholder-ids.ts`, and kept here so the tests
 * can drive it against the in-memory store.
 *
 * Two repairs, worked out together for each session and batch:
 *
 * - **Placeholder ids (D-18).** Somebody listed before they had ever signed in was listed
 *   under a placeholder id, `localPersonId(email)`, and signing in moved them on the
 *   roster to their real id without moving the sessions and batches. The placeholder is
 *   worked out again from the address they are on the roster with now, and anything still
 *   naming it is rewritten to their real id, exactly as signing in now does. Somebody who
 *   has been removed since is found by the address on their leaver record, and is then
 *   also taken off any batch, and any session that has not happened, as removing them
 *   would have done had it found them there.
 * - **Kept names (D-20).** A session set up before sessions kept names keeps none. It is
 *   given the name and address of everybody on it that the roster still has, or, for
 *   somebody who has left, that their leaver record still has. The retention job erases a
 *   leaver's entry on the day it deletes their leaver record, so nothing is kept for longer
 *   than it already was.
 *
 * A placeholder is left alone, and reported, when it cannot be told whose it is: when two
 * people's addresses give the same one, or when somebody was removed under that very id
 * before ever signing in. One that somebody on the roster still has is simply in use.
 *
 * Everything is read first and what would change is reported. Writing is asked for
 * separately, and each session or batch is then re-read and repaired in a transaction, so
 * one changed in between is repaired as it then stands. Run again, it finds nothing to do.
 */

import 'server-only';

import type { DocumentStore } from '../roster/documents';
import { leaverDocuments, LEAVERS, type LeaverRecord } from '../roster/leavers';
import { rosterStore } from '../roster/registry';
import { localPersonId, type RosterStore } from '../roster/store';
import { batchNames, renamedBatch, renamedSession, sessionNames } from './carry';
import { namedOn, namesOf } from './names';
import { trainingStore } from './store';
import type { Batch, TrainingSession } from './types';

/** Whose a placeholder id is now. */
interface Owner {
  id: string;
  email: string;
  /** Removed from the roster since, and known only from their leaver record. */
  left: boolean;
}

/** One session or batch the repair changes, or would change. */
export interface RepairLine {
  kind: 'session' | 'batch';
  id: string;
  /** Enough to find it on the screens: a session's status and date, a batch's name. */
  label: string;
  changes: string[];
  /** Why it could not be written, when the repair was applied and this one failed. */
  failed?: string;
}

export interface OrgRepair {
  orgId: string;
  applied: boolean;
  lines: RepairLine[];
  /** Placeholders still named somewhere but left alone, each with the reason. */
  leftAlone: { placeholder: string; reason: string }[];
}

export interface RepairOptions {
  /** Write the repairs. Without it nothing is written. */
  apply?: boolean;
  /** The document store underneath, before it is scoped. For the tests. */
  store?: DocumentStore;
  /** The organisation's roster. For the tests. */
  roster?: RosterStore;
}

/** A session that has not happened, and never will once cancelled, as removing somebody has it. */
const notHeld = (status: TrainingSession['status']) =>
  status === 'scheduled' || status === 'cancelled';

function withoutKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  const rest = { ...map };
  delete rest[key];
  return rest;
}

export async function repairOrg(orgId: string, options: RepairOptions = {}): Promise<OrgRepair> {
  const roster = options.roster ?? rosterStore(orgId);
  const training = trainingStore(orgId, options.store);
  const [people, leavers, sessions, batches] = await Promise.all([
    roster.listPeople(),
    leaverDocuments(orgId, options.store).all<LeaverRecord>(LEAVERS),
    training.listSessions(),
    training.listBatches(),
  ]);

  // Whose each placeholder is now, worked out from the address it was made from.
  const onRoster = new Set(people.map((person) => person.id));
  const leftUnder = new Set(leavers.map((leaver) => leaver.personId));
  const claims = new Map<string, Map<string, Owner>>();
  const claim = (owner: Owner) => {
    const placeholder = localPersonId(owner.email);
    // Their own id, so never a placeholder of theirs; or somebody else's, in use.
    if (placeholder === owner.id || onRoster.has(placeholder)) return;
    const claimed = claims.get(placeholder) ?? new Map<string, Owner>();
    claimed.set(owner.id, owner);
    claims.set(placeholder, claimed);
  };
  for (const person of people) claim({ id: person.id, email: person.email, left: false });
  for (const leaver of leavers) {
    if (!onRoster.has(leaver.personId)) {
      claim({ id: leaver.personId, email: leaver.email, left: true });
    }
  }
  const owners = new Map<string, Owner>();
  const unclear = new Map<string, string>();
  for (const [placeholder, claimed] of claims) {
    if (claimed.size > 1) {
      unclear.set(placeholder, `${claimed.size} people's addresses give this placeholder`);
    } else if (leftUnder.has(placeholder)) {
      unclear.set(placeholder, 'somebody was removed under this id before ever signing in');
    } else {
      owners.set(placeholder, [...claimed.values()][0]!);
    }
  }

  // The names a session can keep: the roster's, and a leaver's from their leaver record.
  // The roster comes last, so it is the one that counts should both have somebody.
  const named = [
    ...leavers
      .filter((leaver) => !onRoster.has(leaver.personId))
      .map((leaver) => ({ id: leaver.personId, name: leaver.name, email: leaver.email })),
    ...people,
  ];

  // Pure functions of what they are given and the maps above, since a transaction may
  // run them more than once.
  const repairSession = (session: TrainingSession) => {
    let next = session;
    const changes: string[] = [];
    for (const [placeholder, owner] of owners) {
      if (!sessionNames(next, placeholder)) continue;
      next = renamedSession(next, placeholder, owner.id);
      changes.push(`${placeholder} is now ${owner.id} (${owner.email})`);
      if (owner.left && notHeld(next.status) && next.participantIds.includes(owner.id)) {
        next = {
          ...next,
          participantIds: next.participantIds.filter((id) => id !== owner.id),
          ...(next.people && next.facilitatorId !== owner.id
            ? { people: withoutKey(next.people, owner.id) }
            : {}),
        };
        changes.push(`took ${owner.email} off it: they have left and it has not happened`);
      }
    }
    const missing = namedOn(next).filter((id) => !next.people?.[id]);
    const found = namesOf(named, missing);
    const count = Object.keys(found).length;
    if (count > 0) {
      next = { ...next, people: { ...next.people, ...found } };
      changes.push(`keeps the names of ${count} more ${count === 1 ? 'person' : 'people'}`);
    }
    return { next, changes };
  };

  const repairBatch = (batch: Batch) => {
    let next = batch;
    const changes: string[] = [];
    for (const [placeholder, owner] of owners) {
      if (!batchNames(next, placeholder)) continue;
      next = renamedBatch(next, placeholder, owner.id);
      changes.push(`${placeholder} is now ${owner.id} (${owner.email})`);
      if (owner.left && next.participantIds.includes(owner.id)) {
        next = { ...next, participantIds: next.participantIds.filter((id) => id !== owner.id) };
        changes.push(`took ${owner.email} off it: they have left`);
      }
    }
    return { next, changes };
  };

  const lines: RepairLine[] = [];
  const gone = Symbol('gone');
  const failure = (error: unknown) =>
    error === gone ? 'deleted since it was read' : ((error as Error)?.message ?? String(error));

  for (const session of sessions) {
    const { changes } = repairSession(session);
    if (changes.length === 0) continue;
    const when = session.scheduledFor ?? session.createdAt;
    const line: RepairLine = {
      kind: 'session',
      id: session.id,
      label: `${session.status}, ${when.slice(0, 10)}`,
      changes,
    };
    lines.push(line);
    if (!options.apply) continue;
    await training
      .updateSession(session.id, (current) => {
        if (!current) throw gone;
        return repairSession(current).next;
      })
      .catch((error: unknown) => {
        line.failed = failure(error);
      });
  }

  for (const batch of batches) {
    const { changes } = repairBatch(batch);
    if (changes.length === 0) continue;
    const line: RepairLine = { kind: 'batch', id: batch.id, label: batch.name, changes };
    lines.push(line);
    if (!options.apply) continue;
    await training
      .updateBatch(batch.id, (current) => {
        if (!current) throw gone;
        return repairBatch(current).next;
      })
      .catch((error: unknown) => {
        line.failed = failure(error);
      });
  }

  // Only the unclear placeholders something still names are worth anybody's attention.
  const leftAlone = [...unclear]
    .filter(
      ([placeholder]) =>
        sessions.some((session) => sessionNames(session, placeholder)) ||
        batches.some((batch) => batchNames(batch, placeholder)),
    )
    .map(([placeholder, reason]) => ({ placeholder, reason }));

  return { orgId, applied: options.apply === true, lines, leftAlone };
}
