/**
 * POST, DELETE /api/auth/session
 *
 * Turning a Firebase ID token into a session cookie, and clearing it again.
 *
 * This is the only place an ID token is accepted, and the only place the person
 * behind it is decided. Everything downstream reads the cookie.
 *
 * The tenant check here is what makes this authentication rather than a login page.
 * Checking that an address ends in the company domain would not be: the address is a
 * claim the app would be choosing to believe. The `tid` claim is bound to the
 * Microsoft tenant that issued the token, and Firebase has already verified the
 * signature over it by the time this runs.
 */

import { cookies } from 'next/headers';

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

/** The Microsoft tenant whose accounts may sign in. */
function allowedTenant(): string | undefined {
  return process.env.MICROSOFT_TENANT_ID?.trim() || undefined;
}

/** Domains an address may end in, when one is configured. Defence in depth. */
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

  const tenant = allowedTenant();
  const claimedTenant =
    typeof decoded.firebase?.sign_in_attributes?.tid === 'string'
      ? decoded.firebase.sign_in_attributes.tid
      : undefined;

  if (tenant && claimedTenant !== tenant) {
    return refuse('That account is not part of this organisation.');
  }

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
    // First sight creates them as a trainee; after that this only refreshes the name
    // and the last-seen stamp. The role is never taken from here, so signing in
    // cannot restore access an administrator has just removed.
    const person = await rosterStore().upsertPerson({
      id: decoded.uid,
      email,
      name: typeof decoded.name === 'string' ? decoded.name : undefined,
    });

    // Mirrored onto the token so a later authorisation check needs no round trip.
    // Best effort: a failure here costs a database read, not access.
    await setRoleClaim(decoded.uid, person.role).catch(() => undefined);

    const jar = await cookies();
    jar.set(SESSION_COOKIE, cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
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
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
