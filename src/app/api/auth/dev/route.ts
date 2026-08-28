/**
 * POST, DELETE /api/auth/dev
 *
 * The development sign-in. Sets a cookie naming a person in the roster, so both
 * dashboards can be built and used before the real sign-in exists.
 *
 * This is not authentication and does not pretend to be: anyone who can reach it can
 * become anyone. So it refuses to exist anywhere it could be mistaken for the real
 * thing — not on Vercel, and not in a production build — and the check is the first
 * thing in every handler rather than a condition somewhere below.
 */

import { cookies } from 'next/headers';

import { DEV_SESSION_COOKIE, devAuthEnabled } from '@/lib/auth/session';
import { rosterStore } from '@/lib/roster/registry';
import { RosterStoreError } from '@/lib/roster/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function refuseInProduction(): Response | null {
  if (devAuthEnabled()) return null;
  return Response.json(
    { error: 'The development sign-in is not available in this environment.' },
    { status: 404 },
  );
}

export async function POST(request: Request) {
  const blocked = refuseInProduction();
  if (blocked) return blocked;

  let body: { personId?: string; email?: string; name?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const store = rosterStore();

  try {
    // Either sign in as somebody already known, or add them and sign in as them,
    // which is how the first person comes to exist at all.
    const person = body.personId
      ? await store.getPerson(body.personId)
      : body.email
        ? await store.upsertPerson({ email: body.email, name: body.name })
        : undefined;

    if (!person) return Response.json({ error: 'No such person.' }, { status: 404 });

    const jar = await cookies();
    jar.set(DEV_SESSION_COOKIE, person.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 8,
    });

    return Response.json({ id: person.id, email: person.email, role: person.role });
  } catch (error) {
    if (error instanceof RosterStoreError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}

export async function DELETE() {
  const blocked = refuseInProduction();
  if (blocked) return blocked;

  const jar = await cookies();
  jar.delete(DEV_SESSION_COOKIE);
  return Response.json({ ok: true });
}
