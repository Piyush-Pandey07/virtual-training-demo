/**
 * The roster in a document database.
 *
 * This is what the blob store was standing in for. The difference that matters is
 * not speed or tidiness, it is that a document here can be changed atomically, so
 * the two limitations the blob store had to document simply do not arise:
 *
 *   - Two tabs finishing slides at the same moment cannot lose one. Each covered
 *     slide is added inside an `update`, which a real database retries on collision.
 *   - Two administrators assigning at the same instant cannot lose an assignment,
 *     because each one is its own document rather than an entry in a shared list.
 *
 * One document per thing, keyed so that everything the app asks for is either a
 * direct read or a single-field equality query, neither of which needs an index:
 *
 *   people/{personId}
 *   assignments/{personId}__{deckId}
 *   attempts/{personId}__{deckId}
 *
 * Covered slides are a map keyed by slide number rather than a list. A list would
 * need de-duplicating on every write and would grow a duplicate the moment two
 * writes raced; a map keyed by the thing that must be unique cannot hold the same
 * slide twice however it is written.
 */

import 'server-only';

import { coverageOf, isComplete } from './completion';
import type { DocumentStore } from './documents';
import {
  assertUsablePersonId,
  emailKeyOf,
  localPersonId,
  RosterStoreError,
  type AssignmentInput,
  type PersonInput,
  type ProgressInput,
  type RosterStore,
} from './store';
import type { Assignment, Attempt, CoveredSlide, Person, Role } from './types';

const PEOPLE = 'people';
const ASSIGNMENTS = 'assignments';
const ATTEMPTS = 'attempts';

/** How a covered slide is stored: keyed by slide number, so it cannot be duplicated. */
interface StoredAttempt extends Omit<Attempt, 'covered'> {
  covered: Record<string, { targetSeconds: number; coveredAt: string }>;
}

function pairId(personId: string, deckId: string): string {
  assertUsablePersonId(personId);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(deckId)) {
    throw new RosterStoreError(`"${deckId}" is not a usable deck id.`);
  }
  return `${personId}__${deckId}`;
}

function toAttempt(stored: StoredAttempt): Attempt {
  const covered: CoveredSlide[] = Object.entries(stored.covered ?? {})
    .map(([slideId, entry]) => ({
      slideId: Number(slideId),
      targetSeconds: entry.targetSeconds,
      coveredAt: entry.coveredAt,
    }))
    .filter((slide) => Number.isFinite(slide.slideId))
    .sort((a, b) => a.slideId - b.slideId);

  return { ...stored, covered };
}

function blank(
  input: Omit<ProgressInput, 'slideId' | 'targetSeconds'>,
  now: string,
): StoredAttempt {
  return {
    personId: input.personId,
    deckId: input.deckId,
    covered: {},
    lastSlideId: null,
    slideCount: input.slideCount,
    totalSeconds: input.totalSeconds,
    startedAt: now,
    lastSeenAt: now,
    completedAt: null,
  };
}

export class DocumentRosterStore implements RosterStore {
  readonly kind = 'firestore' as const;
  readonly writable = true;

  constructor(private readonly docs: DocumentStore) {}

  // ------------------------------------------------------------------- people

  async listPeople(): Promise<Person[]> {
    const people = await this.docs.all<Person>(PEOPLE);
    return people.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }

  async getPerson(id: string): Promise<Person | undefined> {
    return this.docs.get<Person>(PEOPLE, id);
  }

  async getPersonByEmail(email: string): Promise<Person | undefined> {
    const found = await this.docs.where<Person>(PEOPLE, 'emailKey', emailKeyOf(email));
    return found[0];
  }

