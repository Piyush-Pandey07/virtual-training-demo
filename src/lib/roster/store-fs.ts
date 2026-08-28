/**
 * The roster on disk, for local development and for the tests.
 *
 * Three JSON files under `.data/roster`, read and written whole. That is fine for one
 * developer and a handful of rows, and it is deliberately not what production uses:
 * a read-modify-write of a whole file loses an update when two requests land
 * together, and progress is written once per slide per trainee across a cohort.
 *
 * Its real job is to make the contract testable. `npm test` runs with no database and
 * no framework, so the store tests exercise this implementation and the Postgres one
 * only has to be right about SQL.
 */

import 'server-only';

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { coverageOf, isComplete } from './completion';
import {
  assertUsablePersonId,
  emailKeyOf,
  localPersonId,
  RosterStoreError,
  withCovered,
  type AssignmentInput,
  type PersonInput,
  type InviteInput,
  type ProgressInput,
  type RosterStore,
} from './store';
import type { Assignment, Attempt, Invite, Person, Role } from './types';

interface RosterFile {
  people: Person[];
  assignments: Assignment[];
  attempts: Attempt[];
  invites: Invite[];
}

/**
 * A roster with nothing in it.
 *
 * A function rather than a constant, because a constant would be spread with `...`
 * into what looks like a copy and is not: the object is copied, the three arrays
 * inside it are shared. Every store handed the "empty" roster would then push into
 * the same three arrays, and rows would appear in stores that never saw them.
 */
function emptyRoster(): RosterFile {
  return { people: [], assignments: [], attempts: [], invites: [] };
}

export function defaultRosterRoot(): string {
  return join(process.cwd(), '.data', 'roster');
}

export class FilesystemRosterStore implements RosterStore {
  readonly kind = 'filesystem' as const;
  readonly writable = true;

  constructor(private readonly root: string) {}

  private get path(): string {
    return join(this.root, 'roster.json');
  }

  private async read(): Promise<RosterFile> {
    const text = await readFile(this.path, 'utf8').catch(() => null);
    if (text === null) return emptyRoster();
    try {
      const parsed = JSON.parse(text) as Partial<RosterFile>;
      return {
        people: Array.isArray(parsed.people) ? parsed.people : [],
        assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
        attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
        invites: Array.isArray(parsed.invites) ? parsed.invites : [],
      };
    } catch {
      // A hand-edited file that will not parse is a developer's problem to see, not
      // something to silently replace with an empty roster.
      throw new RosterStoreError(`${this.path} is not readable as JSON.`);
    }
  }

