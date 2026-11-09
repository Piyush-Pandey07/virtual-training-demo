/**
 * POST /api/assessments
 *
 * A participant submits their pre or post-session assessment (BRD v2.3: AI-04, AI-29).
 *
 * What the browser is trusted with is which option it chose for each question, and which
 * version of the paper it was shown. Who is answering comes from the session, the marking
 * happens here against the bank, which never left the server, and the result is written
 * once: a second submission is refused by the store, not by the page hiding a button.
 *
 * The response is the score and what it means, never which answers were right, so the
 * answer key cannot be collected one participant at a time.
 */

import { checkUser } from '@/lib/auth/guard';
import { refusalResponse } from '@/lib/assessments/responses';
import { summaryOf } from '@/lib/assessments/scoring';
import { submitAssessment } from '@/lib/assessments/service';
import { isBankKind } from '@/lib/assessments/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A few reads and one write. Nothing here waits on a model. */
export const maxDuration = 15;

interface Body {
  deckId?: unknown;
  kind?: unknown;
  version?: unknown;
  answers?: unknown;
  sessionId?: unknown;
}

export async function POST(request: Request) {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const deckId = typeof body.deckId === 'string' ? body.deckId.trim() : '';
  if (!deckId) return Response.json({ error: 'deckId is required.' }, { status: 400 });
  if (!isBankKind(body.kind)) {
    return Response.json({ error: 'kind must be "pre" or "post".' }, { status: 400 });
  }
  if (typeof body.version !== 'string' || !body.version) {
    return Response.json({ error: 'version is required.' }, { status: 400 });
  }
  if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) {
    return Response.json({ error: 'answers must be an object.' }, { status: 400 });
  }
  const sessionId =
    typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : null;

  try {
    const result = await submitAssessment(gate.person, {
      deckId,
      kind: body.kind,
      version: body.version,
      answers: body.answers as Record<string, unknown>,
      sessionId,
    });
    return Response.json({ result: summaryOf(result) });
  } catch (error) {
    const refused = refusalResponse(error);
    if (refused) return refused;
    throw error;
  }
}
