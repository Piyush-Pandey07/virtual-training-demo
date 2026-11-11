/**
 * POST /api/decks/{id}/approval
 *
 * Approves the deck as it stands (BRD v2.3, AI-39), which is what lets it be assigned.
 * Only the deck approver may: the people in DECK_APPROVERS, or every Technavious
 * administrator while that list is empty. Anybody else is told so, rather than given a
 * 404, since they can already see the deck and its approval status on its page.
 *
 * There is no route to un-approve. An approval clears itself when the deck changes or
 * is withdrawn, which is the only reason anybody would want to take one back.
 */

import { checkAdmin } from '@/lib/auth/guard';
import { ApprovalError, approveDeck } from '@/lib/decks/approval';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: RouteContext) {
  const gate = await checkAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  try {
    const approval = await approveDeck(gate.person, id);
    return Response.json({ approval });
  } catch (error) {
    if (error instanceof ApprovalError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
