/**
 * The names a trainer-led session keeps for the people on it (D-20).
 *
 * A closed session is a record, and a record that names its people only through the
 * roster forgets them the day they leave it: once somebody was removed, the summary, its
 * Excel file and the session page named them "Somebody no longer on the roster". So a
 * session keeps the name and address of everybody on it beside their id, its facilitator
 * included, written as they are listed and refreshed from the roster as it closes. The
 * screens still read the roster first, so somebody renamed since shows as they are now,
 * and fall back to what the session kept only when the roster no longer has them.
 *
 * Free of storage and of anything server-only, so the sessions board can use it too.
 */

import type { Person } from '../roster/types';
import type { ListedName, TrainingSession } from './types';

type Named = Pick<Person, 'id' | 'name' | 'email'>;

/** Everybody a session names: its facilitator, then everybody listed. */
export function namedOn(session: Pick<TrainingSession, 'facilitatorId' | 'participantIds'>) {
  return [session.facilitatorId, ...session.participantIds];
}

/** The name and address of each of these ids found among the people given, by id. */
export function namesOf(people: readonly Named[], ids: readonly string[]) {
  const wanted = new Set(ids);
  const names: Record<string, ListedName> = {};
  for (const person of people) {
    if (!wanted.has(person.id)) continue;
    names[person.id] = { name: person.name ?? '', email: person.email ?? '' };
  }
  return names;
}

/**
 * What a session keeps once refreshed from the roster: everybody on it who is still on the
 * roster as they are now, and anybody who has left as they were last kept. Nobody kept is
 * dropped, since somebody leaving the roster is exactly when their kept name is needed.
 */
export function refreshedNames(
  session: Pick<TrainingSession, 'facilitatorId' | 'participantIds' | 'people'>,
  people: readonly Named[],
): Record<string, ListedName> {
  return { ...session.people, ...namesOf(people, namedOn(session)) };
}

/** How a screen names somebody: by name, by address failing that, or not at all. */
export function shownName(named: Partial<ListedName> | undefined): string | undefined {
  return named?.name || named?.email || undefined;
}
