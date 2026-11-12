/**
 * /api/decks/{id}/lesson-plan (AI-43)
 *
 * POST reads a lesson plan out of text, uploaded or pasted, and returns a draft for the
 * administrator to check, saving nothing. The browser extracts the text from a Word or
 * PDF file itself, as it already does for decks, so no file reaches the server.
 * PUT saves the checked plan on the deck, with how it lines up with the slides.
 * DELETE takes it off.
 *
 * Technavious only (`checkAdministrator`), like every other deck tool, and the deck is
 * read from the organisation the administrator is in. Saving or removing a plan changes
 * what the deck teaches, so it clears the deck's approval, and is in the audit history.
 */

import { checkAdministrator } from '@/lib/auth/guard';
import { classifyThrown } from '@/lib/failures/classify';
import { failurePayload } from '@/lib/failures/respond';
import {
  LessonPlanError,
  readLessonPlan,
  removeLessonPlan,
  saveLessonPlan,
} from '@/lib/lesson-plan/service';
import { LESSON_PLAN_LIMITS } from '@/lib/lesson-plan/types';
import { rateLimited } from '@/lib/limits/rate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Reading prose with the model is one call, and can take a while on a long plan. */
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

function refused(error: unknown): Response | null {
  if (!(error instanceof LessonPlanError)) return null;
  return Response.json(
    { error: error.message, ...(error.problems.length ? { problems: error.problems } : {}) },
    { status: error.status },
  );
}

async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const gate = await checkAdministrator();
  if (!gate.ok) return gate.response;
  // The same allowance as analysing a deck, since this may call the same model.
  const limited = await rateLimited(gate.person, 'analyse');
  if (limited) return limited;

  const { id } = await params;
  const body = await jsonBody(request);
  if (!body || typeof body.text !== 'string') {
    return Response.json({ error: 'Send the lesson plan as text.' }, { status: 400 });
  }
  if (body.text.length > LESSON_PLAN_LIMITS.textChars * 2) {
    return Response.json(
      { error: 'That lesson plan is too long. Send the session flow and outcomes only.' },
      { status: 413 },
    );
  }

  try {
    const read = await readLessonPlan(gate.person, id, {
      text: body.text,
      fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
    });
    return Response.json(read);
  } catch (error) {
    const response = refused(error);
    if (response) return response;
    // The model's own failures: a rate limit, a block, or JSON it could not keep to.
    const failure = await failurePayload(classifyThrown('gemini', error), {
      route: '/api/decks/lesson-plan',
      person: gate.person,
      deckId: id,
    });
    return Response.json(failure, { status: failure.code === 'busy' ? 503 : 502 });
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  const gate = await checkAdministrator();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await jsonBody(request);
  if (!body) return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });

  try {
    const plan = await saveLessonPlan(gate.person, id, body.plan);
    return Response.json({ plan });
  } catch (error) {
    const response = refused(error);
    if (response) return response;
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const gate = await checkAdministrator();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  try {
    const removed = await removeLessonPlan(gate.person, id);
    return Response.json({ removed });
  } catch (error) {
    const response = refused(error);
    if (response) return response;
    throw error;
  }
}
