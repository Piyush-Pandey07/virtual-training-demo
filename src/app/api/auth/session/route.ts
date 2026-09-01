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

import {
  effectiveRole,
  emailAllowed,
  isBootstrapAdmin,
  selfEnrolmentAllowed,
} from '@/lib/auth/roles';
import { SESSION_COOKIE } from '@/lib/auth/session';
import {
  createSessionCookie,
  firebaseAdminConfigured,
  SESSION_TTL_MS,
  setRoleClaim,
  verifySessionCookie,
} from '@/lib/firebase/admin';
import { orgStore } from '@/lib/orgs/registry';
import { rosterStore } from '@/lib/roster/registry';
import { RosterStoreError } from '@/lib/roster/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  if (!emailAllowed(email)) {
    return refuse('That account is not part of this organisation.');
  }

  try {
    const orgs = orgStore();

    // Which customer, before a single row is read. Two ways to know, in this order:
    // somebody who has signed in before is remembered in the directory, and anybody
    // else is placed by the domain of the address they are signing in with.
    //
    // The directory comes first so that moving somebody between customers sticks: if
    // the domain won, an administrator's move would be undone by the next sign-in.
    const orgId =
      (await orgs.orgIdForUid(decoded.uid).catch(() => undefined)) ??
      (await orgs.orgIdForEmail(email).catch(() => undefined));

    if (!orgId) {
      // No customer holds this address's domain and nobody has placed them. Said the
      // same way as an unknown account, because from outside they are the same thing
      // and the difference is not something a stranger should be able to probe for.
      return refuse(
        'There is no training account for that address. Ask whoever runs your training to add you.',
      );
    }

    const organisation = await orgs.get(orgId).catch(() => undefined);
    if (organisation?.status === 'suspended') {
      return refuse('Training for this organisation is currently suspended.');
    }

    const store = rosterStore(orgId);

    // Known here already, named as an administrator by the deployment, or on a company
    // domain that admits its own people. Anything else is a Firebase account nobody
    // added here, and it gets no session.
    //
    // The self-enrolled case is safe here and only here: the verified-address check
    // above has already run, so reaching this line means Firebase saw them follow a
    // link sent to that mailbox. Moving this check above that one would turn it into
    // open registration for anybody who can spell the domain.
    const known = await store.getPersonByEmail(email);
    if (!known && !isBootstrapAdmin(email) && !selfEnrolmentAllowed(email)) {
      return refuse(
        'There is no training account for that address. Ask whoever runs your training to add you.',
      );
    }

    // Refreshes the name and the last-seen stamp, and adopts the Firebase uid for
    // somebody an administrator added by hand before they had ever signed in. The
    // role is never taken from here, so signing in cannot restore access an
    // administrator has just removed. Neither is the organisation, for the same
    // reason and a sharper one: an organisation signing in could write is a way to
    // walk into another customer's data by claiming to belong there.
    const person = await store.upsertPerson({
      id: decoded.uid,
      email,
      name: typeof decoded.name === 'string' ? decoded.name : undefined,
      orgId,
    });

    // Remembered so the next sign-in knows the answer without asking the domain, and
    // so a person whose address is not on any claimed domain -- an administrator on a
    // personal address, say -- is still found.
    await orgs
      .remember({ uid: decoded.uid, orgId, emailKey: person.emailKey })
      .catch(() => undefined);

    // The role that actually applies, which is not always the stored one: an address
    // named in AUTH_ADMIN_EMAILS is an administrator whatever the row says. Reported
    // and mirrored as the effective one, because a response that says "trainee" for
    // somebody every page treats as an administrator is a lie that will be believed
    // by whoever reads it next.
    const role = effectiveRole(person);

    // Mirrored onto the token so a later authorisation check needs no round trip.
    // Best effort: a failure here costs a database read, not access -- `currentPerson`
    // falls back to the directory when the claim is missing.
    await setRoleClaim(decoded.uid, role, orgId).catch(() => undefined);

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
