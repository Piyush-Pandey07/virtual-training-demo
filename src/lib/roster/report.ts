/**
 * Joining people, assignments, attempts and decks into rows a page can render.
 *
 * The join is done here rather than in the store because decks do not live in the
 * roster: they are in blob storage, keyed by an id the roster only holds as a string.
 * So every report is a roster query plus one deck listing, matched up in memory.
 *
 * The left-hand side is always the assignment. Somebody who was given a deck and has
 * never opened it is a row at zero, not a missing row, and that is the row an
 * administrator is actually looking for.
 */

import 'server-only';

import type { DeckRecord } from '../deck-types';
import { listDecks } from '../decks/registry';
import type { DeckSummary } from '../decks/store';
import { coverageOf, emptyCoverage, percentComplete } from './completion';
import { rosterStore } from './registry';
import type { Attempt, Person, ProgressRow } from './types';

/**
 * What a deck is worth, for the denominator of a percentage.
 *
 * Every slide counts, including the title card and the closing page, because every
 * slide gets narrated: the session opens by narrating slide one. Excluding them here
 * while the session still counts them as covered would let a percentage exceed a
 * hundred. What stops a trainee being held short of complete by a thank-you slide is
 * the completion threshold, not the denominator.
 */
export function deckWeight(deck: DeckRecord): { slideCount: number; totalSeconds: number } {
  return {
    slideCount: deck.slides.length,
    totalSeconds: deck.slides.reduce((total, slide) => total + slide.targetSeconds, 0),
  };
}

function weightFromSummary(summary: DeckSummary | undefined): {
  slideCount: number;
  totalSeconds: number;
} {
  if (!summary) return { slideCount: 0, totalSeconds: 0 };
  // estimatedMinutes is the rounded sum of the slide budgets, which is close enough
  // for a row showing zero. The exact figure is snapshotted the moment an attempt
  // actually opens.
  return { slideCount: summary.slideCount, totalSeconds: summary.estimatedMinutes * 60 };
}

function rowFor(
  person: Person,
  deckId: string,
  summary: DeckSummary | undefined,
  attempt: Attempt | undefined,
  assignedAt: string,
  dueAt: string | null,
): ProgressRow {
  const weight = weightFromSummary(summary);
  const coverage = attempt
    ? coverageOf(attempt)
    : emptyCoverage(weight.slideCount, weight.totalSeconds);

  return {
    personId: person.id,
    personName: person.name || person.email,
    personEmail: person.email,
    deckId,
    deckTitle: summary?.title ?? null,
    assignedAt,
    dueAt,
    startedAt: attempt?.startedAt ?? null,
    lastSeenAt: attempt?.lastSeenAt ?? null,
    completedAt: attempt?.completedAt ?? null,
    lastSlideId: attempt?.lastSlideId ?? null,
    coverage,
    percent: percentComplete(coverage),
    // A deck re-analysed after somebody started it moves its own totals while their
    // attempt keeps the snapshot. Saying so beats letting it look like a bug.
    deckChangedSince: Boolean(attempt && summary && attempt.slideCount !== summary.slideCount),
  };
}

/** What one trainee has been asked to do, and how far they have got. */
export async function trainingFor(person: Person): Promise<ProgressRow[]> {
  const store = rosterStore();
  const [assignments, attempts, decks] = await Promise.all([
    store.listAssignmentsForPerson(person.id),
    store.listAttemptsForPerson(person.id),
    listDecks(),
  ]);

  const byDeck = new Map(decks.map((deck) => [deck.id, deck]));
  const attemptFor = new Map(attempts.map((attempt) => [attempt.deckId, attempt]));

  return assignments
    .map((row) =>
      rowFor(
        person,
        row.deckId,
        byDeck.get(row.deckId),
        attemptFor.get(row.deckId),
        row.assignedAt,
        row.dueAt,
      ),
    )
    .sort(byUrgency);
}

/** Everyone who was given one deck, and where each of them is. */
export async function progressForDeck(deckId: string): Promise<ProgressRow[]> {
  const store = rosterStore();
  const [assignments, attempts, people, decks] = await Promise.all([
    store.listAssignmentsForDeck(deckId),
    store.listAttemptsForDeck(deckId),
    store.listPeople(),
    listDecks(),
  ]);

  const summary = decks.find((deck) => deck.id === deckId);
  const byPerson = new Map(people.map((person) => [person.id, person]));
  const attemptFor = new Map(attempts.map((attempt) => [attempt.personId, attempt]));

  return assignments
    .map((row) => {
      const person = byPerson.get(row.personId);
      if (!person) return null;
      return rowFor(
        person,
        deckId,
        summary,
        attemptFor.get(row.personId),
        row.assignedAt,
        row.dueAt,
      );
    })
    .filter((row): row is ProgressRow => row !== null)
    .sort((a, b) => a.percent - b.percent || a.personName.localeCompare(b.personName));
}

/** One line per person, for the administrator's list of everybody. */
export interface PersonOverview {
  person: Person;
  assigned: number;
  completed: number;
  inProgress: number;
  lastActiveAt: string | null;
}

export async function peopleOverview(): Promise<PersonOverview[]> {
  const store = rosterStore();
  const people = await store.listPeople();

  const rows = await Promise.all(
    people.map(async (person) => {
      const [assignments, attempts] = await Promise.all([
        store.listAssignmentsForPerson(person.id),
        store.listAttemptsForPerson(person.id),
      ]);

      const assignedIds = new Set(assignments.map((row) => row.deckId));
      const relevant = attempts.filter((attempt) => assignedIds.has(attempt.deckId));
      const completed = relevant.filter((attempt) => attempt.completedAt !== null).length;

      const lastActiveAt = attempts.reduce<string | null>(
        (latest, attempt) =>
          latest === null || attempt.lastSeenAt > latest ? attempt.lastSeenAt : latest,
        null,
      );

      return {
        person,
        assigned: assignedIds.size,
        completed,
        inProgress: relevant.length - completed,
        lastActiveAt,
      };
    }),
  );

  return rows;
}

/** Unfinished first, then by due date, then by title. What to do next, in order. */
function byUrgency(a: ProgressRow, b: ProgressRow): number {
  const done = Number(a.completedAt !== null) - Number(b.completedAt !== null);
  if (done !== 0) return done;

  if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
  if (a.dueAt && !b.dueAt) return -1;
  if (!a.dueAt && b.dueAt) return 1;

  return (a.deckTitle ?? a.deckId).localeCompare(b.deckTitle ?? b.deckId);
}
