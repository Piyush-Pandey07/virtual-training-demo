/**
 * PATCH, DELETE /api/people/{id}
 *
 * Changing somebody's role (company administrator, facilitator or employee), or removing them.
 *
 * Removing somebody deletes their login, their learner profile and their assessment
 * answers at once, and keeps their name, email, completion, attendance, scores and pass or
 * fail for five years after their last use, when the daily retention job deletes them
 * (AI-42). Both changes are in the audit history (AI-40).
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
import { eraseLeaverAnswers } from '@/lib/retention/leaving';
import { recordLeaver } from '@/lib/roster/leavers';
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

    const updated = await store.setRole(id, body.role);
    // A role decides what somebody may see, so every change is in the history (AI-40).
    if (person.role !== body.role) {
      await recordAudit(admin, {
        action: 'role-changed',
        subjectType: 'person',
        subjectId: id,
        detail: `Changed ${person.email} from ${person.role} to ${body.role}`,
      });
    }
    return Response.json(updated);
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
    // Their name and address first, kept with their training record for five years
    // (AI-42), so a failure after this still leaves the record readable. Then the row and
    // their assignments, keeping their attempts: completion is part of the same record,
    // and the daily retention job deletes it with the rest five years after last use.
    await recordLeaver(admin.orgId, leaving, admin.id);
    await roster.removePerson(id, { keepAttempts: true });

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
    // And their assessment answers and feedback comments, which the retention rule deletes
    // with the profile. Their scores, pass or fail, ratings and attendance stay for the
    // five-year record. Best effort: the daily job deletes anything this misses within a
    // year of their last use regardless.
    const erased = await eraseLeaverAnswers(admin.orgId, id).catch(() => null);
    // Recorded whether or not they had one, since the deletion is the decision and the
    // administrator was deliberately not shown what it removed (AI-40).
    await recordAudit(admin, {
      action: 'deleted',
      subjectType: 'profile',
      subjectId: id,
      detail: `Removed ${leaving.email} and any profile they had`,
    });
    await recordAudit(admin, {
      action: 'deleted',
      subjectType: 'person',
      subjectId: id,
      detail: erased
        ? `Removed ${leaving.email} (${leaving.role}): login and profile deleted, answers deleted from ${erased.results} results and ${erased.feedback} feedback; scores, completion and attendance kept for five years`
        : `Removed ${leaving.email} (${leaving.role}): login and profile deleted; their answers could not be deleted now and will be by the daily retention job`,
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
