/**
 * POST /api/white-papers/{id}/approval
 *
 * Approves the white paper as it stands (AI-46), which is what lets a deck draw on it.
 * Only the deck approver may: the people in DECK_APPROVERS, or every Technavious
 * administrator while that list is empty. A Technavious administrator who is not the
 * approver is told so; anybody else gets a 404.
 *
 * There is no route to un-approve, as for decks. An approval clears itself when the
 * paper's text or title changes or it is withdrawn.
 */

import { checkAdministrator } from '@/lib/auth/guard';
import { notFound, whitePaperRefusal } from '@/lib/white-papers/responses';
import {
  approveWhitePaper,
  isUsableWhitePaperId,
  whitePaperSummaryOf,
} from '@/lib/white-papers/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: RouteContext) {
  const gate = await checkAdministrator();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!isUsableWhitePaperId(id)) return notFound();

  try {
    return Response.json({
      paper: whitePaperSummaryOf(await approveWhitePaper(gate.person, id)),
    });
  } catch (error) {
    const refused = whitePaperRefusal(error);
    if (refused) return refused;
    throw error;
  }
}
