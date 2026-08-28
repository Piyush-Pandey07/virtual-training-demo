/**
 * Where people, assignments and progress are kept.
 *
 * The deck store's header says it is "deliberately not a database", and gives its
 * reasoning: the query that would have justified one turned out not to exist, because
 * everything about a deck is about that one deck. This is the case that reasoning
 * excluded. "Which decks has this person finished" and "who has not started the deck
 * I assigned" are cross-entity questions, and answering them by listing a blob prefix
 * is the ~750ms control-plane call the deck index was written to avoid.
 *
 * So this is a database, behind the same shape the deck store uses: one interface,
 * an implementation per deployment tier, chosen by `registry.ts` from the
 * environment. The filesystem implementation is what local development and the tests
 * run against, and it is a real implementation rather than a mock, so the contract is
 * exercised without a database being installed to run `npm test`.
 */

import 'server-only';

import type { Assignment, Attempt, CoveredSlide, Person, Role } from './types';

export class RosterStoreError extends Error {}

/** What is needed to create or refresh a person. */
export interface PersonInput {
  /** Stable identity from the auth provider. Generated for a person added by hand. */
  id?: string;
  email: string;
  name?: string;
  role?: Role;
}

/** One slide finishing, from the server that verified it. */
export interface ProgressInput {
  personId: string;
  deckId: string;
  slideId: number;
  /** Snapshotted from the deck by the caller, never sent by the browser. */
  targetSeconds: number;
  /** The deck as it is now, so a fresh attempt records what it is measured against. */
  slideCount: number;
  totalSeconds: number;
}

export interface AssignmentInput {
  personId: string;
  deckId: string;
  assignedBy: string;
  dueAt?: string | null;
}

export interface RosterStore {
  /** Human-readable, for diagnostics and the health endpoint. */
  readonly kind: 'blob' | 'postgres' | 'filesystem' | 'none';
  /** False when no storage is configured, so the UI can say so rather than fail oddly. */
  readonly writable: boolean;

  listPeople(): Promise<Person[]>;
  getPerson(id: string): Promise<Person | undefined>;
  getPersonByEmail(email: string): Promise<Person | undefined>;
  /** Creates on first sight, refreshes `lastSeenAt` and name after that. */
  upsertPerson(input: PersonInput): Promise<Person>;
  setRole(id: string, role: Role): Promise<Person>;
  removePerson(id: string): Promise<void>;

  listAssignmentsForPerson(personId: string): Promise<Assignment[]>;
  listAssignmentsForDeck(deckId: string): Promise<Assignment[]>;
  isAssigned(personId: string, deckId: string): Promise<boolean>;
  assign(input: AssignmentInput): Promise<Assignment>;
  unassign(personId: string, deckId: string): Promise<void>;

  getAttempt(personId: string, deckId: string): Promise<Attempt | undefined>;
  listAttemptsForPerson(personId: string): Promise<Attempt[]>;
  listAttemptsForDeck(deckId: string): Promise<Attempt[]>;
  /**
   * Records that a slide was finished. Idempotent: the same slide twice is one row.
   *
   * Opens the attempt if this is the first slide, so a progress call that arrives
   * before the session-start call still works.
   */
  recordCovered(input: ProgressInput): Promise<Attempt>;
  /** Opens or touches an attempt without covering anything. */
  touchAttempt(input: Omit<ProgressInput, 'slideId' | 'targetSeconds'>): Promise<Attempt>;
  /** Where the trainee was standing, for resuming. */
  setLastSlide(personId: string, deckId: string, slideId: number): Promise<void>;
  markComplete(personId: string, deckId: string): Promise<void>;
}

/** Rejects an id that could escape a storage key or collide with a path separator. */
export function assertUsablePersonId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
    throw new RosterStoreError(`"${id}" is not a usable person id.`);
  }
}

/** The form an address is compared and joined on. */
export function emailKeyOf(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A readable id for somebody an admin added before they ever signed in.
 *
 * Derived from the address rather than random, so adding the same person twice is
 * caught by the unique key instead of producing two rows nobody can tell apart.
 * Replaced by the auth provider's own uid the first time they actually sign in.
 */
export function localPersonId(email: string): string {
  const slug = emailKeyOf(email)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return `local-${slug || 'person'}`;
}

/** Merges a newly covered slide into a list, keeping it unique and in slide order. */
export function withCovered(covered: CoveredSlide[], slide: CoveredSlide): CoveredSlide[] {
  // Idempotent on purpose. Two tabs, a retry, or a trainee re-narrating a slide they
  // already heard must not count it twice, and must not overwrite the moment it was
  // first taught.
  if (covered.some((entry) => entry.slideId === slide.slideId)) return covered;
  return [...covered, slide].sort((a, b) => a.slideId - b.slideId);
}