  async upsertPerson(input: PersonInput): Promise<Person> {
    const email = input.email.trim();
    if (!email) throw new RosterStoreError('A person needs an email address.');
    const emailKey = emailKeyOf(email);
    const now = new Date().toISOString();

    const existing = await this.getPersonByEmail(email);

    // A new id for somebody already here is the moment they first signed in: the
    // provider has given them a real one to replace the placeholder. The document is
    // keyed by id, so this is a move rather than an edit, and everything keyed on the
    // old id has to come with them.
    if (existing && input.id && input.id !== existing.id) {
      assertUsablePersonId(input.id);
      const moved: Person = {
        ...existing,
        id: input.id,
        email,
        name: input.name || existing.name,
        lastSeenAt: now,
      };

      await this.docs.set(PEOPLE, input.id, moved);

      for (const row of await this.docs.where<Assignment>(ASSIGNMENTS, 'personId', existing.id)) {
        await this.docs.set(ASSIGNMENTS, pairId(input.id, row.deckId), {
          ...row,
          personId: input.id,
        });
        await this.docs.remove(ASSIGNMENTS, pairId(existing.id, row.deckId));
      }

      for (const row of await this.docs.where<StoredAttempt>(ATTEMPTS, 'personId', existing.id)) {
        await this.docs.set(ATTEMPTS, pairId(input.id, row.deckId), {
          ...row,
          personId: input.id,
        });
        await this.docs.remove(ATTEMPTS, pairId(existing.id, row.deckId));
      }

      await this.docs.remove(PEOPLE, existing.id);
      return moved;
    }

    if (existing) {
      const updated: Person = {
        ...existing,
        email,
        name: input.name || existing.name,
        // Role is never taken from the caller, so signing in cannot restore a role an
        // administrator has just removed.
        lastSeenAt: now,
      };
      await this.docs.set(PEOPLE, existing.id, updated);
      return updated;
    }

    const id = input.id ?? localPersonId(email);
    assertUsablePersonId(id);
    const made: Person = {
      id,
      email,
      emailKey,
      name: input.name ?? '',
      role: input.role ?? 'trainee',
      orgId: input.orgId,
      createdAt: now,
      lastSeenAt: input.id ? now : null,
    };
    await this.docs.set(PEOPLE, id, made);
    return made;
  }

  async setRole(id: string, role: Role): Promise<Person> {
    const person = await this.getPerson(id);
    if (!person) throw new RosterStoreError(`No such person: ${id}`);
    const updated = { ...person, role };
    await this.docs.set(PEOPLE, id, updated);
    return updated;
  }

  async setOrgId(id: string, orgId: string): Promise<Person> {
    const person = await this.getPerson(id);
    if (!person) throw new RosterStoreError(`No such person: ${id}`);
    const updated = { ...person, orgId };
    await this.docs.set(PEOPLE, id, updated);
    return updated;
  }

  async removePerson(id: string): Promise<void> {
    for (const row of await this.docs.where<Assignment>(ASSIGNMENTS, 'personId', id)) {
      await this.docs.remove(ASSIGNMENTS, pairId(id, row.deckId));
    }
    for (const row of await this.docs.where<StoredAttempt>(ATTEMPTS, 'personId', id)) {
      await this.docs.remove(ATTEMPTS, pairId(id, row.deckId));
    }
    await this.docs.remove(PEOPLE, id);
  }

  // -------------------------------------------------------------- assignments

  async listAssignmentsForPerson(personId: string): Promise<Assignment[]> {
    return this.docs.where<Assignment>(ASSIGNMENTS, 'personId', personId);
  }

  async listAssignmentsForDeck(deckId: string): Promise<Assignment[]> {
    return this.docs.where<Assignment>(ASSIGNMENTS, 'deckId', deckId);
  }

  async isAssigned(personId: string, deckId: string): Promise<boolean> {
    return (await this.docs.get<Assignment>(ASSIGNMENTS, pairId(personId, deckId))) !== undefined;
  }

