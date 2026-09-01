/**
 * POST /api/decks
 *
 * Creates a draft deck from a rendered upload. The browser has already read the
 * PDF, so this receives an outline rather than a file: page sizes and the text
 * printed on each page. The page images follow as separate requests.
 *
 * Deliberately not a file upload. A 20 MB deck cannot be posted to a Vercel
 * function at all, since the platform caps a request body at 4.5 MB, and rendering
 * a 60-page PDF cannot be relied on to finish inside a function timeout. Doing the
 * reading in the browser removes both problems, and keeps the client's deck off
 * this server except as the renders they chose to send.
 */

import { deckIdFrom, draftDeckFrom, titleFromFileName, type DraftPage } from '@/lib/decks/draft';
import { deckStore } from '@/lib/decks/registry';
import { DeckStoreError } from '@/lib/decks/store';
import { readable } from '@/lib/decks/readable';

import { checkAdmin } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** A page of text is generous. A megabyte of it is someone probing. */
const MAX_LINES_PER_PAGE = 200;
const MAX_LINE_CHARS = 2000;

/** A notes page holds more than a slide does, and none of it is ever spoken. */
const MAX_NOTES_PER_PAGE = 40;
const MAX_NOTE_CHARS = 4000;
const MAX_PAGES = 500;

interface CreateDeckBody {
  fileName?: unknown;
  documentTitle?: unknown;
  pages?: unknown;
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/** Bounds everything that came from a browser before it reaches storage. */
function parsePages(raw: unknown): DraftPage[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'pages must be a non-empty array.';
  if (raw.length > MAX_PAGES) return 'That deck has more pages than this supports.';

  const pages: DraftPage[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== 'object') return 'pages[' + index + '] must be an object.';
    const page = entry as Record<string, unknown>;

    const pageNumber = Number(page.pageNumber);
    const width = Number(page.width);
    const height = Number(page.height);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      return 'pages[' + index + '].pageNumber must be a positive integer.';
    }
    if (!Number.isFinite(width) || width < 1 || !Number.isFinite(height) || height < 1) {
      return 'pages[' + index + '] must carry a positive width and height.';
    }

    const notes = Array.isArray(page.notes) ? page.notes : [];
    const lines = Array.isArray(page.lines) ? page.lines : [];
    pages.push({
      pageNumber,
      width: Math.round(width),
      height: Math.round(height),
      lines: lines
        .filter((line): line is string => typeof line === 'string')
        .slice(0, MAX_LINES_PER_PAGE)
        .map((line) => readable(line.slice(0, MAX_LINE_CHARS)))
        .filter(Boolean),
      titleHint:
        typeof page.titleHint === 'string' ? readable(page.titleHint.slice(0, 200)) : undefined,
      // Bounded like everything else that arrives from a browser. A notes page can
      // hold a great deal, and none of it is spoken, so a generous cap is still a cap.
      notes: notes
        .filter((line): line is string => typeof line === 'string')
        .slice(0, MAX_NOTES_PER_PAGE)
        .map((line) => readable(line.slice(0, MAX_NOTE_CHARS)))
        .filter(Boolean),
    });
  }

  // Page numbers become slide ids, and a duplicate would leave one slide
  // unreachable rather than failing anywhere visible.
  const seen = new Set(pages.map((page) => page.pageNumber));
  if (seen.size !== pages.length) return 'Two pages share a page number.';

  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

export async function POST(request: Request) {
  const gate = await checkAdmin();
  if (!gate.ok) return gate.response;

  const store = deckStore(gate.person.orgId);
  if (!store.writable) {
    return Response.json(
      {
        error:
          'This deployment has no deck storage configured, so uploads are unavailable. Set BLOB_READ_WRITE_TOKEN to enable them.',
      },
      { status: 503 },
    );
  }

  let body: CreateDeckBody;
  try {
    body = (await request.json()) as CreateDeckBody;
  } catch {
    return badRequest('Request body must be JSON.');
  }

  const fileName = typeof body.fileName === 'string' ? body.fileName.slice(0, 300) : '';
  if (!fileName) return badRequest('fileName is required.');

  const documentTitle =
    typeof body.documentTitle === 'string' ? body.documentTitle.slice(0, 200) : undefined;

  const pages = parsePages(body.pages);
  if (typeof pages === 'string') return badRequest(pages);

  const title = documentTitle?.trim() || titleFromFileName(fileName);

  // A short random suffix, so uploading the same file twice makes two decks rather
  // than silently replacing the first.
  const suffix = Math.random().toString(36).slice(2, 8);
  const deckId = deckIdFrom(title, suffix);

  try {
    const record = draftDeckFrom({ fileName, documentTitle, pages }, deckId);
    // Draft, always. This deck has no expertise behind it until it is analysed, and
    // the publish check is what keeps it out of a trainee's way until then.
    const summary = await store.save(record, 'draft');
    return Response.json({ deck: summary }, { status: 201 });
  } catch (error) {
    if (error instanceof DeckStoreError) return badRequest(error.message);
    const message = error instanceof Error ? error.message : 'Could not create the deck.';
    return Response.json({ error: message }, { status: 500 });
  }
}
