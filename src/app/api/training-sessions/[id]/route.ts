/**
 * GET, PATCH, DELETE /api/training-sessions/{id}
 *
 * One trainer-led session: read it, mark attendance, open or close it, or delete one
 * that has not started. Only its facilitator, or an administrator, may do any of it.
 */

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
    return Response.json(await changeSession(person, (await params).id, body));
  } catch (error) {
    return ruleResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const person = await sessionRunner();
  if (person instanceof Response) return person;
  try {
    await removeSession(person, (await params).id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return ruleResponse(error);
  }
}
