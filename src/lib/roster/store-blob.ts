/**
 * The roster in Vercel Blob, which is what a deployment actually has.
 *
 * A database would be better and the plan says so. This exists because the
 * alternative on Vercel today is `NoRosterStore`, which refuses everything: no
 * accounts, no assignments, no progress, and therefore no way for anybody to sign in
 * at all. Working storage with a known limit beats correct storage that is not there.
 *
 * The layout is chosen around what gets written, not around what is tidy:
 *
 *   roster/people.json                        one document
 *   roster/assignments.json                   one document
 *   roster/attempts/{personId}/{deckId}.json  one object per attempt
 *
 * The first three change rarely — somebody joins, somebody is assigned a deck — so a
 * read-modify-write of a whole document is fine for them. Attempts are the opposite:
 * written once per slide, by every trainee at once, all through a session. Keeping
 * one object each means two people attending different decks, or the same deck, never
 * touch the same object and cannot lose each other's writes.
 *
 * The limit that remains, stated plainly: the same person with the same deck open in
 * two tabs can still lose a slide, and two administrators assigning at the same
 * instant can lose one assignment. Neither is silent — the trainee's percentage is
 * visibly short and the assignment is visibly missing — and both are fixed by doing
 * it again. A database removes them; until there is one, this is the trade.
 *
 * Nothing here ever calls `list()` on a read path. Listing a blob prefix is a
 * control-plane call that does not run in the store's region and cost about 750ms
 * flat when the deck store was measured, which is why an attempt is addressed by a
 * pathname built from ids the caller already holds.
 */

import 'server-only';

import { coverageOf, isComplete } from './completion';
import {
  assertUsablePersonId,
  emailKeyOf,
  localPersonId,
  RosterStoreError,
  withCovered,
  type AssignmentInput,
  type PersonInput,
  type ProgressInput,
  type RosterStore,
} from './store';
import type { Assignment, Attempt, Person, Role } from './types';
import type { BlobClient } from '../decks/store-blob';

const ROOT = 'roster';
const PEOPLE = `${ROOT}/people.json`;
const ASSIGNMENTS = `${ROOT}/assignments.json`;

/** Deck ids and person ids are both constrained, so this cannot escape the prefix. */
function attemptKey(personId: string, deckId: string): string {
  assertUsablePersonId(personId);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(deckId)) {
    throw new RosterStoreError(`"${deckId}" is not a usable deck id.`);
  }
  return `${ROOT}/attempts/${personId}/${deckId}.json`;
}

export class BlobRosterStore implements RosterStore {
  readonly kind = 'blob' as const;
  readonly writable = true;

  constructor(private readonly client: BlobClient) {}

