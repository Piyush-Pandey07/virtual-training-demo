/**
 * Approved white papers (AI-46), as the screens and the store both see them.
 *
 * No `server-only` marker and nothing but types and limits, so the upload form and the
 * deck page can check what they send by the same numbers the server refuses on.
 */

/** Where a paper stands with its approver. */
export type WhitePaperApprovalView =
  | { state: 'approved'; by: string; at: string; version: number }
  | {
      state: 'changed';
      by: string;
      at: string;
      version: number;
      reason: 'changed' | 'withdrawn';
    }
  | { state: 'unapproved' };

/** A paper in the library list, without its text. */
export interface WhitePaperSummaryView {
  id: string;
  title: string;
  summary: string;
  fileName: string;
  version: number;
  status: 'active' | 'withdrawn';
  pageCount: number;
  characters: number;
  passageCount: number;
  /** Whether the original PDF is kept beside the text. */
  originalKept: boolean;
  uploadedBy: string;
  uploadedAt: string;
  updatedAt: string;
  approval: WhitePaperApprovalView;
}

/** One passage of a paper's text, as stored and as shown. */
export interface WhitePaperPassage {
  /** `p1`, `p2`, in reading order. Stable for one version of the text. */
  id: string;
  /** The PDF page it came from, from 1. */
  page: number;
  text: string;
}

/** A paper as the deck page shows it: attached or offered. */
export interface DeckWhitePaperView {
  id: string;
  title: string;
  version: number;
  approval: WhitePaperApprovalView;
  withdrawn: boolean;
}

export const MAX_WHITE_PAPER_TITLE = 160;
export const MAX_WHITE_PAPER_SUMMARY = 1000;
export const MAX_WHITE_PAPER_FILE_NAME = 200;
/** Pages read from one PDF. Well past any white paper; a book is something else. */
export const MAX_WHITE_PAPER_PAGES = 400;
/**
 * The extracted text of one paper.
 *
 * Kept in a single Firestore document, which is capped at a mebibyte. Three hundred
 * thousand characters is a hundred-odd dense pages and leaves room for text that is not
 * plain ASCII, which costs more than a byte a character.
 */
export const MAX_WHITE_PAPER_CHARACTERS = 300_000;
/** Less than this and the PDF is almost certainly a scan with no text layer. */
export const MIN_WHITE_PAPER_CHARACTERS = 200;
/**
 * The original PDF, when it is kept. One request carries it, and the platform refuses a
 * body over 4.5 MB, so a larger file keeps its text and not its original.
 */
export const MAX_WHITE_PAPER_ORIGINAL_BYTES = 4 * 1024 * 1024;

/**
 * The title a PDF carries in its properties, or null when it is one of the placeholders
 * the tools that make PDFs write by default: "untitled", "Microsoft Word - Report1.docx",
 * "Document1", "Presentation1" and the like. Taken at face value, those named a paper
 * "untitled" in the library, so the upload falls back to the file's own name instead.
 */
export function usableDocumentTitle(raw: string | null | undefined): string | null {
  const title = raw?.trim() ?? '';
  if (!title) return null;
  if (/^(untitled|no title|title)$/i.test(title)) return null;
  if (/^microsoft (word|powerpoint|excel)\s*-/i.test(title)) return null;
  if (/^(document|presentation|book|slide|untitled)\s*\d*$/i.test(title)) return null;
  if (/\.(docx?|pptx?|xlsx?|pdf|txt)$/i.test(title)) return null;
  return title;
}
