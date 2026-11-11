/**
 * PUT /api/decks/{id}/white-papers
 *
 * Sets which approved white papers the deck may draw on (AI-46):
 *
 *   { "paperIds": ["cooling-best-practice-a1b2c3", ...] }
 *
 * The whole list, in the order chosen. Only an approved paper can be newly attached; one
 * already attached may stay while it waits to be approved again, and is not used until
 * it is. Every attachment and detachment is recorded in the audit history.
 *
 * Technavious only (`checkAdministrator`), as for every deck tool. The deck and the
 * papers are both looked up in the organisation the caller is in, so an id from another
 * customer names nothing and is a 404.
 */

import { checkAdministrator } from '@/lib/auth/guard';
import { readPaperBody, whitePaperRefusal } from '@/lib/white-papers/responses';
import { setDeckWhitePapers } from '@/lib/white-papers/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, { params }: RouteContext) {
  const gate = await checkAdministrator();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await readPaperBody(request);
  if (!body) return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });

  try {
    return Response.json(await setDeckWhitePapers(gate.person, id, body.paperIds));
  } catch (error) {
    const refused = whitePaperRefusal(error);
    if (refused) return refused;
    throw error;
  }
}
