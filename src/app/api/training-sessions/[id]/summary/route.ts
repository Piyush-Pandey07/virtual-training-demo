/**
 * GET /api/training-sessions/{id}/summary
 *
 * The closure summary of one trainer-led session as an Excel workbook (AI-33):
 * attendance, joined late included, assessment results with pass or fail, and feedback
 * given, with the session's times in India time. Only the session's facilitator,
 * administrators and the company administrator can download it, and each download is
 * recorded in the audit history, since the file carries people's results out of the app.
 */

import { recordAudit } from '@/lib/audit/log';
import { loadDeck } from '@/lib/decks/registry';
import { rosterStore } from '@/lib/roster/registry';
import { ruleResponse, sessionRunner } from '@/lib/training/route-helpers';
import { closureSummary, summaryWorkbook } from '@/lib/training/summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const person = await sessionRunner();
  if (person instanceof Response) return person;
  try {
    const summary = await closureSummary(person, (await params).id);
    const [deck, facilitator] = await Promise.all([
      loadDeck(person.orgId, summary.session.deckId).catch(() => undefined),
      rosterStore(person.orgId)
        .getPerson(summary.session.facilitatorId)
        .catch(() => undefined),
    ]);
    const title = deck?.meta.title ?? 'Deck removed';
    const name = `${title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session'}-summary.xlsx`;
    const workbook = await summaryWorkbook(
      summary,
      title,
      facilitator ? facilitator.name || facilitator.email : 'Removed',
    );
    await recordAudit(person, {
      action: 'downloaded',
      subjectType: 'training-session',
      subjectId: summary.session.id,
      detail: `Downloaded the closure summary of ${summary.session.deckId} (${summary.rows.length} participants)`,
    });
    return new Response(new Uint8Array(workbook), {
      headers: {
        'Content-Type': XLSX,
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return ruleResponse(error);
  }
}
