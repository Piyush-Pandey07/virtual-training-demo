/**
 * PUT /api/training-sessions/{id}/slide
 *
 * The slide the facilitator's run screen is on, kept on the session so reopening the
 * screen carries on there (UAT issue 17). Body: `{ slideId: number }`. Only the session's
 * facilitator, or an administrator, and only while it can still be run.
 *
 * Sent by the run screen once a move has settled, not on every press, and a slide already
 * kept writes nothing. Not in the audit history: it is where the deck is, not a change
 * anybody needs to account for.
 */

import { recordCurrentSlide } from '@/lib/training/service';
import { jsonBody, ruleResponse, sessionRunner } from '@/lib/training/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, { params }: RouteContext) {
  const person = await sessionRunner();
  if (person instanceof Response) return person;
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  try {
    const slideId = await recordCurrentSlide(person, (await params).id, body.slideId);
    return Response.json({ currentSlideId: slideId });
  } catch (error) {
    return ruleResponse(error);
  }
}
