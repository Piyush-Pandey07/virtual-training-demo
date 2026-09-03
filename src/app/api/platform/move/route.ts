/**
 * POST /api/platform/move
 *
 * Moves somebody from one customer to another.
 *
 * Technavious only. This is the one operation that touches two customers at once, and
 * it exists because people get put in the wrong one: a contractor provisioned against
 * the wrong company, or an address whose domain resolved somewhere unexpected.
 *
 * Their training records stay with the customer that delivered the training. See
 * `movePerson` for why that is the right way round.
 */

import { requireUser, unauthorisedResponse } from '@/lib/auth/guard';
import { isPlatformAdmin } from '@/lib/auth/roles';
import { movePerson } from '@/lib/orgs/lifecycle';
import { orgStore } from '@/lib/orgs/registry';
import { OrgStoreError } from '@/lib/orgs/store';
import { rosterStore } from '@/lib/roster/registry';
import { emailKeyOf } from '@/lib/roster/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const staff = await requireUser();
    if (!isPlatformAdmin(staff.email)) {
      return Response.json({ error: 'Not found.' }, { status: 404 });
    }

    let body: { email?: string; toOrgId?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
    }

    const email = body.email?.trim();
    const toOrgId = body.toOrgId?.trim();
    if (!email || !toOrgId) {
      return Response.json({ error: 'email and toOrgId are required.' }, { status: 400 });
    }

    // Found through the directory, which is the only thing that can answer "which
    // customer holds this address" without already knowing the answer.
    const orgs = orgStore();
    const fromOrgId = await orgs.orgIdHolding(emailKeyOf(email));
    if (!fromOrgId) {
      return Response.json({ error: `${email} does not belong to any customer.` }, { status: 404 });
    }

    if (fromOrgId === toOrgId) {
      return Response.json({ error: `${email} is already in "${toOrgId}".` }, { status: 409 });
    }

    const person = await rosterStore(fromOrgId).getPersonByEmail(email);
    if (!person) {
      return Response.json(
        { error: `${email} is in the directory but not on "${fromOrgId}"'s roster.` },
        { status: 409 },
      );
    }

    await movePerson(person.id, fromOrgId, toOrgId);

    console.warn(`[platform] ${staff.email} moved ${email} from "${fromOrgId}" to "${toOrgId}"`);

    return Response.json({ email, from: fromOrgId, to: toOrgId });
  } catch (error) {
    const refused = unauthorisedResponse(error);
    if (refused) return refused;
    if (error instanceof OrgStoreError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
