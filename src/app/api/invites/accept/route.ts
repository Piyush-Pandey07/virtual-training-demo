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
import { passwordProblem } from '@/lib/auth/password';
import { createAccount, findAccountByEmail, firebaseAdminConfigured } from '@/lib/firebase/admin';
import { explainProblem, hashToken, inviteProblem } from '@/lib/roster/invites';
import { rosterStore } from '@/lib/roster/registry';
import { emailKeyOf, RosterStoreError } from '@/lib/roster/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  token?: string;
  email?: string;
  name?: string;
  password?: string;
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

    // Nobody signed in, and real sign-in is configured: this is somebody accepting an
    // invitation for the first time, so the account is created here.
    //
    // Created here rather than in the browser because Firebase's own signup endpoint
    // takes nothing but the public API key. An account made that way could not be
    // required to hold an invitation, and the password rules could not be enforced.
    if (firebaseAdminConfigured()) {
      const claimedHere = body.email?.trim();
      if (invite.email && claimedHere && emailKeyOf(claimedHere) !== emailKeyOf(invite.email)) {
        return Response.json({ error: explainProblem('wrong-email') }, { status: 403 });
      }

      const address = invite.email ?? claimedHere;
      if (!address) {
        return Response.json({ error: 'An email address is required.' }, { status: 400 });
      }

      const domains = (process.env.ALLOWED_EMAIL_DOMAINS ?? '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
      if (domains.length > 0 && !domains.includes(emailKeyOf(address).split('@')[1] ?? '')) {
        return Response.json(
          { error: 'That address is not part of this organisation.' },
          { status: 403 },
        );
      }

      // An address that already has an account signs in instead. Accepting again
      // would either fail on the duplicate or silently reset their password, and the
      // second of those is a way in for whoever holds a forwarded link.
      if (await findAccountByEmail(address)) {
        return Response.json(
          {
            error: 'That address already has an account. Sign in, then open this link again.',
            signIn: true,
          },
          { status: 409 },
        );
      }

      const password = body.password ?? '';
      const weak = passwordProblem(password, address);
      if (weak) return Response.json({ error: weak }, { status: 400 });

      const uid = await createAccount(address, password, body.name?.trim());
      const person = await store.upsertPerson({ id: uid, email: address, name: body.name?.trim() });

      // No cookie is set here. The browser signs in with the password it has just
      // chosen, which proves the account works before anybody depends on it.
      const done = await accept(invite.id, invite.tokenHash, invite.deckIds, person.id, address);
      return Response.json({ ...(await done.json()), created: true });
    }

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
