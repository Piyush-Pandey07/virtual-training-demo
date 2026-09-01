/**
 * POST, DELETE /api/platform
 *
 * Which customer Technavious staff are looking at.
 *
 * POST with an organisation id starts viewing that customer; DELETE goes back to
 * Technavious's own. Nothing else about the request matters — the store the rest of
 * the app builds is made from whoever is signed in, so this only has to record the
 * choice, and `actingOrgId` re-checks who is asking every time it is read.
 *
 * Refuses anybody who is not platform staff, with a 404 rather than a 403. A customer
 * administrator should not be able to learn that a way of viewing other customers
 * exists, let alone which ones do.
 */

import { cookies } from 'next/headers';

import { ACTING_ORG_COOKIE } from '@/lib/auth/acting-org';
import { requireUser, unauthorisedResponse } from '@/lib/auth/guard';
import { isPlatformAdmin } from '@/lib/auth/roles';
import { orgStore } from '@/lib/orgs/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const NOT_FOUND = Response.json({ error: 'Not found.' }, { status: 404 });

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    // Deliberately short. Looking inside a customer is something done for a support
    // question, and a session that quietly stayed pointed at somebody else's company
    // for a fortnight is how a screenshot ends up in the wrong ticket.
    maxAge: 60 * 60 * 8,
  };
}

export async function POST(request: Request) {
  try {
    const person = await requireUser();
    if (!isPlatformAdmin(person.email)) return NOT_FOUND;

    let body: { orgId?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
    }

    const orgId = body.orgId?.trim();
    if (!orgId) return Response.json({ error: 'orgId is required.' }, { status: 400 });

    // Checked here as well as when the cookie is read. Setting a cookie naming a
    // customer that does not exist would look like it worked and then silently do
    // nothing, which is a worse way to find out than being told now.
    const organisation = await orgStore().get(orgId);
    if (!organisation) return Response.json({ error: 'No such customer.' }, { status: 404 });

    const jar = await cookies();
    jar.set(ACTING_ORG_COOKIE, organisation.id, cookieOptions());

    return Response.json({ orgId: organisation.id, name: organisation.name });
  } catch (error) {
    const refused = unauthorisedResponse(error);
    if (refused) return refused;
    throw error;
  }
}

export async function DELETE() {
  try {
    const person = await requireUser();
    if (!isPlatformAdmin(person.email)) return NOT_FOUND;

    const jar = await cookies();
    jar.delete(ACTING_ORG_COOKIE);

    return Response.json({ ok: true });
  } catch (error) {
    const refused = unauthorisedResponse(error);
    if (refused) return refused;
    throw error;
  }
}
