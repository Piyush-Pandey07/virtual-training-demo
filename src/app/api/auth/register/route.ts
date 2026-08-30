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
import { emailAllowed, isBootstrapAdmin } from '@/lib/auth/roles';
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

  if (!emailAllowed(email)) {
    return Response.json(
      { error: 'That address is not part of this organisation.' },
      { status: 403 },
    );
  }

  try {
    const store = rosterStore();
    const known = await store.getPersonByEmail(email);

    if (!known && !isBootstrapAdmin(email)) {
      return Response.json(
        {
          error:
            'There is no training account for that address. Ask whoever runs your training to add you.',
        },
        { status: 403 },
      );
    }

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

    const uid = await createAccount(email, body.password ?? '', body.name?.trim());

    // Links the new account to the row an administrator already made, carrying across
    // any training assigned before this person had ever signed in.
    const person = await store.upsertPerson({ id: uid, email, name: body.name?.trim() });
    if (!known && isBootstrapAdmin(email)) await store.setRole(person.id, 'admin');

    // No cookie here. The browser signs in with the password it has just chosen,
    // through the one route that decides who somebody is.
    return Response.json({ ok: true, email: person.email }, { status: 201 });
  } catch (error) {
    if (error instanceof RosterStoreError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
