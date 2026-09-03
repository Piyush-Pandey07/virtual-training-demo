/**
 * PATCH, DELETE /api/platform/customers/{id}
 *
 * Managing a customer: suspending them, capping their month, and ending the
 * relationship entirely.
 *
 * Technavious only, and a 404 for everybody else. A customer administrator should not
 * learn that these exist, and certainly not that other customers do.
 */

import { requireUser, unauthorisedResponse } from '@/lib/auth/guard';
import { isPlatformAdmin } from '@/lib/auth/roles';
import { purge, resume, suspend } from '@/lib/orgs/lifecycle';
import { orgStore } from '@/lib/orgs/registry';
import { OrgStoreError } from '@/lib/orgs/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Deleting a customer walks every deck, every rendered slide and four collections.
// A small customer is quick; the limit is here for one that is not.
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const NOT_FOUND = Response.json({ error: 'Not found.' }, { status: 404 });

async function platformStaff(): Promise<Response | null> {
  const person = await requireUser();
  return isPlatformAdmin(person.email) ? null : NOT_FOUND;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const refused = await platformStaff();
    if (refused) return refused;

    const { id } = await params;

    let body: { status?: unknown; sessionsPerMonth?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
    }

    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'suspended') {
        return Response.json({ error: "status must be 'active' or 'suspended'." }, { status: 400 });
      }
      if (body.status === 'suspended') await suspend(id);
      else await resume(id);
    }

    if (body.sessionsPerMonth !== undefined) {
      // Null is uncapped, which is a real setting rather than an absent one, so it has
      // to be distinguishable from "leave this alone" above.
      const cap = body.sessionsPerMonth;
      const valid = cap === null || (typeof cap === 'number' && Number.isInteger(cap) && cap >= 0);
      if (!valid) {
        return Response.json(
          { error: 'sessionsPerMonth must be a whole number of sessions, or null for no cap.' },
          { status: 400 },
        );
      }
      await orgStore().setLimits(id, { sessionsPerMonth: cap as number | null });
    }

    const organisation = await orgStore().get(id);
    if (!organisation) return Response.json({ error: 'No such customer.' }, { status: 404 });

    return Response.json({ customer: organisation });
  } catch (error) {
    const refused = unauthorisedResponse(error);
    if (refused) return refused;
    if (error instanceof OrgStoreError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const refused = await platformStaff();
    if (refused) return refused;

    const { id } = await params;

    // The customer's own id, typed back. There is no undo and nothing is archived, so
    // the confirmation is the identifier rather than a yes: a mis-aimed click cannot
    // produce it, and neither can a request replayed against the wrong customer.
    let body: { confirm?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
    }

    if (body.confirm !== id) {
      return Response.json(
        { error: `To delete this customer, send its id as "confirm". Nothing was changed.` },
        { status: 400 },
      );
    }

    const report = await purge(id);
    // Worth a line in the log. This is the one action in the product that destroys a
    // customer's records, and "who ran it and when" is the first question afterwards.
    const person = await requireUser();
    console.warn(`[platform] ${person.email} deleted customer "${id}": ${JSON.stringify(report)}`);

    return Response.json({ deleted: report });
  } catch (error) {
    const refused = unauthorisedResponse(error);
    if (refused) return refused;
    if (error instanceof OrgStoreError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
