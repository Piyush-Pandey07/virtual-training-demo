/**
 * GET /api/training-sessions/{id}/summary
 *
 * The closure summary of one trainer-led session as a spreadsheet (AI-33): attendance,
 * assessment results with pass or fail, and feedback given. Only the session's
 * facilitator, administrators and the company administrator can download it.
 */

import { loadDeck } from '@/lib/decks/registry';
import { ruleResponse, sessionRunner } from '@/lib/training/route-helpers';
import { closureSummary, summaryCsv } from '@/lib/training/summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const person = await sessionRunner();
  if (person instanceof Response) return person;
  try {
    const summary = await closureSummary(person, (await params).id);
    const deck = await loadDeck(person.orgId, summary.session.deckId).catch(() => undefined);
    const title = deck?.meta.title ?? 'Deck removed';
    const name = `${title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session'}-summary.csv`;
    return new Response(summaryCsv(summary, title), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return ruleResponse(error);
  }
}
