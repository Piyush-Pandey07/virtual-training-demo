import 'server-only';

import { firestoreDocuments } from '../firebase/firestore';
import { orgsConfigured } from '../orgs/registry';
import { scopedDocuments } from '../orgs/scope';
import { InMemoryDocumentStore, type DocumentStore } from '../roster/documents';
import { emptyUsage, monthOf, type Usage, type UsageDelta } from './types';

/**
 * What each customer has spent, counted as it is spent.
 *
 * One document per customer per month, incremented atomically. `update` runs inside a
 * Firestore transaction and retries on collision, which is what this needs: two
 * trainees finishing sentences at the same moment must both be counted, and a
 * read-modify-write would lose one of them silently. Silently is the problem — an
 * undercount looks exactly like a quiet month.
 *
 * Scoped like everything else, so a customer's usage lives under their own prefix and
 * cannot be read by asking for somebody else's.
 */

const USAGE = 'usage';

/**
 * A single in-memory store shared by every unconfigured caller.
 *
 * Module level rather than per call so counters at least add up within a process. A
 * deployment with no Firestore has no usage worth billing anyway; this exists so a
 * local build and the tests behave rather than throwing on every spend.
 */
const fallback = new InMemoryDocumentStore();

function documents(orgId: string): DocumentStore {
  return scopedDocuments(orgsConfigured() ? firestoreDocuments() : fallback, orgId);
}

/**
 * Adds to this month's counters.
 *
 * Deliberately forgiving: a failure here loses a number, and refusing to teach
 * somebody because their usage could not be written would be the wrong trade every
 * time. Callers should not await this on a path a person is waiting on.
 */
export async function record(orgId: string, delta: UsageDelta, when = new Date()): Promise<void> {
  const month = monthOf(when);
  const now = when.toISOString();

  await documents(orgId).update<Usage>(USAGE, month, (current) => {
    const base = current ?? emptyUsage(orgId, month, now);
    return {
      ...base,
      ttsCharacters: base.ttsCharacters + (delta.ttsCharacters ?? 0),
      sttSeconds: base.sttSeconds + (delta.sttSeconds ?? 0),
      geminiInputTokens: base.geminiInputTokens + (delta.geminiInputTokens ?? 0),
      geminiOutputTokens: base.geminiOutputTokens + (delta.geminiOutputTokens ?? 0),
      sessions: base.sessions + (delta.sessions ?? 0),
      decksAnalysed: base.decksAnalysed + (delta.decksAnalysed ?? 0),
      updatedAt: now,
    };
  });
}

/**
 * Counts without waiting, and without letting a counter break a session.
 *
 * Everything that spends is on a path somebody is sitting in front of. Awaiting a
 * database write before returning audio would put the meter in the way of the thing
 * being metered.
 */
export function recordQuietly(orgId: string, delta: UsageDelta): void {
  void record(orgId, delta).catch(() => undefined);
}

export async function usageFor(orgId: string, when = new Date()): Promise<Usage> {
  const month = monthOf(when);
  const stored = await documents(orgId).get<Usage>(USAGE, month);
  return stored ?? emptyUsage(orgId, month, when.toISOString());
}

/** Every month on record for one customer, newest first. */
export async function usageHistory(orgId: string): Promise<Usage[]> {
  const rows = await documents(orgId).all<Usage>(USAGE);
  return rows.sort((a, b) => b.month.localeCompare(a.month));
}