  async assign(input: AssignmentInput): Promise<Assignment> {
    const id = pairId(input.personId, input.deckId);

    return this.docs.update<Assignment>(ASSIGNMENTS, id, (current) => {
      if (current) {
        // Re-assigning changes the due date and nothing else. Who first asked, and
        // when, is the record of the instruction.
        return { ...current, dueAt: input.dueAt === undefined ? current.dueAt : input.dueAt };
      }
      return {
        personId: input.personId,
        deckId: input.deckId,
        assignedBy: input.assignedBy,
        assignedAt: new Date().toISOString(),
        dueAt: input.dueAt ?? null,
      };
    });
  }

  async unassign(personId: string, deckId: string): Promise<void> {
    // The attempt stays. Somebody who did the training and then had it unassigned
    // still did the training.
    await this.docs.remove(ASSIGNMENTS, pairId(personId, deckId));
  }

  // ----------------------------------------------------------------- attempts

  async getAttempt(personId: string, deckId: string): Promise<Attempt | undefined> {
    const stored = await this.docs.get<StoredAttempt>(ATTEMPTS, pairId(personId, deckId));
    return stored ? toAttempt(stored) : undefined;
  }

  async listAttemptsForPerson(personId: string): Promise<Attempt[]> {
    const found = await this.docs.where<StoredAttempt>(ATTEMPTS, 'personId', personId);
    return found.map(toAttempt);
  }

  async listAttemptsForDeck(deckId: string): Promise<Attempt[]> {
    const found = await this.docs.where<StoredAttempt>(ATTEMPTS, 'deckId', deckId);
    return found.map(toAttempt);
  }

  async touchAttempt(input: Omit<ProgressInput, 'slideId' | 'targetSeconds'>): Promise<Attempt> {
    const now = new Date().toISOString();
    const stored = await this.docs.update<StoredAttempt>(
      ATTEMPTS,
      pairId(input.personId, input.deckId),
      (current) => (current ? { ...current, lastSeenAt: now } : blank(input, now)),
    );
    return toAttempt(stored);
  }

  /**
   * One slide finished being taught.
   *
   * The whole read-decide-write happens inside `update`, so two tabs finishing
   * different slides at the same moment cannot lose one: the second attempt sees the
   * first one's result and adds to it. This is the thing the blob store could not do.
   */
  async recordCovered(input: ProgressInput): Promise<Attempt> {
    const now = new Date().toISOString();
    const key = String(input.slideId);

    const stored = await this.docs.update<StoredAttempt>(
      ATTEMPTS,
      pairId(input.personId, input.deckId),
      (current) => {
        const attempt = current ?? blank(input, now);

        // The first time a slide was taught is the record. A trainee re-narrating a
        // slide they already heard does not move it, and neither does a retry.
        const covered = attempt.covered[key]
          ? attempt.covered
          : { ...attempt.covered, [key]: { targetSeconds: input.targetSeconds, coveredAt: now } };

        const next: StoredAttempt = {
          ...attempt,
          covered,
          lastSlideId: input.slideId,
          lastSeenAt: now,
        };

        if (!next.completedAt && isComplete(coverageOf(toAttempt(next)))) next.completedAt = now;
        return next;
      },
    );

    return toAttempt(stored);
  }

  async setLastSlide(personId: string, deckId: string, slideId: number): Promise<void> {
    const id = pairId(personId, deckId);
    const current = await this.docs.get<StoredAttempt>(ATTEMPTS, id);
    if (!current) return;
    await this.docs.set(ATTEMPTS, id, {
      ...current,
      lastSlideId: slideId,
      lastSeenAt: new Date().toISOString(),
    });
  }

  async markComplete(personId: string, deckId: string): Promise<void> {
    const id = pairId(personId, deckId);
    const current = await this.docs.get<StoredAttempt>(ATTEMPTS, id);
    if (!current || current.completedAt) return;
    await this.docs.set(ATTEMPTS, id, {
      ...current,
      completedAt: new Date().toISOString(),
    });
  }
}
