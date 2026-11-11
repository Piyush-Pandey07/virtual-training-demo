/**
 * GET, POST /api/training-sessions
 *
 * Trainer-led sessions. A facilitator sees the ones they run; a company administrator
 * and Technavious see all of the company's. Setting one up assigns its deck to every
 * listed participant, so each can do their own steps on their own device. Setting one up
 * is in the audit history (AI-40).
 */

import { recordAudit } from '@/lib/audit/log';
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
    const session = await createSession(person, body);
    await recordAudit(person, {
      action: 'created',
      subjectType: 'training-session',
      subjectId: session.id,
      detail: `Set up a session on deck ${session.deckId} for ${session.participantIds.length} participants, run by ${session.facilitatorId}${session.scheduledFor ? `, for ${session.scheduledFor}` : ''}`,
    });
    return Response.json(session, { status: 201 });
  } catch (error) {
    return ruleResponse(error);
  }
}
