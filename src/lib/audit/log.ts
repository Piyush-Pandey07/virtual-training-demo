/**
 * The audit history: who viewed or changed a learner profile, an assessment result, a
 * question bank, the glossary or a deck's approval (BRD v2.3, AI-40), and who cancelled a
 * trainer-led session, changed its attendance or list, or downloaded its summary.
 *
 * Append only. An entry is written once and never changed, and nothing in the app
 * removes one: they go when their retention runs out, or with the customer they belong
 * to. That is the property that makes a history worth asking, since a record anybody
 * can tidy is a record of what they chose to leave.
 *
 * Two collections, for the same reason the developer log is outside any customer. A
 * customer's own data, its profiles, results, banks and deck approvals, is audited
 * under that customer's prefix in `audit`, so it goes with them when they are deleted
 * and can never be read from inside another customer. The glossary is Technavious's
 * and belongs to no customer, so its entries go in `platformAudit`, outside every
 * prefix. Which of the two an entry goes to follows from its subject alone, so a caller
 * cannot put a glossary change inside a customer by mistake.
 *
 * Kept 400 days, comfortably over the year AI-40 asks for. Each entry carries
 * `expireAt`, and Firestore deletes it once a TTL policy on the `expireAt` field of
 * both collections is enabled, as for the developer log; until then nothing is
 * deleted, which errs the right way. Read a month at a time by its `month` field, or a
 * day by its `day` field, which the automatic index serves, so the page never reads
 * the whole collection.
 *
 * Writing is best effort and after the response. A failure to record that somebody
 * looked at a profile must not stop them looking, and nobody should wait on it.
 */

import 'server-only';

import { after } from 'next/server';

import { isAdministrator, isCompanyAdmin, isFacilitator } from '../auth/permissions';
import { firestoreDocuments } from '../firebase/firestore';
import { orgsConfigured } from '../orgs/registry';
import { scopedDocuments } from '../orgs/scope';
import { InMemoryDocumentStore, type DocumentStore } from '../roster/documents';
import type { Role } from '../roster/types';

/** A customer's own entries, under their prefix. */
export const AUDIT = 'audit';
/** The platform's entries, outside every prefix: the glossary, which no customer owns. */
export const PLATFORM_AUDIT = 'platformAudit';

/** How long an entry is kept. Over a year, which is what AI-40 asks for. */
export const AUDIT_RETENTION_DAYS = 400;

