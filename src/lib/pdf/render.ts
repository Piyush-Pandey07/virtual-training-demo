'use client';

/**
 * Turning an uploaded PDF into slide images and text, in the browser.
 *
 * In the browser on purpose. The trainee's deck never leaves their machine except
 * as the renders they choose to upload, there is no PDF library on the server to
 * keep patched, and a 60-page render does not have to finish inside a serverless
 * function's timeout. It also means the work is visible: the trainer watches pages
 * appear rather than waiting on a spinner.
 *
 * Two passes, deliberately. Reading every page's text and size is fast, and doing
 * it first means the deck can be created with a real outline before the slow work
 * starts, so progress is reported against a known total. Rendering then happens one
 * page at a time and each render is handed straight to the caller to upload and
 * discard: holding sixty full-resolution bitmaps at once is how this runs a laptop
 * out of memory.
 */

import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

/**
 * Rendered width for the slide the trainee looks at.
 *
 * A 16:9 slide at this width is legible full-screen on a laptop and lands around
 * 120 to 250 kB as webp. Higher buys nothing at the size a slide is displayed.
 */
const FULL_WIDTH = 1600;

/**
 * Rendered width for the thumbnail.
 *
 * 768 because that is Gemini's image tile size: a page at or under 768 across costs
 * one tile, which is the same 258 tokens as a page of PDF. Rendering the analysis
 * copy any larger multiplies the token cost of reading a deck by six for no gain.
 */
const THUMB_WIDTH = 768;

const FULL_QUALITY = 0.85;
const THUMB_QUALITY = 0.75;

/** What one page of the upload turned into. */
export interface RenderedPage {
  pageNumber: number;
  /** Pixel size of the full render. */
  width: number;
  height: number;
  full: Blob;
  thumb: Blob;
}

/** What the fast first pass learns about a page. */
export interface PageOutline {
  pageNumber: number;
  width: number;
  height: number;
  /** Text printed on the page, grouped into lines in reading order. */
  lines: string[];
  /**
   * The line set in the largest type, when there is a clear winner.
   *
   * A far better guess at a page's title than its first line: on a page holding a
   * diagram, the first line is as likely to be part of the diagram as the heading.
   * Only the browser knows the type sizes, so it decides here rather than the
   * server guessing from the text alone.
   */
  titleHint?: string;
}

export interface PdfOutline {
  pageCount: number;
  /** From the PDF's own metadata, when it has any. Often absent or wrong. */
  documentTitle?: string;
  pages: PageOutline[];
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

/**
 * Loads pdf.js and points it at its worker.
 *
 * Lazily, and once. It is a 1.2 MB library that only matters on the upload page, so
 * loading it with the app would make every session start slower for a file most
 * visitors never touch.
 */
async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      // Copied out of node_modules at build time by scripts/copy-pdf-worker.mjs, so
      // it cannot drift from the installed version and no third-party CDN sees the
      // client's deck.
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf/pdf.worker.min.mjs';
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/**
 * Groups a page's text fragments into lines.
 *
 * pdf.js reports text as positioned runs, not lines: a single bullet can arrive as
 * four fragments and two bullets on the same visual line arrive as separate items
 * with the same vertical offset. Grouping by vertical position and joining
 * left-to-right recovers something that reads like the slide.
 *
 * The tolerance is proportional to the text height rather than fixed, because a
 * title at 40pt and body text at 12pt do not sit on the same grid.
 */
export interface TextRun {
  x: number;
  width: number;
  str: string;
}

export interface TextRow {
  y: number;
  height: number;
  parts: TextRun[];
}

/**
 * Joins one row's runs, putting a space where the page has one.
 *
 * pdf.js reports positioned runs, and whether two adjacent runs need a space
 * between them is a fact about the gap on the page rather than about the strings.
 * Joining them directly produced "onePDFfromhereon", which then went into the
 * prompt and would have been read out exactly like that.
 *
 * The threshold is a fraction of the type size, because a gap that means a space
 * at 40pt is wider than the whole word at 8pt.
 */
export function joinRow(row: TextRow): string {
  const parts = [...row.parts].sort((a, b) => a.x - b.x);
  const gapMeaningSpace = Math.max(row.height * 0.2, 0.8);

  let text = '';
  let previousEnd: number | null = null;

  for (const part of parts) {
    const needsSpace =
      previousEnd !== null &&
      part.x - previousEnd > gapMeaningSpace &&
      // Some producers already put the space in the run itself.
      !/\s$/.test(text) &&
      !/^\s/.test(part.str);

    if (needsSpace) text += ' ';
    text += part.str;
    previousEnd = part.x + part.width;
  }

  return text.replace(/\s+/g, ' ').trim();
}

/** Groups a page's text runs into rows, top to bottom. */
export function groupIntoRows(items: TextItem[]): TextRow[] {
  const rows: TextRow[] = [];

  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const height = item.height || 10;
    const tolerance = Math.max(height * 0.5, 2);

    const row = rows.find((candidate) => Math.abs(candidate.y - y) <= tolerance);
    if (row) {
      row.parts.push({ x, width: item.width ?? 0, str: item.str });
      row.height = Math.max(row.height, height);
    } else {
      rows.push({ y, height, parts: [{ x, width: item.width ?? 0, str: item.str }] });
    }
  }

