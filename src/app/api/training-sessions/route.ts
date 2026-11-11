/**
 * GET, POST /api/training-sessions
 *
 * Trainer-led sessions. A facilitator sees the ones they run; a company administrator
 * and Technavious see all of the company's. Setting one up assigns its deck to every
 * listed participant, so each can do their own steps on their own device.
 */

import { trainingStore } from '@/lib/training/store';
import { createSession, visibleSessions } from '@/lib/training/service';
import { jsonBody, ruleResponse, sessionRunner } from '@/lib/training/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const person = await sessionRunner();
  if (person instanceof Response) return person;
  const sessions = await trainingStore(person.orgId).listSessions();
  return Response.json({ sessions: visibleSessions(person, sessions) });
}

export async function POST(request: Request) {
  const person = await sessionRunner();
  if (person instanceof Response) return person;
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  try {
    return Response.json(await createSession(person, body), { status: 201 });
  } catch (error) {
    return ruleResponse(error);
  }
}
