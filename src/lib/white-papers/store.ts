/**
 * The white paper library, its approvals, and which decks may draw on which paper (AI-46).
 *
 * The requirement: the trainer answers only from the deck, the glossary and approved white
 * papers, and may use what it knows to explain them but never invents a policy, figure or
 * contact. So a white paper is approved as a deck is. Technavious uploads it as a PDF, the
 * deck approver approves it, an administrator attaches it to the decks it belongs with,
 * and only a paper that is both approved as it stands now and attached reaches a prompt.
 *
 * Per customer, like decks. A paper lives under the customer it was uploaded in, and
 * Technavious looking inside a customer works on that customer's library, so a paper can
 * only ever be attached to a deck in the same customer. Three collections under the
 * customer's prefix: `whitePapers`, one record per paper; `whitePaperText`, its passages,
 * kept apart so the library list never reads a hundred pages it does not show; and
 * `deckWhitePapers`, one document per deck naming the papers attached to it. Without
 * Firebase they are held in memory, as deck approvals are.
 *
 * Approval follows the deck rule exactly: it is of the paper as it stood, recorded as a
 * fingerprint of what the trainer is given (its title and its text) and its status, and
 * it applies only while the paper still matches. Replacing the text, renaming the paper
 * or withdrawing it clears it explicitly too, so a change made and undone does not bring
 * back an approval nobody gave to what was in between. A cleared approval stays on the
 * record, so the screens can say "changed since approval" rather than "never approved".
 *
 * Every change is Technavious's alone, refused here as well as in the routes and pages,
 * so a screen that forgot to ask cannot change the library.
 */

import 'server-only';

import { createHash } from 'node:crypto';

import { recordAudit } from '../audit/log';
import { isAdministrator, type Permissioned } from '../auth/permissions';
import { mayApproveDecks, type Approver } from '../decks/approval';
import { loadStoredDeck } from '../decks/registry';
import { firestoreDocuments } from '../firebase/firestore';
import { orgsConfigured } from '../orgs/registry';
import { scopedDocuments } from '../orgs/scope';
import { InMemoryDocumentStore, type DocumentStore } from '../roster/documents';
import type { SignedInPerson } from '../roster/types';
import { isUsableWhitePaperId, whitePaperFiles, type WhitePaperFileStore } from './files';
import {
  cutIntoPassages,
  indexPassages,
  type IndexedPassage,
  type ReferencePaper,
} from './passages';
import {
  MAX_WHITE_PAPER_CHARACTERS,
  MAX_WHITE_PAPER_FILE_NAME,
  MAX_WHITE_PAPER_ORIGINAL_BYTES,
  MAX_WHITE_PAPER_PAGES,
  MAX_WHITE_PAPER_SUMMARY,
  MAX_WHITE_PAPER_TITLE,
  MIN_WHITE_PAPER_CHARACTERS,
  type DeckWhitePaperView,
  type WhitePaperApprovalView,
  type WhitePaperPassage,
  type WhitePaperSummaryView,
} from './types';

export { isUsableWhitePaperId };

export const WHITE_PAPERS = 'whitePapers';
export const WHITE_PAPER_TEXT = 'whitePaperText';
export const DECK_WHITE_PAPERS = 'deckWhitePapers';

export interface WhitePaperApproval {
  /** `whitePaperFingerprint` of the paper at the moment it was approved. */
  fingerprint: string;
  /** Which version of the text was approved, for the screens. */
  version: number;
  approvedById: string;
  approvedByEmail: string;
  approvedByName: string;
  approvedAt: string;
  /** Set when a change or a withdrawal cleared it. Absent while it applies. */
  clearedAt?: string;
  clearedReason?: 'changed' | 'withdrawn';
  clearedById?: string;
}

export interface WhitePaperRecord {
  id: string;
  title: string;
  /** What the paper is for, for the people choosing it. Never given to the trainer. */
  summary: string;
  fileName: string;
  /** Starts at 1 and goes up each time the text is replaced. */
  version: number;
  status: 'active' | 'withdrawn';
  pageCount: number;
  characters: number;
  passageCount: number;
  /** A hash of the passages, which the text document must still match to be used. */
  textFingerprint: string;
  /** The size of the original PDF, when it is kept. */
  originalBytes?: number;
  uploadedById: string;
  uploadedByEmail: string;
  uploadedByName: string;
  uploadedAt: string;
  updatedAt: string;
  updatedById: string;
  approval?: WhitePaperApproval;
}

