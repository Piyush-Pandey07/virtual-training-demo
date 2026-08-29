/**
 * POST /api/progress
 *
 * One slide finished being taught, or a session opening or closing.
 *
 * Three things this route will not take from the browser, each for its own reason:
 *
 *   - **Who.** The person comes from the session, never from the body. A body that
 *     carried a person id would let anyone complete anyone else's training.
 *   - **How much a slide is worth.** `targetSeconds` is read here from the deck, which
 *     is server-only and stays that way. A browser that could name its own weighting
 *     could finish a deck by claiming one slide was worth all of it.
 *   - **Whether it counts as complete.** Derived from what is stored, not asserted.
 *
 * What the browser is trusted with is which slide it just finished, and only for a
 * deck it has been assigned. That is a claim it is entitled to make: the session hook
 * only makes it after the audio has finished playing and the turn was not cut short.
 */

import {
  checkUser,
  NotAuthorised,
  requireAssignedDeck,
  unauthorisedResponse,
} from '@/lib/auth/guard';
import { getSlide, totalSlides } from '@/lib/deck';
import { loadDeck } from '@/lib/decks/registry';
import { rosterStore } from '@/lib/roster/registry';
import { deckWeight } from '@/lib/roster/report';
import { RosterStoreError } from '@/lib/roster/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A couple of small writes. Nothing here waits on a model. */
export const maxDuration = 15;

type Kind = 'start' | 'covered' | 'end';

interface Body {
  deckId?: string;
  kind?: Kind;
  slideId?: number;
}

export async function POST(request: Request) {
  try {
    // Signed in before anything else is read, so a stranger is told to sign in rather
    // than told what a well-formed request would have looked like. Which deck they
    // may attend needs the body, so that check comes after it.
    const signedIn = await checkUser();
    if (!signedIn.ok) return signedIn.response;

    let body: Body;
    try {
      body = (await request.json()) as Body;
    } catch {
      return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
    }

    const deckId = body.deckId?.trim();
    if (!deckId) return Response.json({ error: 'deckId is required.' }, { status: 400 });

    const person = await requireAssignedDeck(deckId);

    const deck = await loadDeck(deckId);
    if (!deck) throw new NotAuthorised(404, 'Not found.');

    const store = rosterStore();
    const weight = deckWeight(deck);
    const kind: Kind = body.kind ?? 'covered';

    if (kind === 'start') {
      const attempt = await store.touchAttempt({ personId: person.id, deckId, ...weight });
      return Response.json({ percent: 0, covered: attempt.covered.length });
    }

    const slideId = Number(body.slideId);
    if (!Number.isInteger(slideId) || slideId < 1 || slideId > totalSlides(deck)) {
      return Response.json(
        { error: `slideId must be between 1 and ${totalSlides(deck)}.` },
        { status: 400 },
      );
    }

    if (kind === 'end') {
      await store.setLastSlide(person.id, deckId, slideId);
      return Response.json({ ok: true });
    }

    const slide = getSlide(deck, slideId);
    if (!slide) return Response.json({ error: 'No such slide.' }, { status: 400 });

    const attempt = await store.recordCovered({
      personId: person.id,
      deckId,
      slideId,
      targetSeconds: slide.targetSeconds,
      ...weight,
    });

    return Response.json({
      covered: attempt.covered.length,
      completedAt: attempt.completedAt,
    });
  } catch (error) {
    const refused = unauthorisedResponse(error);
    if (refused) return refused;
    if (error instanceof RosterStoreError) {
      // The session must not break because a record could not be written. The caller
      // swallows this; it is here so a deployment without roster storage says why.
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
