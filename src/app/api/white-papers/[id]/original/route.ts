/**
 * GET and PUT /api/white-papers/{id}/original
 *
 * The PDF a white paper's text was read from (AI-46). Kept so whoever approves a paper
 * can open exactly what was uploaded. PUT is the second half of an upload, sent as
 * `application/pdf` once the text has been accepted; GET opens it.
 *
 * Technavious only, both ways; anybody else gets a 404. Kept only where file storage is
 * configured, and only up to 4 MB, inside the platform's 4.5 MB request cap; otherwise
 * the paper keeps its text alone and its page says so.
 */

import { checkAdministrator } from '@/lib/auth/guard';
import { notFound, whitePaperRefusal } from '@/lib/white-papers/responses';
import {
  isUsableWhitePaperId,
  keepWhitePaperOriginal,
  readWhitePaperOriginal,
  whitePaperSummaryOf,
} from '@/lib/white-papers/store';
import { MAX_WHITE_PAPER_ORIGINAL_BYTES } from '@/lib/white-papers/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const gate = await checkAdministrator();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!isUsableWhitePaperId(id)) return notFound();

  try {
    const { paper, bytes } = await readWhitePaperOriginal(gate.person, id);
    const name = paper.fileName.replace(/[^\w.\- ]+/g, '_') || 'white-paper.pdf';
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `inline; filename="${name}"`,
        // Never kept by the browser: the next person at a shared machine is asked again.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    const refused = whitePaperRefusal(error);
    if (refused) return refused;
    throw error;
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  const gate = await checkAdministrator();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!isUsableWhitePaperId(id)) return notFound();

  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (contentType !== 'application/pdf') {
    return Response.json({ error: 'Send the PDF.' }, { status: 415 });
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_WHITE_PAPER_ORIGINAL_BYTES) {
    return Response.json(
      { error: 'That PDF is too large to keep. Its text is kept.' },
      { status: 413 },
    );
  }

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const paper = await keepWhitePaperOriginal(gate.person, id, bytes);
    return Response.json({ paper: whitePaperSummaryOf(paper) }, { status: 201 });
  } catch (error) {
    const refused = whitePaperRefusal(error);
    if (refused) return refused;
    throw error;
  }
}
