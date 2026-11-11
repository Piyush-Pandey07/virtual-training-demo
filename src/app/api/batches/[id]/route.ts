/**
 * PATCH, DELETE /api/batches/{id}
 *
 * Renaming a batch, changing who is in it or who runs it, or deleting it. A session
 * already set up from a batch keeps the list it was given. Both are in the audit
 * history (AI-40).
 */

import { recordAudit } from '@/lib/audit/log';
import { removeBatch, updateBatch } from '@/lib/training/service';
import { jsonBody, ruleResponse, sessionRunner } from '@/lib/training/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const person = await sessionRunner();
  if (person instanceof Response) return person;
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  try {
    const batch = await updateBatch(person, (await params).id, body);
    const changed = ['name', 'facilitatorId', 'participantIds'].filter((field) => field in body);
    await recordAudit(person, {
      action: 'updated',
      subjectType: 'batch',
      subjectId: batch.id,
      detail: `Changed batch "${batch.name}" (${changed.join(', ') || 'nothing'}): now ${batch.participantIds.length} participants, run by ${batch.facilitatorId}`,
    });
    return Response.json(batch);
  } catch (error) {
    return ruleResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const person = await sessionRunner();
  if (person instanceof Response) return person;
  try {
    const { id } = await params;
    await removeBatch(person, id);
    await recordAudit(person, {
      action: 'deleted',
      subjectType: 'batch',
      subjectId: id,
      detail: 'Deleted the batch',
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return ruleResponse(error);
  }
}
