/**
 * GET, POST /api/batches
 *
 * Named groups of participants. A facilitator sees and creates their own; a company
 * administrator and Technavious see and create any, naming the facilitator.
 */

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
    return Response.json(await createBatch(person, body), { status: 201 });
  } catch (error) {
    return ruleResponse(error);
  }
}
