/**
 * Who may see a participant's details, sessions and results, through the sessions they
 * share.
 *
 * The other features ask this file rather than working it out themselves, so the rule
 * in BRD v2.3 is written once: a facilitator sees the people in their own sessions and
 * batches, and nobody else's.
 */

import 'server-only';

import type { DocumentStore } from '../roster/documents';
import type { SignedInPerson } from '../roster/types';
import { trainingStore } from './store';
import type { TrainingSession } from './types';

/** Whether this viewer facilitates a session or batch that lists this participant. */
export async function facilitatesPerson(
  viewer: SignedInPerson,
  personId: string,
  options: { store?: DocumentStore } = {},
): Promise<boolean> {
  if (viewer.role !== 'facilitator') return false;
  const store = trainingStore(viewer.orgId, options.store);
  const [sessions, batches] = await Promise.all([
    store.sessionsFacilitatedBy(viewer.id),
    store.listBatches(),
  ]);
  return (
    sessions.some((session) => session.participantIds.includes(personId)) ||
    batches.some(
      (batch) => batch.facilitatorId === viewer.id && batch.participantIds.includes(personId),
    )
  );
}

/**
 * Whether this facilitator runs a trainer-led session on this deck, so may show its
 * slides without being assigned it. Only ever true for the facilitator role: everybody
 * else is assigned the deck or is an administrator.
 */
export async function facilitatesDeck(
  viewer: SignedInPerson,
  deckId: string,
  options: { store?: DocumentStore } = {},
): Promise<boolean> {
  if (viewer.role !== 'facilitator') return false;
  const sessions = await trainingStore(viewer.orgId, options.store).sessionsFacilitatedBy(
    viewer.id,
  );
  return sessions.some((session) => session.deckId === deckId);
}

/** Whether this viewer may see and run this session. */
export function mayManageSession(viewer: SignedInPerson, session: TrainingSession): boolean {
  if (viewer.platform || viewer.role === 'admin') return true;
  return viewer.role === 'facilitator' && session.facilitatorId === viewer.id;
}

/** The trainer-led sessions this person is listed for, which they may join. */
export async function sessionsListing(
  person: SignedInPerson,
  options: { store?: DocumentStore } = {},
): Promise<TrainingSession[]> {
  const sessions = await trainingStore(person.orgId, options.store).listSessions();
  return sessions.filter((session) => session.participantIds.includes(person.id));
}
