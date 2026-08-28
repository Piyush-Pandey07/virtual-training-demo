/**
 * POST /api/invites/accept
 *
 * Turning a link into a person with training assigned to them.
 *
 * Two ways in, and the difference is the whole design. Somebody already signed in
 * accepts as themselves. Somebody who is not gets signed in first — which, today,
 * the development sign-in does, and which Firebase will do by sending them to
 * Microsoft and bringing them back here afterwards. The route does not care which
 * put the session there, so wiring Firebase changes nothing in this file.
 *
 * The eligibility check runs twice on purpose: once here, and again inside the store
 * as it records the use. Between the two, somebody else may have taken the last seat
 * on a shared link, and only the store can see that without a race.
 */

import { cookies } from 'next/headers';

import { currentPerson, DEV_SESSION_COOKIE, devAuthEnabled } from '@/lib/auth/session';
import { explainProblem, hashToken, inviteProblem } from '@/lib/roster/invites';
import { rosterStore } from '@/lib/roster/registry';
import { emailKeyOf, RosterStoreError } from '@/lib/roster/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  token?: string;
  email?: string;
  name?: string;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const token = body.token?.trim();
  if (!token) return Response.json({ error: 'A token is required.' }, { status: 400 });

  const store = rosterStore();

  try {
    const invite = await store.findInviteByHash(hashToken(token));

    // Checked before anything is created, so a dead link cannot add a person.
    const problem = inviteProblem(invite, new Date());
    if (problem || !invite) {
      return Response.json({ error: explainProblem(problem ?? 'unknown') }, { status: 404 });
    }

    const signedIn = await currentPerson();

    // A signed-in person accepts as themselves, and a personal invitation checks that
    // they are who it was issued to.
    if (signedIn) {
      const mismatch = inviteProblem(invite, new Date(), signedIn.email);
      if (mismatch) {
        return Response.json({ error: explainProblem(mismatch) }, { status: 403 });
      }
      return await accept(invite.id, invite.tokenHash, invite.deckIds, signedIn.id, signedIn.email);
    }

    // Nobody signed in. Real sign-in has to happen first, and the client sends them
    // there carrying the token so they land back here afterwards.
    if (!devAuthEnabled()) {
      return Response.json(
        { error: 'Sign in first, then open the invitation link again.', signIn: true },
        { status: 401 },
      );
    }

    // The development path: the invitation names the address, or the person types it.
    //
    // The order here matters and got it wrong once. Reading the invitation's own
    // address first and falling back to the typed one meant a personal invitation
    // compared its address to itself, so the check passed for anybody: somebody
    // claiming a different address was quietly signed in as the invitee. Whatever
    // was typed is checked against the invitation before anything falls back.
    const claimed = body.email?.trim();
    if (invite.email && claimed && emailKeyOf(claimed) !== emailKeyOf(invite.email)) {
      return Response.json({ error: explainProblem('wrong-email') }, { status: 403 });
    }

    const email = invite.email ?? claimed;
    if (!email) {
      return Response.json({ error: 'An email address is required.' }, { status: 400 });
    }

    const person = await store.upsertPerson({ email, name: body.name?.trim() });

    const jar = await cookies();
    jar.set(DEV_SESSION_COOKIE, person.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 8,
    });

    return await accept(invite.id, invite.tokenHash, invite.deckIds, person.id, person.email);
  } catch (error) {
    if (error instanceof RosterStoreError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

/**
 * Records the use and assigns whatever the invitation carried.
 *
 * The use is recorded first. If assigning then fails, somebody has a seat and no
 * training, which an administrator can see and fix; the other order would let a
 * shared link hand out training without ever counting a use.
 */
async function accept(
  inviteId: string,
  tokenHash: string,
  deckIds: string[],
  personId: string,
  email: string,
): Promise<Response> {
  const store = rosterStore();
  const invite = await store.useInvite(tokenHash, personId);

  for (const deckId of deckIds) {
    await store.assign({ personId, deckId, assignedBy: invite.createdBy });
  }

  return Response.json({ ok: true, personId, email, assigned: deckIds.length, inviteId });
}