/** A paper's text, cut into passages at upload. One document per paper. */
export interface WhitePaperText {
  id: string;
  paperId: string;
  version: number;
  textFingerprint: string;
  passages: WhitePaperPassage[];
}

/** The papers one deck may draw on, in the order they were chosen. */
export interface DeckWhitePapers {
  id: string;
  deckId: string;
  paperIds: string[];
  updatedAt: string;
  updatedById: string;
}

/** A refusal, with the status a route should send and words an administrator can act on. */
export class WhitePaperError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 503,
    message: string,
  ) {
    super(message);
  }
}

export interface WhitePaperOptions {
  /** The document store underneath, before it is scoped. For the tests. */
  store?: DocumentStore;
  /** Where originals are kept. For the tests. */
  files?: WhitePaperFileStore;
  now?: () => string;
}

// ------------------------------------------------------------------- who may

/** Who may upload, change, withdraw, delete and attach papers: Technavious. */
export function mayManageWhitePapers(person: Permissioned): boolean {
  return isAdministrator(person);
}

/**
 * Who may approve a paper: whoever may approve decks, the people in DECK_APPROVERS, or
 * every Technavious administrator while that list is empty. A paper is approved for the
 * same reason a deck is, by the person accountable for what Technavious teaches.
 */
export function mayApproveWhitePapers(person: Approver): boolean {
  return isAdministrator(person) && mayApproveDecks(person);
}

function requireManager(person: SignedInPerson): void {
  // 404 rather than 403, as for every Technavious tool somebody else has no use for.
  if (!mayManageWhitePapers(person)) throw new WhitePaperError(404, 'Not found.');
}

// ------------------------------------------------------------------- storage

const fallback = new InMemoryDocumentStore();

/** One customer's white papers, their text and their attachments, and nobody else's. */
export function whitePaperDocuments(orgId: string, store?: DocumentStore): DocumentStore {
  return scopedDocuments(store ?? (orgsConfigured() ? firestoreDocuments() : fallback), orgId);
}

const nowIso = () => new Date().toISOString();

