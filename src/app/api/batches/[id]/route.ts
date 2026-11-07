/**
 * PATCH, DELETE /api/batches/{id}
 *
 * Renaming a batch, changing who is in it or who runs it, or deleting it. A session
 * already set up from a batch keeps the list it was given.
 */

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
    return Response.json(await updateBatch(person, (await params).id, body));
  } catch (error) {
    return ruleResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const person = await sessionRunner();
  if (person instanceof Response) return person;
  try {
    await removeBatch(person, (await params).id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return ruleResponse(error);
  }
}
