/**
 * PATCH  /api/white-papers/{id}   changes a white paper (AI-46)
 * DELETE /api/white-papers/{id}   removes it, its text and its original, from every deck
 *
 * Technavious only; anybody else gets a 404. PATCH says what it is doing:
 *
 *   { "action": "edit", "title": "...", "summary": "..." }     a new title needs approving again
 *   { "action": "replace", "fileName": "...", "pages": [...] } the next version of its text
 *   { "action": "withdraw" }                                   no deck draws on it
 *   { "action": "reinstate" }                                  back in use, to be approved again
 *
 * The paper is looked up in the organisation the caller is in, so an id from another
 * customer names nothing and is a 404.
 */

import { checkAdministrator } from '@/lib/auth/guard';
import { notFound, readPaperBody, whitePaperRefusal } from '@/lib/white-papers/responses';
import {
  deleteWhitePaper,
  editWhitePaper,
  isUsableWhitePaperId,
  replaceWhitePaperText,
  setWhitePaperWithdrawn,
  whitePaperSummaryOf,
} from '@/lib/white-papers/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const gate = await checkAdministrator();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!isUsableWhitePaperId(id)) return notFound();
  const body = await readPaperBody(request);
  if (!body) return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });

  try {
    switch (body.action) {
      case 'edit':
        return Response.json({
          paper: whitePaperSummaryOf(await editWhitePaper(gate.person, id, body)),
        });
      case 'replace':
        return Response.json({
          paper: whitePaperSummaryOf(await replaceWhitePaperText(gate.person, id, body)),
        });
      case 'withdraw':
      case 'reinstate':
        return Response.json({
          paper: whitePaperSummaryOf(
            await setWhitePaperWithdrawn(gate.person, id, body.action === 'withdraw'),
          ),
        });
      default:
        return Response.json(
          { error: 'action must be "edit", "replace", "withdraw" or "reinstate".' },
          { status: 400 },
        );
    }
  } catch (error) {
    const refused = whitePaperRefusal(error);
    if (refused) return refused;
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const gate = await checkAdministrator();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!isUsableWhitePaperId(id)) return notFound();

  try {
    return Response.json(await deleteWhitePaper(gate.person, id));
  } catch (error) {
    const refused = whitePaperRefusal(error);
    if (refused) return refused;
    throw error;
  }
}