/** Every paper in a customer's library, by title. */
export async function listWhitePapers(
  orgId: string,
  options: WhitePaperOptions = {},
): Promise<WhitePaperRecord[]> {
  const papers = await whitePaperDocuments(orgId, options.store).all<WhitePaperRecord>(
    WHITE_PAPERS,
  );
  return papers.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export async function whitePaperFor(
  orgId: string,
  paperId: string,
  options: WhitePaperOptions = {},
): Promise<WhitePaperRecord | undefined> {
  if (!isUsableWhitePaperId(paperId)) return undefined;
  return whitePaperDocuments(orgId, options.store).get<WhitePaperRecord>(WHITE_PAPERS, paperId);
}

/** A paper's passages, for the page that shows its text. */
export async function whitePaperTextFor(
  orgId: string,
  paperId: string,
  options: WhitePaperOptions = {},
): Promise<WhitePaperText | undefined> {
  if (!isUsableWhitePaperId(paperId)) return undefined;
  return whitePaperDocuments(orgId, options.store).get<WhitePaperText>(WHITE_PAPER_TEXT, paperId);
}

// --------------------------------------------------------------- fingerprints

/** A hash of a paper's passages, exactly as the trainer would be given them. */
export function textFingerprintOf(passages: readonly WhitePaperPassage[]): string {
  return createHash('sha256')
    .update(JSON.stringify(passages.map((passage) => [passage.id, passage.page, passage.text])))
    .digest('hex');
}

/**
 * A hash of everything about a paper that reaches the trainer, and its status.
 *
 * The title is in it because it heads the paper's passages in the prompt. The summary
 * and the file name are not: neither reaches the trainer, so changing them costs no
 * approval.
 */
export function whitePaperFingerprint(
  paper: Pick<WhitePaperRecord, 'title' | 'textFingerprint' | 'status'>,
): string {
  return createHash('sha256')
    .update(JSON.stringify([paper.title.trim(), paper.textFingerprint, paper.status]))
    .digest('hex');
}

/** Where a paper stands, from its own record. */
export function whitePaperApprovalState(paper: WhitePaperRecord): WhitePaperApprovalView {
  const approval = paper.approval;
  if (!approval) return { state: 'unapproved' };
  const by = approval.approvedByName.trim() || approval.approvedByEmail;
  const base = { by, at: approval.approvedAt, version: approval.version };
  if (approval.clearedAt) {
    return { state: 'changed', ...base, reason: approval.clearedReason ?? 'changed' };
  }
  if (paper.status === 'withdrawn') return { state: 'changed', ...base, reason: 'withdrawn' };
  if (approval.fingerprint !== whitePaperFingerprint(paper)) {
    return { state: 'changed', ...base, reason: 'changed' };
  }
  return { state: 'approved', ...base };
}

export function isApprovedWhitePaper(paper: WhitePaperRecord): boolean {
  return whitePaperApprovalState(paper).state === 'approved';
}

/** What the library list shows of a paper. */
export function whitePaperSummaryOf(paper: WhitePaperRecord): WhitePaperSummaryView {
  return {
    id: paper.id,
    title: paper.title,
    summary: paper.summary,
    fileName: paper.fileName,
    version: paper.version,
    status: paper.status,
    pageCount: paper.pageCount,
    characters: paper.characters,
    passageCount: paper.passageCount,
    originalKept: (paper.originalBytes ?? 0) > 0,
    uploadedBy: paper.uploadedByName.trim() || paper.uploadedByEmail,
    uploadedAt: paper.uploadedAt,
    updatedAt: paper.updatedAt,
    approval: whitePaperApprovalState(paper),
  };
}

// ----------------------------------------------------------------- the input

export interface WhitePaperUpload {
  title: string;
  summary: string;
  fileName: string;
  /** The text of each page of the PDF, in order, as the browser read it. */
  pages: string[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The title and summary, checked. */
export function checkDetails(raw: Record<string, unknown>): { title: string; summary: string } {
  const title = text(raw.title).replace(/\s+/g, ' ');
  const summary = text(raw.summary);
  if (!title) throw new WhitePaperError(400, 'Give the white paper a title.');
  if (title.length > MAX_WHITE_PAPER_TITLE) {
    throw new WhitePaperError(400, `Keep the title under ${MAX_WHITE_PAPER_TITLE} characters.`);
  }
  if (summary.length > MAX_WHITE_PAPER_SUMMARY) {
    throw new WhitePaperError(400, `Keep the summary under ${MAX_WHITE_PAPER_SUMMARY} characters.`);
  }
  return { title, summary };
}

/** The pages, checked and cut into passages. */
export function checkPages(raw: Record<string, unknown>): {
  fileName: string;
  pageCount: number;
  passages: WhitePaperPassage[];
} {
  const fileName = text(raw.fileName).slice(0, MAX_WHITE_PAPER_FILE_NAME) || 'white-paper.pdf';
  const pages = raw.pages;
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every((p) => typeof p === 'string')) {
    throw new WhitePaperError(400, 'Send the text of each page of the PDF.');
  }
  if (pages.length > MAX_WHITE_PAPER_PAGES) {
    throw new WhitePaperError(
      413,
      `That PDF has ${pages.length} pages. A white paper here can have up to ${MAX_WHITE_PAPER_PAGES}.`,
    );
  }
  const passages = cutIntoPassages(pages as string[]);
  const characters = passages.reduce((sum, passage) => sum + passage.text.length, 0);
  if (characters < MIN_WHITE_PAPER_CHARACTERS) {
    throw new WhitePaperError(
      400,
      'That PDF has almost no text that can be read, so it is probably a scan. Upload a PDF with selectable text.',
    );
  }
  if (characters > MAX_WHITE_PAPER_CHARACTERS) {
    throw new WhitePaperError(
      413,
      `That PDF holds ${characters.toLocaleString('en-GB')} characters of text. A white paper here can hold up to ${MAX_WHITE_PAPER_CHARACTERS.toLocaleString('en-GB')}.`,
    );
  }
  return { fileName, pageCount: pages.length, passages };
}

function slugOf(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'paper';
}

function newPaperId(title: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const tail = Array.from(bytes, (byte) => (byte % 36).toString(36)).join('');
  return `${slugOf(title)}-${tail}`;
}

// ------------------------------------------------------------------ actions

async function existing(
  person: SignedInPerson,
  paperId: string,
  options: WhitePaperOptions,
): Promise<WhitePaperRecord> {
  const paper = await whitePaperFor(person.orgId, paperId, options);
  if (!paper) throw new WhitePaperError(404, 'No such white paper.');
  return paper;
}

/** The approval with its clearing written in, when it still applied. */
function cleared(
  approval: WhitePaperApproval | undefined,
  reason: 'changed' | 'withdrawn',
  person: SignedInPerson,
  at: string,
): { approval: WhitePaperApproval | undefined; wasCleared: boolean } {
  if (!approval || approval.clearedAt) return { approval, wasCleared: false };
  return {
    approval: { ...approval, clearedAt: at, clearedReason: reason, clearedById: person.id },
    wasCleared: true,
  };
}

const NO_LONGER = '; its approval no longer applies';

/** Adds a paper to the customer's library. It starts unapproved and attached to nothing. */
export async function uploadWhitePaper(
  person: SignedInPerson,
  raw: Record<string, unknown>,
  options: WhitePaperOptions = {},
): Promise<WhitePaperRecord> {
  requireManager(person);
  const { title, summary } = checkDetails(raw);
  const { fileName, pageCount, passages } = checkPages(raw);
  const at = (options.now ?? nowIso)();
  const id = newPaperId(title);
  const textFingerprint = textFingerprintOf(passages);

  const docs = whitePaperDocuments(person.orgId, options.store);
  // The text before the record, so a failure between the two leaves text nobody can
  // reach rather than a paper in the list with nothing behind it.
  await docs.set<WhitePaperText>(WHITE_PAPER_TEXT, id, {
    id,
    paperId: id,
    version: 1,
    textFingerprint,
    passages,
  });
  const paper: WhitePaperRecord = {
    id,
    title,
    summary,
    fileName,
    version: 1,
    status: 'active',
    pageCount,
    characters: passages.reduce((sum, passage) => sum + passage.text.length, 0),
    passageCount: passages.length,
    textFingerprint,
    uploadedById: person.id,
    uploadedByEmail: person.email,
    uploadedByName: person.name,
    uploadedAt: at,
    updatedAt: at,
    updatedById: person.id,
  };
  await docs.set(WHITE_PAPERS, id, paper);
  await recordAudit(
    person,
    {
      action: 'uploaded',
      subjectType: 'white-paper',
      subjectId: id,
      detail: `Uploaded "${title}" (${pageCount} page${pageCount === 1 ? '' : 's'})`,
    },
    { store: options.store },
  );
  return paper;
}

/**
 * Replaces a paper's text with a new PDF's, as its next version.
 *
 * Whatever was approved was the old text, so the approval clears. The old original no
 * longer matches either, so it goes, and the screen uploads the new one after this.
 */
export async function replaceWhitePaperText(
  person: SignedInPerson,
  paperId: string,
  raw: Record<string, unknown>,
  options: WhitePaperOptions = {},
): Promise<WhitePaperRecord> {
  requireManager(person);
  const before = await existing(person, paperId, options);
  const { fileName, pageCount, passages } = checkPages(raw);
  const textFingerprint = textFingerprintOf(passages);
  const at = (options.now ?? nowIso)();
  const docs = whitePaperDocuments(person.orgId, options.store);

  const version = before.version + 1;
  await docs.set<WhitePaperText>(WHITE_PAPER_TEXT, paperId, {
    id: paperId,
    paperId,
    version,
    textFingerprint,
    passages,
  });

  let wasCleared = false;
  const paper = await docs.update<WhitePaperRecord>(WHITE_PAPERS, paperId, (current) => {
    if (!current) throw new WhitePaperError(404, 'No such white paper.');
    const next = cleared(current.approval, 'changed', person, at);
    wasCleared = next.wasCleared;
    const updated: WhitePaperRecord = {
      ...current,
      fileName,
      version: current.version + 1,
      pageCount,
      characters: passages.reduce((sum, passage) => sum + passage.text.length, 0),
      passageCount: passages.length,
      textFingerprint,
      updatedAt: at,
      updatedById: person.id,
      approval: next.approval,
    };
    delete updated.originalBytes;
    return updated;
  });
  await (options.files ?? whitePaperFiles(person.orgId)).remove(paperId).catch(() => undefined);

  await recordAudit(
    person,
    {
      action: 'uploaded',
      subjectType: 'white-paper',
      subjectId: paperId,
      detail: `Uploaded version ${paper.version} of "${paper.title}"${wasCleared ? NO_LONGER : ''}`,
    },
    { store: options.store },
  );
  return paper;
}

/** Changes the title or the summary. A new title reaches the trainer, so it costs approval. */
export async function editWhitePaper(
  person: SignedInPerson,
  paperId: string,
  raw: Record<string, unknown>,
  options: WhitePaperOptions = {},
): Promise<WhitePaperRecord> {
  requireManager(person);
  await existing(person, paperId, options);
  const { title, summary } = checkDetails(raw);
  const at = (options.now ?? nowIso)();

  let wasCleared = false;
  let renamed = false;
  const paper = await whitePaperDocuments(person.orgId, options.store).update<WhitePaperRecord>(
    WHITE_PAPERS,
    paperId,
    (current) => {
      if (!current) throw new WhitePaperError(404, 'No such white paper.');
      renamed = current.title !== title;
      const next = renamed
        ? cleared(current.approval, 'changed', person, at)
        : { approval: current.approval, wasCleared: false };
      wasCleared = next.wasCleared;
      return {
        ...current,
        title,
        summary,
        updatedAt: at,
        updatedById: person.id,
        approval: next.approval,
      };
    },
  );

  await recordAudit(
    person,
    {
      action: 'updated',
      subjectType: 'white-paper',
      subjectId: paperId,
      detail: `${renamed ? `Renamed it "${title}"` : `Changed the summary of "${title}"`}${wasCleared ? NO_LONGER : ''}`,
    },
    { store: options.store },
  );
  return paper;
}

/**
 * Withdraws a paper, so no deck draws on it, or puts it back.
 *
 * Withdrawing clears the approval. Putting it back does not restore it: a paper that
 * was taken out of use is approved again before it is used again, as a deck is.
 */
export async function setWhitePaperWithdrawn(
  person: SignedInPerson,
  paperId: string,
  withdrawn: boolean,
  options: WhitePaperOptions = {},
): Promise<WhitePaperRecord> {
  requireManager(person);
  const before = await existing(person, paperId, options);
  const status = withdrawn ? 'withdrawn' : 'active';
  if (before.status === status) return before;
  const at = (options.now ?? nowIso)();

  let wasCleared = false;
  const paper = await whitePaperDocuments(person.orgId, options.store).update<WhitePaperRecord>(
    WHITE_PAPERS,
    paperId,
    (current) => {
      if (!current) throw new WhitePaperError(404, 'No such white paper.');
      const next = withdrawn
        ? cleared(current.approval, 'withdrawn', person, at)
        : { approval: current.approval, wasCleared: false };
      wasCleared = next.wasCleared;
      return { ...current, status, updatedAt: at, updatedById: person.id, approval: next.approval };
    },
  );

  await recordAudit(
    person,
    withdrawn
      ? {
          action: 'withdrawn',
          subjectType: 'white-paper',
          subjectId: paperId,
          detail: `Withdrew "${paper.title}"${wasCleared ? NO_LONGER : ''}`,
        }
      : {
          action: 'published',
          subjectType: 'white-paper',
          subjectId: paperId,
          detail: `Put "${paper.title}" back in use; it needs approving again`,
        },
    { store: options.store },
  );
  return paper;
}

/** Approves the paper as it stands now. Only a paper in use: a withdrawn one is not. */
export async function approveWhitePaper(
  person: SignedInPerson,
  paperId: string,
  options: WhitePaperOptions = {},
): Promise<WhitePaperRecord> {
  requireManager(person);
  if (!mayApproveWhitePapers(person)) {
    throw new WhitePaperError(403, 'Only the deck approver may approve white papers.');
  }
  const before = await existing(person, paperId, options);
  if (before.status !== 'active') {
    throw new WhitePaperError(409, 'Put this white paper back in use before approving it.');
  }
  const at = (options.now ?? nowIso)();

  const paper = await whitePaperDocuments(person.orgId, options.store).update<WhitePaperRecord>(
    WHITE_PAPERS,
    paperId,
    (current) => {
      if (!current) throw new WhitePaperError(404, 'No such white paper.');
      return {
        ...current,
        approval: {
          fingerprint: whitePaperFingerprint(current),
          version: current.version,
          approvedById: person.id,
          approvedByEmail: person.email,
          approvedByName: person.name,
          approvedAt: at,
        },
      };
    },
  );

  await recordAudit(
    person,
    {
      action: 'approved',
      subjectType: 'white-paper',
      subjectId: paperId,
      detail: `Approved version ${paper.version} of "${paper.title}"`,
    },
    { store: options.store },
  );
  return paper;
}

/**
 * Removes a paper, its text and its original, and takes it off every deck.
 *
 * Off the decks first, so a failure part-way leaves a paper that still exists rather
 * than a deck pointing at one that does not. A deck naming a missing paper is harmless
 * anyway, since only papers that load are used, but tidy is better.
 */
export async function deleteWhitePaper(
  person: SignedInPerson,
  paperId: string,
  options: WhitePaperOptions = {},
): Promise<{ detachedFrom: number }> {
  requireManager(person);
  const paper = await existing(person, paperId, options);
  const docs = whitePaperDocuments(person.orgId, options.store);
  const at = (options.now ?? nowIso)();

  const links = await docs.all<DeckWhitePapers>(DECK_WHITE_PAPERS);
  let detachedFrom = 0;
  for (const link of links.filter((entry) => entry.paperIds.includes(paperId))) {
    await docs.update<DeckWhitePapers>(DECK_WHITE_PAPERS, link.deckId, (current) => ({
      ...(current ?? link),
      paperIds: (current ?? link).paperIds.filter((id) => id !== paperId),
      updatedAt: at,
      updatedById: person.id,
    }));
    detachedFrom += 1;
  }

  await (options.files ?? whitePaperFiles(person.orgId)).remove(paperId).catch(() => undefined);
  await docs.remove(WHITE_PAPER_TEXT, paperId);
  await docs.remove(WHITE_PAPERS, paperId);

  await recordAudit(
    person,
    {
      action: 'deleted',
      subjectType: 'white-paper',
      subjectId: paperId,
      detail: `Deleted "${paper.title}"${detachedFrom ? `, which ${detachedFrom === 1 ? 'one deck' : `${detachedFrom} decks`} drew on` : ''}`,
    },
    { store: options.store },
  );
  return { detachedFrom };
}

// --------------------------------------------------------------- the original

/** Keeps the uploaded PDF beside the text. */
export async function keepWhitePaperOriginal(
  person: SignedInPerson,
  paperId: string,
  bytes: Uint8Array,
  options: WhitePaperOptions = {},
): Promise<WhitePaperRecord> {
  requireManager(person);
  await existing(person, paperId, options);
  const files = options.files ?? whitePaperFiles(person.orgId);
  if (!files.writable) {
    throw new WhitePaperError(
      503,
      'No file storage is configured, so the original PDF cannot be kept. The text is kept.',
    );
  }
  if (bytes.byteLength === 0) throw new WhitePaperError(400, 'That file is empty.');
  if (bytes.byteLength > MAX_WHITE_PAPER_ORIGINAL_BYTES) {
    throw new WhitePaperError(413, 'That PDF is too large to keep. Its text is kept.');
  }
  // A PDF starts with its own signature, so anything else is refused rather than stored.
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new WhitePaperError(400, 'That file is not a PDF.');
  }
  await files.put(paperId, bytes);
  return whitePaperDocuments(person.orgId, options.store).update<WhitePaperRecord>(
    WHITE_PAPERS,
    paperId,
    (current) => {
      if (!current) throw new WhitePaperError(404, 'No such white paper.');
      return { ...current, originalBytes: bytes.byteLength };
    },
  );
}

/** The kept PDF, for whoever manages the library. */
export async function readWhitePaperOriginal(
  person: SignedInPerson,
  paperId: string,
  options: WhitePaperOptions = {},
): Promise<{ paper: WhitePaperRecord; bytes: Uint8Array }> {
  requireManager(person);
  const paper = await existing(person, paperId, options);
  const bytes = await (options.files ?? whitePaperFiles(person.orgId)).get(paperId);
  if (!bytes) throw new WhitePaperError(404, 'The original PDF was not kept.');
  await recordAudit(
    person,
    {
      action: 'downloaded',
      subjectType: 'white-paper',
      subjectId: paperId,
      detail: `Opened the original of "${paper.title}"`,
    },
    { store: options.store },
  );
  return { paper, bytes };
}

// ------------------------------------------------------------------- on decks

/** The ids of the papers attached to a deck, whatever state they are in. */
export async function deckWhitePaperIds(
  orgId: string,
  deckId: string,
  options: WhitePaperOptions = {},
): Promise<string[]> {
  const link = await whitePaperDocuments(orgId, options.store).get<DeckWhitePapers>(
    DECK_WHITE_PAPERS,
    deckId,
  );
  return link?.paperIds ?? [];
}

function deckViewOf(paper: WhitePaperRecord): DeckWhitePaperView {
  return {
    id: paper.id,
    title: paper.title,
    version: paper.version,
    approval: whitePaperApprovalState(paper),
    withdrawn: paper.status === 'withdrawn',
  };
}

/**
 * What the deck page shows: the papers attached to the deck, each with where it stands,
 * and the approved papers that could be attached.
 */
export async function deckWhitePaperView(
  orgId: string,
  deckId: string,
  options: WhitePaperOptions = {},
): Promise<{ attached: DeckWhitePaperView[]; available: DeckWhitePaperView[] }> {
  const [ids, papers] = await Promise.all([
    deckWhitePaperIds(orgId, deckId, options),
    listWhitePapers(orgId, options),
  ]);
  const byId = new Map(papers.map((paper) => [paper.id, paper]));
  const attached = ids.flatMap((id) => {
    const paper = byId.get(id);
    return paper ? [deckViewOf(paper)] : [];
  });
  const available = papers
    .filter((paper) => !ids.includes(paper.id) && isApprovedWhitePaper(paper))
    .map(deckViewOf);
  return { attached, available };
}

/**
 * Sets which papers a deck may draw on.
 *
 * Only an approved paper can be newly attached. One already attached may stay while it
 * waits for approval again, since detaching it would lose the choice; it is simply not
 * used until it is approved. Every attachment and detachment is recorded.
 */
export async function setDeckWhitePapers(
  person: SignedInPerson,
  deckId: string,
  paperIds: unknown,
  options: WhitePaperOptions = {},
): Promise<{ attached: string[]; detached: string[]; paperIds: string[] }> {
  requireManager(person);
  if (!Array.isArray(paperIds) || !paperIds.every((id) => typeof id === 'string')) {
    throw new WhitePaperError(400, 'paperIds must be a list of white paper ids.');
  }
  const wanted = [...new Set(paperIds as string[])];
  if (wanted.length > 20) {
    throw new WhitePaperError(400, 'A deck can draw on up to 20 white papers.');
  }

  const stored = await loadStoredDeck(person.orgId, deckId).catch(() => undefined);
  if (!stored) throw new WhitePaperError(404, 'No such deck.');

  const before = await deckWhitePaperIds(person.orgId, deckId, options);
  const papers = new Map<string, WhitePaperRecord>();
  for (const id of new Set([...wanted, ...before])) {
    const paper = await whitePaperFor(person.orgId, id, options);
    if (paper) papers.set(id, paper);
  }

  const attached = wanted.filter((id) => !before.includes(id));
  for (const id of attached) {
    const paper = papers.get(id);
    if (!paper) throw new WhitePaperError(404, 'No such white paper.');
    if (!isApprovedWhitePaper(paper)) {
      throw new WhitePaperError(
        409,
        `"${paper.title}" is not approved as it stands, so it cannot be attached yet.`,
      );
    }
  }
  const detached = before.filter((id) => !wanted.includes(id));
  if (attached.length === 0 && detached.length === 0) {
    return { attached, detached, paperIds: before };
  }

  const at = (options.now ?? nowIso)();
  await whitePaperDocuments(person.orgId, options.store).set<DeckWhitePapers>(
    DECK_WHITE_PAPERS,
    deckId,
    { id: deckId, deckId, paperIds: wanted, updatedAt: at, updatedById: person.id },
  );

  const deckTitle = stored.record.meta.title;
  for (const [ids, action] of [
    [attached, 'attached'],
    [detached, 'detached'],
  ] as const) {
    for (const id of ids) {
      await recordAudit(
        person,
        {
          action,
          subjectType: 'white-paper',
          subjectId: id,
          detail: `${action === 'attached' ? 'Attached' : 'Detached'} "${papers.get(id)?.title ?? id}" ${action === 'attached' ? 'to' : 'from'} the deck "${deckTitle}"`,
        },
        { store: options.store },
      );
    }
  }
  return { attached, detached, paperIds: wanted };
}

// ---------------------------------------------------------------- for a turn

/**
 * Indexed passages by text fingerprint.
 *
 * A fingerprint names the text exactly, so what is kept under one can never go stale:
 * a changed paper has a new fingerprint and is read afresh. Bounded, so a server that
 * has seen a great many papers keeps the recent ones.
 */
const passageCache = new Map<string, IndexedPassage[]>();
const PASSAGE_CACHE_SIZE = 64;

/** Empties the passage cache. For the tests. */
export function forgetWhitePaperPassages(): void {
  passageCache.clear();
}

async function indexedPassagesFor(
  docs: DocumentStore,
  paper: WhitePaperRecord,
): Promise<IndexedPassage[] | null> {
  const cached = passageCache.get(paper.textFingerprint);
  if (cached) return cached;
  const stored = await docs.get<WhitePaperText>(WHITE_PAPER_TEXT, paper.id);
  // The text must be exactly the text the record, and so the approval, describes. Text
  // written by anything that did not also update the record is not used.
  if (!stored || textFingerprintOf(stored.passages) !== paper.textFingerprint) return null;
  const indexed = indexPassages(stored.passages);
  passageCache.set(paper.textFingerprint, indexed);
  if (passageCache.size > PASSAGE_CACHE_SIZE) {
    passageCache.delete(passageCache.keys().next().value!);
  }
  return indexed;
}

/**
 * The approved, attached papers a deck may draw on, ready for `selectReferences`.
 *
 * Read on every turn, alongside the deck, so approving, withdrawing or detaching a
 * paper takes effect on the next thing the trainer says. One read when the deck has no
 * papers, which is nearly every deck; otherwise one more for the papers' records, and
 * their text only the first time this server sees each version of it.
 *
 * Never throws. A paper that cannot be read is a paper the trainer does without, which
 * is how it taught before there were any, and is better than a turn that fails.
 */
export async function deckReferenceLibrary(
  orgId: string,
  deckId: string,
  options: WhitePaperOptions = {},
): Promise<ReferencePaper[]> {
  try {
    if (typeof deckId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(deckId)) return [];
    const docs = whitePaperDocuments(orgId, options.store);
    const link = await docs.get<DeckWhitePapers>(DECK_WHITE_PAPERS, deckId);
    if (!link || link.paperIds.length === 0) return [];

    const papers = await Promise.all(
      link.paperIds
        .filter(isUsableWhitePaperId)
        .map((id) => docs.get<WhitePaperRecord>(WHITE_PAPERS, id)),
    );
    const usable = papers.filter(
      (paper): paper is WhitePaperRecord => !!paper && isApprovedWhitePaper(paper),
    );
    const loaded = await Promise.all(
      usable.map(async (paper): Promise<ReferencePaper[]> => {
        const passages = await indexedPassagesFor(docs, paper);
        return passages ? [{ paperId: paper.id, title: paper.title, passages }] : [];
      }),
    );
    return loaded.flat();
  } catch (error) {
    console.error(`[white-papers] could not load for ${deckId}: ${(error as Error).message}`);
    return [];
  }
}
