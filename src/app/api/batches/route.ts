/**
 * GET, POST /api/batches
 *
 * Named groups of participants. A facilitator sees and creates their own; a company
 * administrator and Technavious see and create any, naming the facilitator. Setting one
 * up is in the audit history (AI-40).
 */

import { recordAudit } from '@/lib/audit/log';
import { trainingStore } from '@/lib/training/store';
import { createBatch, visibleBatches } from '@/lib/training/service';
import { jsonBody, ruleResponse, sessionRunner } from '@/lib/training/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const person = await sessionRunner();
  if (person instanceof Response) return person;
  const batches = await trainingStore(person.orgId).listBatches();
  return Response.json({ batches: visibleBatches(person, batches) });
}

export async function POST(request: Request) {
  const person = await sessionRunner();
  if (person instanceof Response) return person;
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  try {
    const batch = await createBatch(person, body);
    await recordAudit(person, {
      action: 'created',
      subjectType: 'batch',
      subjectId: batch.id,
      detail: `Set up batch "${batch.name}" with ${batch.participantIds.length} participants, run by ${batch.facilitatorId}`,
    });
    return Response.json(batch, { status: 201 });
  } catch (error) {
    return ruleResponse(error);
  }
}
