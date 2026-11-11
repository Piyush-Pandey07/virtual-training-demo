/**
 * POST /api/training-sessions/{id}/participants
 *
 * Adds people to a session that has not finished, open ones included, so somebody who
 * turns up unlisted can join late (AI-26). Body: `{ participantIds: string[] }`. Only an
 * administrator decides who is in a session; nobody is removed this way.
 */

import { addParticipants } from '@/lib/training/service';
import { jsonBody, ruleResponse, sessionRunner } from '@/lib/training/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  const person = await sessionRunner();
  if (person instanceof Response) return person;
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  try {
    return Response.json(await addParticipants(person, (await params).id, body));
  } catch (error) {
    return ruleResponse(error);
  }
}