  // PDF y grows upwards, so descending y is top-to-bottom on the page.
  rows.sort((a, b) => b.y - a.y);
  return rows;
}

/** True for a line with actual words in it, rather than rules or diagram edges. */
function readsAsProse(line: string): boolean {
  const letters = line.replace(/[^\p{L}\p{N}]/gu, '');
  return letters.length >= 3 && letters.length / line.length > 0.5;
}

/**
 * The line set in the largest type, if one stands out.
 *
 * Prose only: on a page holding a diagram the biggest glyphs are as likely to be
 * box-drawing characters as a heading, and a title of box-drawing characters ends
 * up in the slide rail and in the prompt.
 */
export function titleHintFrom(rows: TextRow[]): string | undefined {
  const candidates = rows
    .map((row) => ({ text: joinRow(row), height: row.height }))
    .filter((row) => row.text.length >= 3 && row.text.length <= 120)
    .filter((row) => readsAsProse(row.text));

  if (candidates.length === 0) return undefined;

  const largest = candidates.reduce((best, row) => (row.height > best.height ? row : best));
  const median = [...candidates].sort((a, b) => a.height - b.height)[
    Math.floor(candidates.length / 2)
  ].height;

  // Only when it is genuinely set apart. On a page of uniform body text there is
  // no title, and picking the first line and calling it one is a guess.
  return largest.height > median * 1.15 ? largest.text : undefined;
}

export interface OpenedPdf {
  outline: PdfOutline;
  doc: PDFDocumentProxy;
  /**
   * Tears down the worker.
   *
   * Lives on the loading task rather than on the document, and is worth calling:
   * each upload spawns a worker thread holding the whole parsed file, so a trainer
   * who tries three decks in a row would otherwise leave three of them running.
   */
  close: () => Promise<void>;
}

/** Opens the PDF and reads every page's text and size. The fast pass. */
export async function readOutline(file: File): Promise<OpenedPdf> {
  const pdfjs = await loadPdfjs();
  const bytes = new Uint8Array(await file.arrayBuffer());

  const task = pdfjs.getDocument({
    data: bytes,
    disableAutoFetch: true,
    // Turns off the expression evaluator pdf.js uses for some font programs. Not in
    // the published types for this version, so it goes through a narrow cast rather
    // than being dropped: an uploaded PDF is untrusted input.
    ...({ isEvalSupported: false } as Record<string, boolean>),
  });
  const doc = await task.promise;

  let documentTitle: string | undefined;
  try {
    const metadata = await doc.getMetadata();
    const info = metadata.info as { Title?: string } | undefined;
    const title = info?.Title?.trim();
    // Exporters routinely leave the original filename or a template name in here,
    // so it is a hint rather than an answer.
    if (title && title.length > 2 && title.length < 200) documentTitle = title;
  } catch {
    // Metadata is optional and frequently malformed. Not worth failing an upload.
  }

  const pages: PageOutline[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    // getTextContent returns marked-content markers alongside real text runs, and
    // only the runs carry a string.
    const rows = groupIntoRows(content.items.filter((item): item is TextItem => 'str' in item));

    pages.push({
      pageNumber,
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
      lines: rows.map(joinRow).filter((line) => line.length > 0),
      titleHint: titleHintFrom(rows),
    });

    page.cleanup();
  }

  return {
    outline: { pageCount: doc.numPages, documentTitle, pages },
    doc,
    close: () => task.destroy(),
  };
}