  private async write(file: RosterFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    // Written beside and renamed, so an interrupted write cannot leave a half file
    // that the next read refuses.
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(file, null, 2), 'utf8');
    await rename(temp, this.path);
  }

  private async update<T>(change: (file: RosterFile) => T): Promise<T> {
    const file = await this.read();
    const result = change(file);
    await this.write(file);
    return result;
  }

  // ------------------------------------------------------------------- people

  async listPeople(): Promise<Person[]> {
    const { people } = await this.read();
    return [...people].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }

  async getPerson(id: string): Promise<Person | undefined> {
    const { people } = await this.read();
    return people.find((person) => person.id === id);
  }

  async getPersonByEmail(email: string): Promise<Person | undefined> {
    const key = emailKeyOf(email);
    const { people } = await this.read();
    return people.find((person) => person.emailKey === key);
  }

  async upsertPerson(input: PersonInput): Promise<Person> {
    const email = input.email.trim();
    if (!email) throw new RosterStoreError('A person needs an email address.');
    const emailKey = emailKeyOf(email);
    const now = new Date().toISOString();

    return this.update((file) => {
      const existing = file.people.find((person) => person.emailKey === emailKey);

      if (existing) {
        // An id arriving for somebody added by hand is the moment they first signed
        // in. Adopt it, and carry their assignments and progress across with it.
        if (input.id && input.id !== existing.id) {
          const previous = existing.id;
          assertUsablePersonId(input.id);
          existing.id = input.id;
          for (const row of file.assignments)
            if (row.personId === previous) row.personId = input.id;
          for (const row of file.attempts) if (row.personId === previous) row.personId = input.id;
        }
        existing.email = email;
        if (input.name) existing.name = input.name;
        // Role is not taken from the caller here. Changing it is setRole, so a
        // sign-in cannot quietly re-grant a role an admin has just removed.
        existing.lastSeenAt = now;
        return { ...existing };
      }

      const id = input.id ?? localPersonId(email);
      assertUsablePersonId(id);
      const person: Person = {
        id,
        email,
        emailKey,
        name: input.name ?? '',
        role: input.role ?? 'trainee',
        createdAt: now,
        lastSeenAt: input.id ? now : null,
      };
      file.people.push(person);
      return { ...person };
    });
  }

  async setRole(id: string, role: Role): Promise<Person> {
    return this.update((file) => {
      const person = file.people.find((entry) => entry.id === id);
      if (!person) throw new RosterStoreError(`No such person: ${id}`);
      person.role = role;
      return { ...person };
    });
  }

  async removePerson(id: string): Promise<void> {
    await this.update((file) => {
      file.people = file.people.filter((person) => person.id !== id);
      file.assignments = file.assignments.filter((row) => row.personId !== id);
      file.attempts = file.attempts.filter((row) => row.personId !== id);
    });
  }

  // -------------------------------------------------------------- assignments

  async listAssignmentsForPerson(personId: string): Promise<Assignment[]> {
    const { assignments } = await this.read();
    return assignments.filter((row) => row.personId === personId);
  }

  async listAssignmentsForDeck(deckId: string): Promise<Assignment[]> {
    const { assignments } = await this.read();
    return assignments.filter((row) => row.deckId === deckId);
  }

  async isAssigned(personId: string, deckId: string): Promise<boolean> {
    const { assignments } = await this.read();
    return assignments.some((row) => row.personId === personId && row.deckId === deckId);
  }

  async assign(input: AssignmentInput): Promise<Assignment> {
    return this.update((file) => {
      const existing = file.assignments.find(
        (row) => row.personId === input.personId && row.deckId === input.deckId,
      );
      if (existing) {
        // Re-assigning is how a due date gets changed. It must not reset who assigned
        // it or when, which is the record of the original instruction.
        if (input.dueAt !== undefined) existing.dueAt = input.dueAt;
        return { ...existing };
      }

      const row: Assignment = {
        personId: input.personId,
        deckId: input.deckId,
        assignedBy: input.assignedBy,
        assignedAt: new Date().toISOString(),
        dueAt: input.dueAt ?? null,
      };
      file.assignments.push(row);
      return { ...row };
    });
  }

  async unassign(personId: string, deckId: string): Promise<void> {
    await this.update((file) => {
      file.assignments = file.assignments.filter(
        (row) => !(row.personId === personId && row.deckId === deckId),
      );
      // The attempt stays. Somebody who did the training then had it unassigned still
      // did the training, and deleting the record would be the wrong kind of tidy.
    });
  }

  // ------------------------------------------------------------------- invites

  async listInvites(): Promise<Invite[]> {
    const { invites } = await this.read();
    return [...invites].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async createInvite(input: InviteInput & { tokenHash: string }): Promise<Invite> {
    return this.update((file) => {
      const invite: Invite = {
        id: `inv-${input.tokenHash.slice(0, 12)}`,
        tokenHash: input.tokenHash,
        email: input.email ? emailKeyOf(input.email) : null,
        deckIds: [...new Set(input.deckIds)],
        createdBy: input.createdBy,
        createdAt: new Date().toISOString(),
        expiresAt: input.expiresAt,
        maxUses: Math.max(1, Math.round(input.maxUses)),
        usedCount: 0,
        usedBy: [],
        revokedAt: null,
      };
      file.invites.push(invite);
      return { ...invite };
    });
  }

  async findInviteByHash(tokenHash: string): Promise<Invite | undefined> {
    const { invites } = await this.read();
    return invites.find((invite) => invite.tokenHash === tokenHash);
  }

  async useInvite(tokenHash: string, personId: string): Promise<Invite> {
    return this.update((file) => {
      const invite = file.invites.find((entry) => entry.tokenHash === tokenHash);
      if (!invite) throw new RosterStoreError('No such invitation.');

      // Checked again here rather than trusting the caller's earlier check. Between
      // the two, somebody else may have taken the last use of a shared link.
      if (invite.revokedAt) throw new RosterStoreError('This invitation has been withdrawn.');
      if (invite.usedCount >= invite.maxUses) {
        throw new RosterStoreError('This invitation has already been fully used.');
      }

      // Accepting twice from the same person is not a second use. Otherwise a
      // refresh of the accept page would burn a seat on a shared link.
      if (!invite.usedBy.includes(personId)) {
        invite.usedBy.push(personId);
        invite.usedCount += 1;
      }
      return { ...invite };
    });
  }

  async revokeInvite(id: string): Promise<void> {
    await this.update((file) => {
      const invite = file.invites.find((entry) => entry.id === id);
      if (invite && !invite.revokedAt) invite.revokedAt = new Date().toISOString();
    });
  }

  // ------------------------------------------------------------------ attempts

  async getAttempt(personId: string, deckId: string): Promise<Attempt | undefined> {
    const { attempts } = await this.read();
    return attempts.find((row) => row.personId === personId && row.deckId === deckId);
  }

  async listAttemptsForPerson(personId: string): Promise<Attempt[]> {
    const { attempts } = await this.read();
    return attempts.filter((row) => row.personId === personId);
  }

  async listAttemptsForDeck(deckId: string): Promise<Attempt[]> {
    const { attempts } = await this.read();
    return attempts.filter((row) => row.deckId === deckId);
  }

  async touchAttempt(input: Omit<ProgressInput, 'slideId' | 'targetSeconds'>): Promise<Attempt> {
    return this.update((file) => ({ ...open(file, input) }));
  }

  async recordCovered(input: ProgressInput): Promise<Attempt> {
    const now = new Date().toISOString();
    return this.update((file) => {
      const attempt = open(file, input);
      attempt.covered = withCovered(attempt.covered, {
        slideId: input.slideId,
        targetSeconds: input.targetSeconds,
        coveredAt: now,
      });
      attempt.lastSlideId = input.slideId;
      attempt.lastSeenAt = now;
      if (!attempt.completedAt && isComplete(coverageOf(attempt))) attempt.completedAt = now;
      return { ...attempt };
    });
  }

  async setLastSlide(personId: string, deckId: string, slideId: number): Promise<void> {
    await this.update((file) => {
      const attempt = file.attempts.find(
        (row) => row.personId === personId && row.deckId === deckId,
      );
      if (!attempt) return;
      attempt.lastSlideId = slideId;
      attempt.lastSeenAt = new Date().toISOString();
    });
  }

  async markComplete(personId: string, deckId: string): Promise<void> {
    await this.update((file) => {
      const attempt = file.attempts.find(
        (row) => row.personId === personId && row.deckId === deckId,
      );
      if (attempt && !attempt.completedAt) attempt.completedAt = new Date().toISOString();
    });
  }
}

/** Finds the attempt or opens one, refreshing the deck snapshot as it goes. */
function open(file: RosterFile, input: Omit<ProgressInput, 'slideId' | 'targetSeconds'>): Attempt {
  const now = new Date().toISOString();
  const existing = file.attempts.find(
    (row) => row.personId === input.personId && row.deckId === input.deckId,
  );

  if (existing) {
    existing.lastSeenAt = now;
    return existing;
  }

  const attempt: Attempt = {
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
  file.attempts.push(attempt);
  return attempt;
}
