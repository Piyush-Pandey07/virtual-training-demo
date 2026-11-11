/**
 * POST, DELETE /api/assignments
 *
 * Who has been asked to attend what. This is the gate: a trainee can open a session
 * only for a deck they have a row here for, checked in the session page and again in
 * `/api/chat`, because the chat route narrates whatever deck id its body names.
 *
 * Only a deck that is approved as it stands can be assigned (AI-39). Removing an
 * assignment needs no approval: taking training away from somebody is always allowed.
 *
 * Both are for company administrators as well as Technavious: assigning approved decks to
 * their own people is the company administrator's job. Both are in the audit history.
 */

import { recordAudit } from '@/lib/audit/log';
import { requireAdmin, unauthorisedResponse } from '@/lib/auth/guard';
import { approvalStateOf, assignmentRefusalFor, deckApprovalFor } from '@/lib/decks/approval';
import { loadStoredDeck } from '@/lib/decks/registry';
import { rosterStore } from '@/lib/roster/registry';
import { RosterStoreError } from '@/lib/roster/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  personId?: string;
  deckId?: string;
  dueAt?: string | null;
}

async function readBody(request: Request): Promise<Body | null> {
  try {
    return (await request.json()) as Body;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();

    const body = await readBody(request);
    if (!body) return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });

    const { personId, deckId } = body;
    if (!personId || !deckId) {
      return Response.json({ error: 'personId and deckId are required.' }, { status: 400 });
    }

    const store = rosterStore(admin.orgId);
    const [person, stored, approval] = await Promise.all([
      store.getPerson(personId),
      loadStoredDeck(admin.orgId, deckId).catch(() => undefined),
      deckApprovalFor(admin.orgId, deckId).catch(() => undefined),
    ]);

    if (!person) return Response.json({ error: 'No such person.' }, { status: 404 });
    if (!stored) return Response.json({ error: 'No such deck.' }, { status: 404 });

    // A draft has not been checked by anybody. Assigning one would put unreviewed,
    // model-generated material in front of a trainee as though it were approved,
    // which is the single thing the review step exists to prevent.
    if (stored.status !== 'published') {
      return Response.json(
        { error: 'This deck is still a draft. Publish it before assigning it to anyone.' },
        { status: 409 },
      );
    }

    // Approved, and approved as it is now. A deck that changed after its approval, or was
    // withdrawn and put back, has not been signed off in the form a trainee would meet.
    const refusal = assignmentRefusalFor(approvalStateOf(approval, stored.record, stored.status));
    if (refusal) return Response.json({ error: refusal }, { status: 409 });

    const dueAt = typeof body.dueAt === 'string' && body.dueAt.trim() ? body.dueAt : null;

    const assignment = await store.assign({ personId, deckId, assignedBy: admin.id, dueAt });
    await recordAudit(admin, {
      action: 'assigned',
      subjectType: 'assignment',
      subjectId: `${personId}__${deckId}`,
      detail: `Assigned "${stored.record.meta.title}" to ${person.email}${dueAt ? `, due ${dueAt}` : ''}`,
    });
    return Response.json(assignment, { status: 201 });
  } catch (error) {
    const refused = unauthorisedResponse(error);
    if (refused) return refused;
    if (error instanceof RosterStoreError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin();

    const body = await readBody(request);
    if (!body?.personId || !body.deckId) {
      return Response.json({ error: 'personId and deckId are required.' }, { status: 400 });
    }

    // The attempt is deliberately left alone. Somebody who did the training and then
    // had it unassigned still did the training.
    await rosterStore(admin.orgId).unassign(body.personId, body.deckId);
    await recordAudit(admin, {
      action: 'unassigned',
      subjectType: 'assignment',
      subjectId: `${body.personId}__${body.deckId}`,
      detail: `Took deck ${body.deckId} away from ${body.personId}`,
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
