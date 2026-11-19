/**
 * Which copy of a bank the administrator's panel shows straight after a save (D-07).
 *
 * The panel is given the bank and its versions by the page, which reads them on the
 * server. A save used to answer with a count and a date only, so the panel said "Saved"
 * at once and went on showing what the page had last given it, the old version number,
 * count and date, until the page had been fetched again: a second request after the
 * save, behind a sign-in check and several more reads. So a save now answers with the
 * bank as saved and the versions kept of it, and the panel shows those at once.
 *
 * The page is still fetched again, and is still the authority. What a save answered with
 * is shown only while the page is showing the copy that save replaced. As soon as the
 * page shows anything else, whether this save, a later one made on another screen, or no
 * bank at all, the page's copy is the one shown.
 *
 * Pure and free of server imports, so the panel and the tests share it.
 */

import type { BankVersionSummary, QuestionBank } from './types';

/** A bank and the versions kept of it, as the panel shows them. */
export interface BankOnScreen {
  bank: QuestionBank | null;
  versions: BankVersionSummary[];
}

/**
 * What saving a bank answers with, from an upload or a generated sample.
 *
 * The bank carries its answers. That is safe for the same reason the page may read them:
 * only the Benchmark administrator can make the request, and they have just sent or
 * generated these questions themselves.
 */
export interface SavedBankReply {
  questions: number;
  savedAt: string;
  bank: QuestionBank;
  /** Absent when they could not be read after the save, which still happened. */
  versions?: BankVersionSummary[];
}

/** A save's answer, with the copy the page was showing when the save was made. */
export interface SavedBank {
  /** `copyOf` the page at the time. */
  replaced: string;
  bank: QuestionBank;
  versions: BankVersionSummary[];
}

/**
 * Names the copy a page is showing: which version is current, and how many are kept.
 *
 * The count is what makes this safe to compare later. A page with no bank looks the same
 * before a first upload and after a removal, but kept versions are never removed, so
 * every save leaves more of them than there were. A page can therefore never again name
 * the copy it showed before a save, and what that save answered with cannot come back
 * over anything later, a removal above all.
 */
export function copyOf(page: BankOnScreen): string {
  return `${page.bank?.version ?? ''}#${page.versions.length}`;
}

/**
 * A save's answer as the panel holds it, or null when the answer did not carry both the
 * bank and its versions, in which case the panel waits for the page as it used to.
 */
export function savedOver(
  page: BankOnScreen,
  reply: Partial<Pick<SavedBankReply, 'bank' | 'versions'>>,
): SavedBank | null {
  if (!reply.bank || !reply.versions) return null;
  return { replaced: copyOf(page), bank: reply.bank, versions: reply.versions };
}

/** The copy to show: what the last save answered with while the page is behind it, or the page's. */
export function bankOnScreen(page: BankOnScreen, saved: SavedBank | null): BankOnScreen {
  return saved && saved.replaced === copyOf(page)
    ? { bank: saved.bank, versions: saved.versions }
    : page;
}