export const AUDIT_ACTIONS = [
  'viewed',
  'created',
  'updated',
  'deleted',
  'approved',
  'withdrawn',
  'uploaded',
  'cancelled',
  'downloaded',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_SUBJECTS = [
  'profile',
  'assessment-result',
  'question-bank',
  'glossary-term',
  'deck-approval',
  'training-session',
] as const;
export type AuditSubject = (typeof AUDIT_SUBJECTS)[number];

/** How each subject is named on the page. */
export const AUDIT_SUBJECT_LABELS: Record<AuditSubject, string> = {
  profile: 'Learner profiles',
  'assessment-result': 'Assessment results',
  'question-bank': 'Question banks',
  'glossary-term': 'Glossary',
  'deck-approval': 'Deck approvals',
  'training-session': 'Trainer-led sessions',
};

export function isAuditSubject(value: unknown): value is AuditSubject {
  return typeof value === 'string' && (AUDIT_SUBJECTS as readonly string[]).includes(value);
}

/** Which of the four kinds of person they were, in BRD v2.3's words, at the time. */
export type AuditRole = 'administrator' | 'company administrator' | 'facilitator' | 'participant';

export interface AuditEntry {
  id: string;
  /** ISO 8601. */
  at: string;
  /** `YYYY-MM-DD` and `YYYY-MM` in UTC, which is how the page reads them. */
  day: string;
  month: string;
  /** The customer the subject belongs to, or absent for the platform's own. */
  orgId?: string;
  actorId: string;
  actorEmail: string;
  actorRole: AuditRole;
  action: AuditAction;
  subjectType: AuditSubject;
  subjectId: string;
  /** A short sentence. Never the content itself: a profile's answers stay in the profile. */
  detail: string;
  expireAt: Date;
}

/** What `recordAudit` needs to know about whoever acted. A signed-in person has all of it. */
export interface AuditActor {
  id: string;
  email: string;
  role: Role;
  platform: boolean;
  homeOrgId?: string;
  /** The customer they are acting in. Required for anything but the glossary. */
  orgId?: string;
}

export interface AuditInput {
  action: AuditAction;
  subjectType: AuditSubject;
  subjectId: string;
  detail?: string;
}

export interface AuditOptions {
  /** The document store underneath, before it is scoped. For the tests. */
  store?: DocumentStore;
  now?: number;
  /** Write before returning rather than after the response. For the tests. */
  immediate?: boolean;
}

const fallback = new InMemoryDocumentStore();

function base(override?: DocumentStore): DocumentStore {
  return override ?? (orgsConfigured() ? firestoreDocuments() : fallback);
}

/** One customer's audit entries, and no other customer's. */
export function auditDocuments(orgId: string, store?: DocumentStore): DocumentStore {
  return scopedDocuments(base(store), orgId);
}

export function auditRoleOf(actor: AuditActor): AuditRole {
  if (isAdministrator(actor)) return 'administrator';
  if (isCompanyAdmin(actor)) return 'company administrator';
  if (isFacilitator(actor)) return 'facilitator';
  return 'participant';
}

/** Sorts by time as a string, with a random tail so two in one millisecond stay two. */
function newAuditId(now: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `${now.toString(36).padStart(9, '0')}-${Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('')}`;
}

/** Runs after the response when there is one, and straight away otherwise. */
function later(work: () => Promise<void>): void {
  const guarded = () =>
    work().catch((error: unknown) => {
      // Printed, so a gap in the history at least shows in the deployment's own logs.
      console.error(`[audit] could not record an entry: ${(error as Error)?.message ?? error}`);
    });
  try {
    after(guarded);
  } catch {
    // Outside a request, as in the tests and scripts. `after` refuses there.
    void guarded();
  }
}

/**
 * Records that somebody viewed or changed something, for the audit history.
 *
 * The subject decides where it goes: the glossary to the platform's collection, and
 * everything else to the customer the actor is acting in. An entry about a customer's
 * data from somebody with no customer is dropped with a message rather than written
 * somewhere it could be read from the wrong place.
 *
 * Returns once the entry is queued, not written, unless `immediate` is asked for.
 */
export async function recordAudit(
  actor: AuditActor,
  input: AuditInput,
  options: AuditOptions = {},
): Promise<void> {
  const now = options.now ?? Date.now();
  const platform = input.subjectType === 'glossary-term';
  const orgId = actor.orgId;
  if (!platform && !orgId) {
    console.error(`[audit] ${input.subjectType} ${input.action} by ${actor.id} names no customer`);
    return;
  }

  const at = new Date(now);
  const iso = at.toISOString();
  const entry: AuditEntry = {
    id: newAuditId(now),
    at: iso,
    day: iso.slice(0, 10),
    month: iso.slice(0, 7),
    ...(platform ? {} : { orgId }),
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: auditRoleOf(actor),
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId.slice(0, 200),
    detail: (input.detail ?? '').slice(0, 300),
    expireAt: new Date(now + AUDIT_RETENTION_DAYS * 86_400_000),
  };

  const write = () =>
    platform || !orgId
      ? base(options.store).set(PLATFORM_AUDIT, entry.id, entry)
      : auditDocuments(orgId, options.store).set(AUDIT, entry.id, entry);

  if (options.immediate) await write().catch(() => undefined);
  else later(write);
}

/** What the history page asks for: a day or a month, and optionally one kind of subject. */
export interface AuditFilter {
  /** `YYYY-MM-DD`. Takes precedence over `month`. */
  day?: string;
  /** `YYYY-MM`. */
  month?: string;
  subjectType?: AuditSubject;
}

/** The field and value a filter reads by, or null when it names no usable period. */
function periodOf(filter: AuditFilter): { field: 'day' | 'month'; value: string } | null {
  if (filter.day && /^\d{4}-\d{2}-\d{2}$/.test(filter.day)) {
    return { field: 'day', value: filter.day };
  }
  if (filter.month && /^\d{4}-\d{2}$/.test(filter.month)) {
    return { field: 'month', value: filter.month };
  }
  return null;
}

function narrowed(entries: AuditEntry[], filter: AuditFilter): AuditEntry[] {
  return entries
    .filter((entry) => !filter.subjectType || entry.subjectType === filter.subjectType)
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** One customer's entries for a day or a month, newest first. */
export async function auditHistory(
  orgId: string,
  filter: AuditFilter,
  options: { store?: DocumentStore } = {},
): Promise<AuditEntry[]> {
  const period = periodOf(filter);
  if (!period) return [];
  const entries = await auditDocuments(orgId, options.store).where<AuditEntry>(
    AUDIT,
    period.field,
    period.value,
  );
  return narrowed(entries, filter);
}

/** The platform's own entries, the glossary's, for a day or a month, newest first. */
export async function platformAuditHistory(
  filter: AuditFilter,
  options: { store?: DocumentStore } = {},
): Promise<AuditEntry[]> {
  const period = periodOf(filter);
  if (!period) return [];
  const entries = await base(options.store).where<AuditEntry>(
    PLATFORM_AUDIT,
    period.field,
    period.value,
  );
  return narrowed(entries, filter);
}
