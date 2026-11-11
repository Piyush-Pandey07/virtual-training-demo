/**
 * Checking a hand-over from a trainer-led session before the trainer speaks (AI-01).
 *
 * A one-to-one turn is allowed because the deck is assigned to the person asking. A
 * facilitated turn is allowed because the person asking runs the session it names, the
 * session is for that deck, and it has not been closed. Everything it says about the
 * room, which names may be used and who asked, comes from the session record on the
 * server, never from the browser.
 */

import 'server-only';

import { requireUser, unauthorisedResponse } from '../auth/guard';
import { rosterStore } from '../roster/registry';
import type { SignedInPerson } from '../roster/types';
import type { FacilitatedTurn } from '../trainer-prompt';
import { mayManageSession } from './access';
import { trainingStore } from './store';
import type { TrainingSession } from './types';
import { needsConsent } from '../profiles/gate';

const TURNS: readonly FacilitatedTurn[] = ['explain', 'answer', 'greet', 'engage'];

export interface FacilitatedRequest {
  sessionId: string;
  turn: FacilitatedTurn;
  askedBy?: string;
}

/** The `facilitated` part of a chat request, or null for a one-to-one turn. */
export function parseFacilitated(raw: unknown): FacilitatedRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const { sessionId, turn, askedBy } = raw as Record<string, unknown>;
  if (typeof sessionId !== 'string' || !sessionId) return null;
  if (!TURNS.includes(turn as FacilitatedTurn)) return null;
  return {
    sessionId,
    turn: turn as FacilitatedTurn,
    ...(typeof askedBy === 'string' && askedBy.trim() ? { askedBy: askedBy.trim() } : {}),
  };
}

/** The name a participant is addressed by: their first name, or their email's first part. */
export function addressName(person: { name?: string; email: string }): string {
  const first = person.name?.trim().split(/\s+/)[0];
  return first || person.email.split('@')[0]!;
}

export interface Room {
  session: TrainingSession;
  /** First names of everybody listed and not marked absent. */
  attendees: string[];
  /** Who asked, only if it is one of `attendees`. */
  askedBy?: string;
}

export type FacilitatedGate =
  { ok: false; response: Response } | { ok: true; person: SignedInPerson; room: Room };

const notFound = () => Response.json({ error: 'Not found.' }, { status: 404 });

export async function checkFacilitated(
  request: FacilitatedRequest,
  deckId: string | undefined,
): Promise<FacilitatedGate> {
  let person: SignedInPerson;
  try {
    person = await requireUser();
  } catch (error) {
    const refused = unauthorisedResponse(error);
    if (refused) return { ok: false, response: refused };
    throw error;
  }

  const session = await trainingStore(person.orgId)
    .getSession(request.sessionId)
    .catch(() => undefined);
  if (!session || session.cancelledAt || !mayManageSession(person, session)) {
    return { ok: false, response: notFound() };
  }
  // The deck named must be the session's: a body that leaves it out would otherwise be
  // taught the company's default deck.
  if (!deckId || session.deckId !== deckId) return { ok: false, response: notFound() };
  // Nobody runs a session before agreeing to the privacy notice, as for attending one.
  if (await needsConsent(person)) {
    return {
      ok: false,
      response: Response.json(
        {
          error: 'Read and agree to the privacy notice first. Reload the page to see it.',
          code: 'unavailable',
          retry: false,
        },
        { status: 403 },
      ),
    };
  }
  if (session.status === 'closed') {
    return {
      ok: false,
      response: Response.json(
        { error: 'This session is closed.', code: 'unavailable', retry: false },
        { status: 409 },
      ),
    };
  }

  const roster = await rosterStore(person.orgId).listPeople();
  const attendees = session.participantIds
    .filter((id) => session.attendance[id] !== 'absent')
    .map((id) => roster.find((entry) => entry.id === id))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .map(addressName);

  // Only names from the participant list (AI-08). Anything else is dropped rather than
  // spoken, so the trainer cannot be made to address somebody who is not there.
  const askedBy = attendees.find((name) => name.toLowerCase() === request.askedBy?.toLowerCase());
  return { ok: true, person, room: { session, attendees, ...(askedBy ? { askedBy } : {}) } };
}
