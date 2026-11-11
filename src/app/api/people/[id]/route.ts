/**
 * PATCH, DELETE /api/people/{id}
 *
 * Changing somebody's role (company administrator, facilitator or employee), or removing them.
 *
 * An administrator cannot demote themselves. That is not politeness: with one admin
 * role and no seat above it, the last administrator demoting themselves would leave
 * a deployment nobody could administer, recoverable only by an environment variable
 * and a redeploy. Refusing the click is cheaper than explaining the recovery.
 */

import { recordAudit } from '@/lib/audit/log';
import { requireAdmin, unauthorisedResponse } from '@/lib/auth/guard';
import { isPlatformAdmin } from '@/lib/auth/roles';
import { deleteAccount, revokeSessions } from '@/lib/firebase/admin';
import { removeFromTraining } from '@/lib/training/service';
import { deleteProfile } from '@/lib/profiles/store';
import { rosterStore } from '@/lib/roster/registry';
import { RosterStoreError } from '@/lib/roster/store';
import { ROLES, type Role } from '@/lib/roster/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;

    let body: { role?: Role };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
    }

    if (!body.role || !ROLES.includes(body.role)) {
      return Response.json(
        { error: "role must be 'admin', 'facilitator' or 'trainee'." },
        { status: 400 },
      );
    }

    if (id === admin.id && body.role !== 'admin') {
      return Response.json(
        { error: 'You cannot remove your own access. Ask another administrator to do it.' },
        { status: 409 },
      );
    }

    const store = rosterStore(admin.orgId);
    const person = await store.getPerson(id);
    if (!person) return Response.json({ error: 'No such person.' }, { status: 404 });

    if (body.role !== 'admin' && isPlatformAdmin(person.email)) {
      // Their address is in AUTH_ADMIN_EMAILS, so the stored role is not what decides
      // it. Saying so beats a click that appears to work and changes nothing.
      return Response.json(
        {
          error:
            'This address is listed as an administrator in the deployment configuration, so the change would not take effect. Remove it from AUTH_ADMIN_EMAILS first.',
        },
        { status: 409 },
      );
    }

    return Response.json(await store.setRole(id, body.role));
  } catch (error) {
    const refused = unauthorisedResponse(error);
    if (refused) return refused;
    if (error instanceof RosterStoreError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;

    if (id === admin.id) {
      return Response.json({ error: 'You cannot remove yourself.' }, { status: 409 });
    }

    // Read first for their address, which finds a profile uploaded before they signed
    // in and still filed under the placeholder id they had then.
    const roster = rosterStore(admin.orgId);
    const leaving = await roster.getPerson(id).catch(() => undefined);
    // Only somebody in this administrator's own organisation. Without this, any uid that
    // reached a company administrator (a session's createdBy, say) would have its login
    // deleted, a Technavious member of staff's included.
    if (!leaving) return Response.json({ error: 'No such person.' }, { status: 404 });
    if (isPlatformAdmin(leaving.email)) {
      return Response.json(
        {
          error:
            'This address is listed as an administrator in the deployment configuration, so it cannot be removed here.',
        },
        { status: 409 },
      );
    }
    await roster.removePerson(id);

    // Their login goes too (AI-42, RUL-8), not only their sessions. Losing the roster
    // row is already enough to refuse them on the next request, since every request
    // re-reads it, but the BRD asks for the account itself to be deleted. If deleting
    // fails, their tokens are at least revoked, so nothing they hold keeps working.
    await deleteAccount(id).catch(() => revokeSessions(id).catch(() => undefined));

    // Out of every batch, and every session that has not happened yet. A session that
    // ran keeps them on its list: attendance is a record kept for five years (RUL-7).
    await removeFromTraining(admin, id).catch(() => undefined);

    // And their learner profile, if they gave one. The notice they agreed to says it
    // goes when they leave, and nobody could reach it afterwards to delete it, not even
    // them. Deleted unread, and whatever PROFILES_ENABLED says, since one saved while it
    // was on still exists. The administrator removing them never sees it.
    await deleteProfile({ id, orgId: admin.orgId, emailKey: leaving.emailKey }).catch(
      () => undefined,
    );
    // Recorded whether or not they had one, since the deletion is the decision and the
    // administrator was deliberately not shown what it removed (AI-40).
    await recordAudit(admin, {
      action: 'deleted',
      subjectType: 'profile',
      subjectId: id,
      detail: `Removed ${leaving.email} and any profile they had`,
    });

    return Response.json({ ok: true });
  } catch (error) {
    const refused = unauthorisedResponse(error);
    if (refused) return refused;
    if (error instanceof RosterStoreError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
