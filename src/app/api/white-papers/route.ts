/**
 * POST /api/white-papers   adds a white paper to the customer's library (AI-46)
 *
 *   { "title": "...", "summary": "...", "fileName": "cooling.pdf", "pages": ["...", ...] }
 *
 * The browser reads the PDF's text, page by page, with the same reader the deck upload
 * uses, and sends that; the server cuts it into passages and keeps them. The original
 * PDF follows in a second request to /api/white-papers/{id}/original, because one
 * request is capped at 4.5 MB and a paper's text alone can be most of that.
 *
 * Technavious only (`checkAdministrator`): anybody else gets a 404, as for every
 * Technavious tool. The paper starts unapproved, and no deck draws on it until it is
 * approved and attached.
 */

import { checkAdministrator } from '@/lib/auth/guard';
import { readPaperBody, whitePaperRefusal } from '@/lib/white-papers/responses';
import { uploadWhitePaper, whitePaperSummaryOf } from '@/lib/white-papers/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Two writes, and cutting a long paper into passages. */
export const maxDuration = 30;

export async function POST(request: Request) {
  const gate = await checkAdministrator();
  if (!gate.ok) return gate.response;

  const body = await readPaperBody(request);
  if (!body) return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });

  try {
    const paper = await uploadWhitePaper(gate.person, body);
    return Response.json({ paper: whitePaperSummaryOf(paper) }, { status: 201 });
  } catch (error) {
    const refused = whitePaperRefusal(error);
    if (refused) return refused;
    throw error;
  }
}