/**
 * Encodes a canvas as webp.
 *
 * webp rather than PNG because a slide is a photograph-like raster once rendered,
 * and a PNG of the same page is three to four times the size for no visible gain.
 */
async function toWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode a page.'))),
      'image/webp',
      quality,
    );
  });
}

/**
 * A detached DOM canvas.
 *
 * Deliberately not an OffscreenCanvas. pdf.js takes a DOM canvas and states that if
 * a bare context is passed instead then `canvas` must be null; handing it an
 * OffscreenCanvas satisfies neither shape and the render promise simply never
 * settles, with nothing on the console to say why. That cost an hour, so: DOM
 * canvas, and it is never attached to the document, so there is no layout cost to
 * the choice.
 */
function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot render to a canvas.');
  return context;
}

/**
 * Renders one page twice: once for display, once at tile size for analysis.
 *
 * The thumbnail is downscaled from the full render rather than rasterised again,
 * which is both faster and visually better than a second pass at a low scale.
 */
export async function renderPage(doc: PDFDocumentProxy, pageNumber: number): Promise<RenderedPage> {
  const page = await doc.getPage(pageNumber);

  try {
    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: FULL_WIDTH / unscaled.width });

    const width = Math.round(viewport.width);
    const height = Math.round(viewport.height);

    const canvas = makeCanvas(width, height);
    const context = context2d(canvas);

    // Slides are usually drawn assuming white paper. Without this, a page that does
    // not paint its own background comes out as dark text on transparent, which
    // composites to black on black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);

    await page.render({
      canvas,
      viewport,
      /**
       * Print intent, for a display image. Not a mistake.
       *
       * pdf.js drives its render loop with requestAnimationFrame for display
       * intent, and rAF does not fire in a document the browser considers hidden.
       * The visible symptom is that a trainer who switches tabs partway through a
       * 60-page upload comes back to a progress bar that stopped, with nothing on
       * the console to explain it. Print intent takes the promise-driven path
       * instead, so a render finishes whether or not anyone is watching.
       *
       * It is also the better fit on its own terms: this is rasterising a page to a
       * static image, which is what print intent is for.
       */
      intent: 'print',
    }).promise;

    const full = await toWebp(canvas, FULL_QUALITY);

    const thumbWidth = Math.min(THUMB_WIDTH, width);
    const thumbHeight = Math.round((height / width) * thumbWidth);
    const thumbCanvas = makeCanvas(thumbWidth, thumbHeight);
    const thumbContext = context2d(thumbCanvas);

    thumbContext.fillStyle = '#ffffff';
    thumbContext.fillRect(0, 0, thumbWidth, thumbHeight);
    thumbContext.drawImage(canvas, 0, 0, thumbWidth, thumbHeight);
    const thumb = await toWebp(thumbCanvas, THUMB_QUALITY);

    // Releases the backing bitmaps now rather than at the next collection. A
    // 60-page deck otherwise holds well over a gigabyte before the tab catches up.
    canvas.width = 0;
    canvas.height = 0;
    thumbCanvas.width = 0;
    thumbCanvas.height = 0;

    return { pageNumber, width, height, full, thumb };
  } finally {
    // Frees the page's operator list. Without it a long deck's memory grows until
    // the tab is killed.
    page.cleanup();
  }
}
