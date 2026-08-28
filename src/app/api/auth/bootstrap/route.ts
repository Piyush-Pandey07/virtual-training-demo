/**
 * POST /api/auth/bootstrap
 *
 * Creates the very first administrator's account.
 *
 * Every other account comes from an invitation, which leaves a gap at the beginning:
 * the first administrator has nobody to invite them. This is that gap, closed as
 * narrowly as it can be.
 *
 * Two conditions, both required. The address must be named in `AUTH_ADMIN_EMAILS`,
 * which is a claim made by whoever configured the deployment rather than by the
 * person signing up. And the roster must contain no administrator yet — so this
 * route stops working the moment it has done its job, and cannot be used again to
 * add a second one.
 */

import { bootstrapAvailable } from '@/lib/auth/bootstrap';
import { isBootstrapAdmin } from '@/lib/auth/session';
import { passwordProblem } from '@/lib/auth/password';
import { createAccount, findAccountByEmail } from '@/lib/firebase/admin';
import { rosterStore } from '@/lib/roster/registry';
import { emailKeyOf, RosterStoreError } from '@/lib/roster/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!(await bootstrapAvailable())) {
    // The same answer whether the deployment is unconfigured or the first
    // administrator already exists. Neither is worth telling a stranger apart.
    return Response.json({ error: 'Not available.' }, { status: 404 });
  }

  let body: { email?: string; name?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const email = body.email?.trim();
  if (!email) return Response.json({ error: 'An email address is required.' }, { status: 400 });

  if (!isBootstrapAdmin(email)) {
    return Response.json(
      { error: 'That address is not listed as an administrator for this deployment.' },
      { status: 403 },
    );
  }

  const weak = passwordProblem(body.password ?? '', email);
  if (weak) return Response.json({ error: weak }, { status: 400 });

  try {
    if (await findAccountByEmail(email)) {
      return Response.json(
        { error: 'That address already has an account. Sign in instead.', signIn: true },
        { status: 409 },
      );
    }

    const uid = await createAccount(email, body.password ?? '', body.name?.trim());
    const store = rosterStore();
    const person = await store.upsertPerson({ id: uid, email, name: body.name?.trim() });
    await store.setRole(person.id, 'admin');

    // No cookie here. The browser signs in with the password it just chose, which
    // proves the account works before anybody depends on it, and goes through the
    // one route that decides who somebody is.
    return Response.json({ ok: true, email: emailKeyOf(email) }, { status: 201 });
  } catch (error) {
    if (error instanceof RosterStoreError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