  private async readList<T>(pathname: string): Promise<T[]> {
    const text = await this.client.read(pathname);
    if (text === null) return [];
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      // A document that will not parse is a real problem and must not be quietly
      // replaced with an empty one, which would look like everybody having vanished.
      throw new RosterStoreError(`${pathname} is stored but not readable as JSON.`);
    }
  }

  private async writeList<T>(pathname: string, rows: T[]): Promise<void> {
    await this.client.put(pathname, JSON.stringify(rows, null, 2));
  }

  private async updateList<T, R>(pathname: string, change: (rows: T[]) => R): Promise<R> {
    const rows = await this.readList<T>(pathname);
    const result = change(rows);
    await this.writeList(pathname, rows);
    return result;
  }

  // ------------------------------------------------------------------- people

  async listPeople(): Promise<Person[]> {
    const people = await this.readList<Person>(PEOPLE);
    return [...people].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }

  async getPerson(id: string): Promise<Person | undefined> {
    return (await this.readList<Person>(PEOPLE)).find((person) => person.id === id);
  }

  async getPersonByEmail(email: string): Promise<Person | undefined> {
    const key = emailKeyOf(email);
    return (await this.readList<Person>(PEOPLE)).find((person) => person.emailKey === key);
  }

  async upsertPerson(input: PersonInput): Promise<Person> {
    const email = input.email.trim();
    if (!email) throw new RosterStoreError('A person needs an email address.');
    const emailKey = emailKeyOf(email);
    const now = new Date().toISOString();

    const [assignments, attemptsMoved] = [
      await this.readList<Assignment>(ASSIGNMENTS),
      [] as Array<{ from: string; to: string; deckId: string }>,
    ];

    const person = await this.updateList<Person, Person>(PEOPLE, (people) => {
      const existing = people.find((entry) => entry.emailKey === emailKey);

      if (existing) {
        // An id arriving for somebody added by hand is the moment they first signed
        // in. Adopt it, and note what has to follow them across.
        if (input.id && input.id !== existing.id) {
          assertUsablePersonId(input.id);
          const previous = existing.id;
          existing.id = input.id;
          for (const row of assignments) {
            if (row.personId === previous) {
              attemptsMoved.push({ from: previous, to: input.id, deckId: row.deckId });
              row.personId = input.id;
            }
          }
        }
        existing.email = email;
        if (input.name) existing.name = input.name;
        // Role is never taken from the caller here, so a sign-in cannot restore a
        // role an administrator has just removed.
        existing.lastSeenAt = now;
        return { ...existing };
      }

      const id = input.id ?? localPersonId(email);
      assertUsablePersonId(id);
      const made: Person = {
        id,
        email,
        emailKey,
        name: input.name ?? '',
        role: input.role ?? 'trainee',
        createdAt: now,
        lastSeenAt: input.id ? now : null,
      };
      people.push(made);
      return { ...made };
    });

    if (attemptsMoved.length > 0) {
      await this.writeList(ASSIGNMENTS, assignments);
      for (const move of attemptsMoved) {
        const attempt = await this.readAttempt(move.from, move.deckId);
        if (!attempt) continue;
        await this.client.put(
          attemptKey(move.to, move.deckId),
          JSON.stringify({ ...attempt, personId: move.to }, null, 2),
        );
      }
    }

    return person;
  }

  async setRole(id: string, role: Role): Promise<Person> {
    return this.updateList<Person, Person>(PEOPLE, (people) => {
      const person = people.find((entry) => entry.id === id);
      if (!person) throw new RosterStoreError(`No such person: ${id}`);
      person.role = role;
      return { ...person };
    });
  }

  async removePerson(id: string): Promise<void> {
    const assignments = await this.readList<Assignment>(ASSIGNMENTS);
    const theirs = assignments.filter((row) => row.personId === id);

    await this.updateList<Person, void>(PEOPLE, (people) => {
      const at = people.findIndex((person) => person.id === id);
      if (at >= 0) people.splice(at, 1);
    });
    await this.writeList(
      ASSIGNMENTS,
      assignments.filter((row) => row.personId !== id),
    );

    // Their attempts go too, one object each.
    const urls = await this.client.list(`${ROOT}/attempts/${id}/`);
    if (urls.length > 0) await this.client.remove(urls.map((entry) => entry.url));
    void theirs;
  }

  // -------------------------------------------------------------- assignments

  async listAssignmentsForPerson(personId: string): Promise<Assignment[]> {
    return (await this.readList<Assignment>(ASSIGNMENTS)).filter(
      (row) => row.personId === personId,
    );
  }

  async listAssignmentsForDeck(deckId: string): Promise<Assignment[]> {
    return (await this.readList<Assignment>(ASSIGNMENTS)).filter((row) => row.deckId === deckId);
  }

  async isAssigned(personId: string, deckId: string): Promise<boolean> {
    return (await this.readList<Assignment>(ASSIGNMENTS)).some(
      (row) => row.personId === personId && row.deckId === deckId,
    );
  }

  async assign(input: AssignmentInput): Promise<Assignment> {
    return this.updateList<Assignment, Assignment>(ASSIGNMENTS, (rows) => {
      const existing = rows.find(
        (row) => row.personId === input.personId && row.deckId === input.deckId,
      );
      if (existing) {
        // Re-assigning changes the due date and nothing else: who first asked, and
        // when, is the record of the instruction.
        if (input.dueAt !== undefined) existing.dueAt = input.dueAt;
        return { ...existing };
      }

      const made: Assignment = {
        personId: input.personId,
        deckId: input.deckId,
        assignedBy: input.assignedBy,
        assignedAt: new Date().toISOString(),
        dueAt: input.dueAt ?? null,
      };
      rows.push(made);
      return { ...made };
    });
  }

  async unassign(personId: string, deckId: string): Promise<void> {
    // The attempt stays: somebody who did the training and then had it unassigned
    // still did the training.
    await this.updateList<Assignment, void>(ASSIGNMENTS, (rows) => {
      const at = rows.findIndex((row) => row.personId === personId && row.deckId === deckId);
      if (at >= 0) rows.splice(at, 1);
    });
  }

  // ----------------------------------------------------------------- attempts

  private async readAttempt(personId: string, deckId: string): Promise<Attempt | undefined> {
    const text = await this.client.read(attemptKey(personId, deckId));
    if (text === null) return undefined;
    try {
      return JSON.parse(text) as Attempt;
    } catch {
      return undefined;
    }
  }

  private async writeAttempt(attempt: Attempt): Promise<void> {
    await this.client.put(
      attemptKey(attempt.personId, attempt.deckId),
      JSON.stringify(attempt, null, 2),
    );
  }

  async getAttempt(personId: string, deckId: string): Promise<Attempt | undefined> {
    return this.readAttempt(personId, deckId);
  }

  /**
   * Read by pathname from the assignments, never by listing.
   *
   * The ids are already known — somebody's assignments say which decks to look for —
   * so the slow control-plane listing is never on a page a trainee opens.
   */
  async listAttemptsForPerson(personId: string): Promise<Attempt[]> {
    const assignments = await this.listAssignmentsForPerson(personId);
    const found = await Promise.all(
      assignments.map((row) => this.readAttempt(personId, row.deckId)),
    );
    return found.filter((attempt): attempt is Attempt => attempt !== undefined);
  }

  async listAttemptsForDeck(deckId: string): Promise<Attempt[]> {
    const assignments = await this.listAssignmentsForDeck(deckId);
    const found = await Promise.all(
      assignments.map((row) => this.readAttempt(row.personId, deckId)),
    );
    return found.filter((attempt): attempt is Attempt => attempt !== undefined);
  }

  async touchAttempt(input: Omit<ProgressInput, 'slideId' | 'targetSeconds'>): Promise<Attempt> {
    const attempt = (await this.readAttempt(input.personId, input.deckId)) ?? blank(input);
    attempt.lastSeenAt = new Date().toISOString();
    await this.writeAttempt(attempt);
    return attempt;
  }

  async recordCovered(input: ProgressInput): Promise<Attempt> {
    const now = new Date().toISOString();
    const attempt = (await this.readAttempt(input.personId, input.deckId)) ?? blank(input);

    attempt.covered = withCovered(attempt.covered, {
      slideId: input.slideId,
      targetSeconds: input.targetSeconds,
      coveredAt: now,
    });
    attempt.lastSlideId = input.slideId;
    attempt.lastSeenAt = now;
    if (!attempt.completedAt && isComplete(coverageOf(attempt))) attempt.completedAt = now;

    await this.writeAttempt(attempt);
    return attempt;
  }

  async setLastSlide(personId: string, deckId: string, slideId: number): Promise<void> {
    const attempt = await this.readAttempt(personId, deckId);
    if (!attempt) return;
    attempt.lastSlideId = slideId;
    attempt.lastSeenAt = new Date().toISOString();
    await this.writeAttempt(attempt);
  }

  async markComplete(personId: string, deckId: string): Promise<void> {
    const attempt = await this.readAttempt(personId, deckId);
    if (!attempt || attempt.completedAt) return;
    attempt.completedAt = new Date().toISOString();
    await this.writeAttempt(attempt);
  }
}

function blank(input: Omit<ProgressInput, 'slideId' | 'targetSeconds'>): Attempt {
  const now = new Date().toISOString();
  return {
    personId: input.personId,
    deckId: input.deckId,
    covered: [],
    lastSlideId: null,
    slideCount: input.slideCount,
    totalSeconds: input.totalSeconds,
    startedAt: now,
    lastSeenAt: now,
    completedAt: null,
  };
}
