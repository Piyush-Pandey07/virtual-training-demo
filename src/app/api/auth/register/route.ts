/**
 * POST /api/auth/register
 *
 * Setting a password for the first time.
 *
 * This is not open registration. It works only for an address an administrator has
 * already added to the roster, or one named as an administrator in the deployment
 * configuration. Somebody nobody has added gets nowhere — the same rule the sign-in
 * route enforces, and for the same reason: Firebase's own signup endpoint takes
 * nothing but the public API key, so the roster is the gate rather than Firebase.
 *
 * The account is created here rather than in the browser so that gate, and the
 * password rules, are enforced by something a determined person cannot skip.
 */

import { passwordProblem } from '@/lib/auth/password';
import { isPlatformAdmin } from '@/lib/auth/roles';
import { orgStore } from '@/lib/orgs/registry';
import { createAccount, findAccountByEmail, firebaseAdminConfigured } from '@/lib/firebase/admin';
import { rosterStore } from '@/lib/roster/registry';
import { RosterStoreError } from '@/lib/roster/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!firebaseAdminConfigured()) {
    return Response.json(
      { error: 'Sign-in is not configured on this deployment.' },
      { status: 503 },
    );
  }

  let body: { email?: string; name?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const email = body.email?.trim();
  if (!email || !email.includes('@')) {
    return Response.json({ error: 'An email address is required.' }, { status: 400 });
  }


  try {
    // Which customer this address belongs to, before any roster is read. A domain no
    // customer has claimed is refused in the same words as an unknown account, because
    // from outside they are the same thing and the difference is not something a
    // stranger should be able to probe for.
    const orgs = orgStore();
    const orgId = await orgs.orgIdForEmail(email).catch(() => undefined);
    if (!orgId) {
      return Response.json(
        {
          error:
            'There is no training account for that address. Ask whoever runs your training to add you.',
        },
        { status: 403 },
      );
    }

    const organisation = await orgs.get(orgId).catch(() => undefined);
    if (organisation?.status === 'suspended') {
      return Response.json(
        { error: 'Training for this organisation is currently suspended.' },
        { status: 403 },
      );
    }

    const store = rosterStore(orgId);
    const known = await store.getPersonByEmail(email);

    // Somebody has vouched for this address if an administrator put it on this
    // customer's roster. Anybody else is enrolling themselves, which is allowed
    // because the customer claimed their domain -- the check that reaching this line
    // already passed -- and which is why the account below is created unverified.
    const vouched = Boolean(known) || isPlatformAdmin(email);

    // Already has a password, so it is never touched here. Resetting it silently
    // would make this form a way of taking over somebody else's account by typing
    // their address; the reset email exists for the case where they have forgotten it.
    if (await findAccountByEmail(email)) {
      return Response.json(
        {
          error: 'That address already has a password. Sign in, or use the reset link.',
          signIn: true,
        },
        { status: 409 },
      );
    }

    const weak = passwordProblem(body.password ?? '', email);
    if (weak) return Response.json({ error: weak }, { status: 400 });

    // A vouched address is trusted immediately. A self-enrolled one is not, and has to
    // receive the verification mail the browser sends next before the sign-in route
    // will issue it a session.
    const uid = await createAccount(email, body.password ?? '', body.name?.trim(), {
      verified: vouched,
    });

    // Links the new account to the row an administrator already made, carrying across
    // any training assigned before this person had ever signed in.
    const person = await store.upsertPerson({ id: uid, email, name: body.name?.trim() });
    // Technavious staff are administrators wherever they are; the row is set to match
    // so the customer's own screens describe them the same way everything else does.
    if (!known && isPlatformAdmin(email)) await store.setRole(person.id, 'admin');

    // No cookie here. The browser signs in with the password it has just chosen,
    // through the one route that decides who somebody is -- unless it has to prove the
    // address first, in which case `verify` tells it to send the mail and stop.
    return Response.json({ ok: true, email: person.email, verify: !vouched }, { status: 201 });
  } catch (error) {
    if (error instanceof RosterStoreError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
