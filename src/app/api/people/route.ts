/**
 * POST /api/people
 *
 * Adds somebody to the roster before they have ever signed in, so training can be
 * assigned to a new starter on their first day rather than after it. When they do
 * sign in, the identity provider's own id replaces the placeholder one and their
 * assignments follow them across.
 *
 * Everybody is added as an employee. The request carries no role, so making somebody a
 * facilitator or a company administrator is always the separate change on
 * /api/people/{id}, which is recorded in its own right.
 *
 * Adding somebody is in the audit history (AI-40, D-02): who was added, with which role
 * and by whom. So is adding an address that is already here, which creates nobody and
 * leaves their role alone but can change their name.
 */

import { recordPersonAudit } from '@/lib/audit/log';
import { requireAdmin, unauthorisedResponse } from '@/lib/auth/guard';
import { rosterStore } from '@/lib/roster/registry';
import { RosterStoreError } from '@/lib/roster/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();

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

    const store = rosterStore(admin.orgId);
    const existing = await store.getPersonByEmail(email);
    const person = await store.upsertPerson({ email, name: body.name?.trim() });
    // Who may sign in and be given training is decided here, so it is in the history
    // beside role changes and removals (D-02). Recorded after the row is written, so the
    // entry names the role they really have, and for an address already here as well,
    // so the history shows that nobody new was made and no role was given.
    await recordPersonAudit(
      admin,
      person,
      existing ? { kind: 'added-again', nameBefore: existing.name } : { kind: 'added' },
    );

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
