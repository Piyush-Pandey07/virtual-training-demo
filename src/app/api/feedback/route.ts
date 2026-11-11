/**
 * POST /api/feedback
 *
 * A participant's feedback on a session they attended (BRD v2.3: AI-31). Once per deck,
 * or once per trainer-led session when one is named, and after the post-session
 * assessment when the deck has one. The service holds every one of those rules; this
 * route only reads the body.
 */

import { checkUser } from '@/lib/auth/guard';
import { refusalResponse } from '@/lib/assessments/responses';
import { submitFeedback } from '@/lib/assessments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A few reads and one write. */
export const maxDuration = 15;

interface Body {
  deckId?: unknown;
  sessionId?: unknown;
  questionSetId?: unknown;
  ratings?: unknown;
  comments?: unknown;
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
  const sessionId =
    typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : null;

  try {
    const record = await submitFeedback(gate.person, {
      deckId,
      sessionId,
      questionSetId: typeof body.questionSetId === 'string' ? body.questionSetId : '',
      ratings: body.ratings,
      comments: body.comments,
    });
    return Response.json({ submittedAt: record.submittedAt });
  } catch (error) {
    const refused = refusalResponse(error);
    if (refused) return refused;
    throw error;
  }
}
