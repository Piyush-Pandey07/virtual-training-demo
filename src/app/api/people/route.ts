/**
 * POST /api/people
 *
 * Adds somebody to the roster before they have ever signed in, so training can be
 * assigned to a new starter on their first day rather than after it. When they do
 * sign in, the identity provider's own id replaces the placeholder one and their
 * assignments follow them across.
 */

import { requireAdmin, unauthorisedResponse } from '@/lib/auth/guard';
import { rosterStore } from '@/lib/roster/registry';
import { RosterStoreError } from '@/lib/roster/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    await requireAdmin();

    let body: { email?: string; name?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
    }

    const email = body.email?.trim();
    if (!email || !email.includes('@')) {
      return Response.json({ error: 'An email address is required.' }, { status: 400 });
    }

    const store = rosterStore();
    const existing = await store.getPersonByEmail(email);
    const person = await store.upsertPerson({ email, name: body.name?.trim() });

    return Response.json(person, { status: existing ? 200 : 201 });
  } catch (error) {
    const refused = unauthorisedResponse(error);
    if (refused) return refused;
    if (error instanceof RosterStoreError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
