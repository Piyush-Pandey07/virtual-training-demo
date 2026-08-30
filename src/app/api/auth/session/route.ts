/**
 * POST, DELETE /api/auth/session
 *
 * Turning a Firebase ID token into a session cookie, and clearing it again.
 *
 * This is the only place an ID token is accepted, and the only place the person
 * behind it is decided. Everything downstream reads the cookie.
 *
 * The gate here is roster membership, and with email and password it is the whole
 * boundary. Firebase's own account-creation endpoint takes nothing but the public API
 * key, so anybody who reads the bundle can create an account in the project and
 * cannot be stopped from doing so. What they cannot do is get a session: an account
 * this app knows about was added by an administrator first, and a Firebase account
 * with no row here is turned away with nothing to show for it.
 *
 * The one exception is the first administrator, whom nobody is there to add. Their
 * address is named in the deployment configuration, which is a claim about them made
 * by whoever set the deployment up rather than by them.
 */

import { cookies } from 'next/headers';

import { effectiveRole, isBootstrapAdmin } from '@/lib/auth/roles';
import { SESSION_COOKIE } from '@/lib/auth/session';
import {
  createSessionCookie,
  firebaseAdminConfigured,
  SESSION_TTL_MS,
  setRoleClaim,
  verifySessionCookie,
} from '@/lib/firebase/admin';
import { rosterStore } from '@/lib/roster/registry';
import { emailKeyOf, RosterStoreError } from '@/lib/roster/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Domains an address may end in, when configured. */
function allowedDomains(): string[] {
  return (process.env.ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function refuse(message: string, status = 403): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  if (!firebaseAdminConfigured()) {
    return Response.json(
      { error: 'Sign-in is not configured on this deployment.' },
      { status: 503 },
    );
  }

  let body: { idToken?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const idToken = body.idToken?.trim();
  if (!idToken) return Response.json({ error: 'An ID token is required.' }, { status: 400 });

  // Minted first so the token is verified before anything is trusted from it:
  // createSessionCookie refuses a token it cannot verify.
  let cookie: string;
  try {
    cookie = await createSessionCookie(idToken);
  } catch {
    return refuse('That sign-in could not be verified.', 401);
  }

  const decoded = await verifySessionCookie(cookie);
  if (!decoded) return refuse('That sign-in could not be verified.', 401);

  const email = typeof decoded.email === 'string' ? decoded.email : '';
  if (!email) return refuse('That account has no email address attached to it.');
  if (decoded.email_verified === false) {
    return refuse('That account has an unverified email address.');
  }

  const domains = allowedDomains();
  if (domains.length > 0) {
    const domain = emailKeyOf(email).split('@')[1] ?? '';
    if (!domains.includes(domain)) {
      return refuse('That account is not part of this organisation.');
    }
  }

  try {
    const store = rosterStore();

    // Known here already, or named as an administrator by the deployment. Anything
    // else is a Firebase account nobody added here, and it gets no session.
    const known = await store.getPersonByEmail(email);
    if (!known && !isBootstrapAdmin(email)) {
      return refuse(
        'There is no training account for that address. Ask whoever runs your training to add you.',
      );
    }

    // Refreshes the name and the last-seen stamp, and adopts the Firebase uid for
    // somebody an administrator added by hand before they had ever signed in. The
    // role is never taken from here, so signing in cannot restore access an
    // administrator has just removed.
    const person = await store.upsertPerson({
      id: decoded.uid,
      email,
      name: typeof decoded.name === 'string' ? decoded.name : undefined,
    });

    // The role that actually applies, which is not always the stored one: an address
    // named in AUTH_ADMIN_EMAILS is an administrator whatever the row says. Reported
    // and mirrored as the effective one, because a response that says "trainee" for
    // somebody every page treats as an administrator is a lie that will be believed
    // by whoever reads it next.
    const role = effectiveRole(person);

    // Mirrored onto the token so a later authorisation check needs no round trip.
    // Best effort: a failure here costs a database read, not access.
    await setRoleClaim(decoded.uid, role).catch(() => undefined);

    const jar = await cookies();
    jar.set(SESSION_COOKIE, cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });

    return Response.json({ id: person.id, email: person.email, role });
  } catch (error) {
    if (error instanceof RosterStoreError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
