/**
 * What one customer is doing, for the only screen that sees across customers.
 *
 * Every other read in the app is scoped to the person doing it. This one is not, and
 * that is the point: Technavious support has to be able to answer "is anybody actually
 * using it" and "who do I call at this company" without asking the customer. So it is
 * kept deliberately narrow. Counts, who the administrators are, and which sessions are
 * open right now -- never what a trainee said, never what a deck contains, never
 * anything a support call would not reasonably need.
 *
 * Read through the scoped stores like everything else. There is no unscoped query here
 * and there must not be: this module is handed an organisation id and is as confined to
 * it as a customer's own screens are.
 */

import 'server-only';

import { listDecks } from '../decks/registry';
import { coverageOf, percentComplete } from '../roster/completion';
import { rosterStore } from '../roster/registry';
import { isPlatformAdmin } from '../auth/roles';
import type { Attempt, Person } from '../roster/types';
import { OPEN_SESSION_MINUTES } from './overview-types';
import type { CustomerOverview, OpenSession } from './overview-types';

// Re-exported so server code has one import for everything overview-shaped, while the
// types themselves stay in a module a client component can reach.
export { OPEN_SESSION_MINUTES };
export type { CustomerAdmin, CustomerOverview, OpenSession } from './overview-types';

function nameOf(person: Person): string {
  return person.name || person.email;
}

function laterOf(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/**
 * Everything the customer list shows about one customer.
 *
 * Attempts are read per deck rather than per person because a customer has fewer decks
 * than employees, and this runs once per customer on a page that lists all of them.
 * Nothing here is cached: it is a support screen read a few times a day, and a stale
 * answer to "is a session running right now" would be worse than a slow one.
 */
export async function customerOverview(orgId: string): Promise<CustomerOverview> {
  const store = rosterStore(orgId);

  const [people, decks] = await Promise.all([
    store.listPeople().catch(() => [] as Person[]),
    listDecks(orgId).catch(() => []),
  ]);

  const attemptsByDeck = await Promise.all(
    decks.map(async (deck) => ({
      deck,
      attempts: await store.listAttemptsForDeck(deck.id).catch(() => [] as Attempt[]),
    })),
  );

  const byId = new Map(people.map((person) => [person.id, person]));
  const cutoff = new Date(Date.now() - OPEN_SESSION_MINUTES * 60_000).toISOString();

  const open: OpenSession[] = [];
  let unfinished = 0;
  let completed = 0;
  let lastActivityAt: string | null = null;

  for (const { deck, attempts } of attemptsByDeck) {
    for (const attempt of attempts) {
      lastActivityAt = laterOf(lastActivityAt, attempt.lastSeenAt);

      if (attempt.completedAt !== null) {
        completed += 1;
        continue;
      }

      unfinished += 1;
      if (attempt.lastSeenAt < cutoff) continue;

      // An attempt can outlive the person if a row was removed while a session was
      // open. Showing the id would be worse than saying nothing, so it is skipped.
      const person = byId.get(attempt.personId);
      if (!person) continue;

      open.push({
        personName: nameOf(person),
        personEmail: person.email,
        deckId: deck.id,
        deckTitle: deck.title,
        percent: percentComplete(coverageOf(attempt)),
        startedAt: attempt.startedAt,
        lastSeenAt: attempt.lastSeenAt,
      });
    }
  }

  open.sort((a, b) => (a.lastSeenAt > b.lastSeenAt ? -1 : 1));

  const admins = people
    .filter((person) => person.role === 'admin')
    .map((person) => ({
      name: nameOf(person),
      email: person.email,
      platform: isPlatformAdmin(person.email),
      lastSeenAt: person.lastSeenAt,
    }))
    // The customer's own people first. Somebody looking for who to call wants them,
    // and Technavious staff appearing at the top would read like an answer.
    .sort((a, b) => Number(a.platform) - Number(b.platform) || a.name.localeCompare(b.name));

  return {
    people: {
      total: people.length,
      trainees: people.filter((person) => person.role !== 'admin').length,
      neverSignedIn: people.filter((person) => !person.lastSeenAt).length,
      admins,
    },
    decks: {
      total: decks.length,
      published: decks.filter((deck) => deck.status === 'published').length,
    },
    sessions: { open, unfinished, completed, lastActivityAt },
  };
}
