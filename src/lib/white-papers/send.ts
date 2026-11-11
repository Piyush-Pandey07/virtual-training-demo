'use client';

/**
 * Reading a white paper's PDF in the browser and sending it (AI-46).
 *
 * In the browser for the reasons the deck upload gives: no PDF library on the server to
 * keep patched, and no serverless timeout for a long paper to run into. The text goes as
 * JSON, page by page; the original follows in its own request when it fits under the
 * platform's request cap, and a paper whose original could not be kept still has its
 * text, which is all the trainer reads.
 *
 * Shared by the upload form and the "replace the PDF" form, which send the same pages to
 * different places.
 */

import { readOutline } from '../pdf/render';
import { MAX_WHITE_PAPER_ORIGINAL_BYTES, type WhitePaperSummaryView } from './types';

export interface ReadPaper {
  pages: string[];
  documentTitle?: string;
}

/** Every page's text, as lines, from a PDF the person chose. */
export async function readPaperPdf(file: File): Promise<ReadPaper> {
  const { outline, close } = await readOutline(file);
  try {
    return {
      pages: outline.pages.map((page) => page.lines.join('\n')),
      documentTitle: outline.documentTitle,
    };
  } finally {
    await close().catch(() => undefined);
  }
}

async function errorOf(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

/** Sends the text, then tries to keep the original. Says what happened to the original. */
export async function sendPaper(
  file: File,
  request: { url: string; method: 'POST' | 'PATCH'; body: Record<string, unknown> },
): Promise<{ paper: WhitePaperSummaryView; originalNote: string | null }> {
  const sent = await fetch(request.url, {
    method: request.method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.body),
  });
  if (!sent.ok) throw new Error(await errorOf(sent, 'The white paper could not be saved.'));
  const { paper } = (await sent.json()) as { paper: WhitePaperSummaryView };

  if (file.size > MAX_WHITE_PAPER_ORIGINAL_BYTES) {
    return {
      paper,
      originalNote: 'The text is saved. The PDF is over 4 MB, so the original was not kept.',
    };
  }
  const kept = await fetch(`/api/white-papers/${encodeURIComponent(paper.id)}/original`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
  });
  if (!kept.ok) {
    return {
      paper,
      originalNote: `The text is saved. ${await errorOf(kept, 'The original PDF could not be kept.')}`,
    };
  }
  return { paper, originalNote: null };
}
