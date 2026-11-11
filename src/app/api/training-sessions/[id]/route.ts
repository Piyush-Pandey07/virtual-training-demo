/**
 * GET, PATCH, DELETE /api/training-sessions/{id}
 *
 * One trainer-led session: read it, mark attendance, open or close it, or delete one
 * that has not started. Only its facilitator, or an administrator, may do any of it.
 *
 * Opening, closing and deleting are in the audit history here (AI-40). Attendance edits
 * and cancelling are recorded inside src/lib/training/, where the change is made, so they
 * are not recorded twice.
 */

import { recordAudit } from '@/lib/audit/log';
import { changeSession, removeSession, sessionFor } from '@/lib/training/service';
import { jsonBody, ruleResponse, sessionRunner } from '@/lib/training/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const person = await sessionRunner();
  if (person instanceof Response) return person;
  try {
    return Response.json(await sessionFor(person, (await params).id));
  } catch (error) {
    return ruleResponse(error);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const person = await sessionRunner();
  if (person instanceof Response) return person;
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  try {
    const { id } = await params;
    const before = await sessionFor(person, id);
    const session = await changeSession(person, id, body);
    if (session.status !== before.status && (body.status === 'open' || body.status === 'closed')) {
      await recordAudit(person, {
        action: 'updated',
        subjectType: 'training-session',
        subjectId: id,
        detail: `${body.status === 'open' ? 'Opened' : 'Closed'} the session on deck ${session.deckId}`,
      });
    }
    return Response.json(session);
  } catch (error) {
    return ruleResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const person = await sessionRunner();
  if (person instanceof Response) return person;
  try {
    const { id } = await params;
    const session = await sessionFor(person, id);
    await removeSession(person, id);
    await recordAudit(person, {
      action: 'deleted',
      subjectType: 'training-session',
      subjectId: id,
      detail: `Deleted the session on deck ${session.deckId}, which had not started`,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return ruleResponse(error);
  }
}
