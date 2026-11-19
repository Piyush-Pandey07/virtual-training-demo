/**
 * The audit history: who viewed or changed a learner profile, an assessment result, a
 * question bank, the glossary or a deck's approval (BRD v2.3, AI-40); and, as the product
 * owner widened it, consent given and withdrawn, people added and moved, role changes,
 * downloads, deletions of people, decks, banks and sessions, attendance edits, and the
 * administrators' own actions: decks uploaded, edited, analysed, published and withdrawn,
 * assignments, and batches and sessions set up and changed. Only Technavious
 * administrators read it.
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
 * prefix, as do a customer's suspension and closure, which have to outlive the customer
 * (AI-52). Which of the two an entry goes to follows from its subject alone, so a caller
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
/** The platform's entries, outside every prefix: the glossary, and customers themselves. */
export const PLATFORM_AUDIT = 'platformAudit';

/** How long an entry is kept. Over a year, which is what AI-40 asks for. */
export const AUDIT_RETENTION_DAYS = 400;

/** The most of an entry's detail that is kept. Anything longer is cut off at this length. */
export const AUDIT_DETAIL_LENGTH = 300;

export const AUDIT_ACTIONS = [
  'viewed',
  'created',
  'updated',
  'deleted',
  'approved',
  'withdrawn',
  'uploaded',
  'cancelled',
  // Consent to the privacy notice, the opposite of 'withdrawn'.
  'given',
  'downloaded',
  'published',
  'unpublished',
  'analysed',
  'assigned',
  'unassigned',
  'role-changed',
  // A white paper put on a deck for the trainer to draw on, and taken off it (AI-46).
  'attached',
  'detached',
  // A customer stopped from signing in, and let back in (AI-52). Closing a customer for
  // good deletes it, and is recorded as 'deleted'.
  'suspended',
  'reinstated',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_SUBJECTS = [
  'profile',
  'assessment-result',
  'question-bank',
  'glossary-term',
  'deck-approval',
  // Agreeing to and withdrawing from the privacy notice, separately from the profile.
  'consent',
  // Somebody's place in the customer: added, a role changed, moved, or removed.
  'person',
  'deck',
  'assignment',
  'batch',
  'training-session',
  // Approved white papers: uploaded, approved, withdrawn, attached to decks, deleted.
  'white-paper',
  // A customer itself: suspended, reinstated, or closed and deleted (AI-52).
  'customer',
  // A bulk participant upload as a whole, with its counts (AI-60). Each profile it filled
  // in is recorded separately, under 'profile'.
  'participant-upload',
] as const;
export type AuditSubject = (typeof AUDIT_SUBJECTS)[number];

/** How each subject is named on the page. */
export const AUDIT_SUBJECT_LABELS: Record<AuditSubject, string> = {
  profile: 'Learner profiles',
  'assessment-result': 'Assessment results',
  'question-bank': 'Question banks',
  'glossary-term': 'Glossary',
  'deck-approval': 'Deck approvals',
  consent: 'Consent',
  person: 'People and roles',
  deck: 'Decks',
  assignment: 'Assignments',
  batch: 'Batches',
  'training-session': 'Trainer-led sessions',
  'white-paper': 'White papers',
  customer: 'Customers',
  'participant-upload': 'Participant uploads',
};

/**
 * The subjects that belong to no customer, and so go in `platformAudit`.
 *
 * The glossary is Technavious's own. A customer's suspension or closure is about the
 * customer, but it cannot be filed inside them: closing one deletes everything under
 * their prefix, their audit history included, and the record of who closed them is
 * exactly what has to outlive them.
 */
export const PLATFORM_AUDIT_SUBJECTS: readonly AuditSubject[] = ['glossary-term', 'customer'];

export function isPlatformAuditSubject(subject: AuditSubject): boolean {
  return PLATFORM_AUDIT_SUBJECTS.includes(subject);
}

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
 * The subject decides where it goes: the glossary and customers themselves to the
 * platform's collection, and everything else to the customer the actor is acting in. An
 * entry about a customer's data from somebody with no customer is dropped with a message
 * rather than written somewhere it could be read from the wrong place.
 *
 * Returns once the entry is queued, not written, unless `immediate` is asked for.
 */
export async function recordAudit(
  actor: AuditActor,
  input: AuditInput,
  options: AuditOptions = {},
): Promise<void> {
  const now = options.now ?? Date.now();
  const platform = isPlatformAuditSubject(input.subjectType);
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
    detail: (input.detail ?? '').slice(0, AUDIT_DETAIL_LENGTH),
    expireAt: new Date(now + AUDIT_RETENTION_DAYS * 86_400_000),
  };

  const write = () =>
    platform || !orgId
      ? base(options.store).set(PLATFORM_AUDIT, entry.id, entry)
      : auditDocuments(orgId, options.store).set(AUDIT, entry.id, entry);

  if (options.immediate) await write().catch(() => undefined);
  else later(write);
}

/** The parts of a consent record the history needs. See profiles/consent.ts. */
export interface ConsentDecisionMade {
  decision: 'given' | 'withdrawn';
  noticeVersion: string;
  withProfile: boolean;
}

/**
 * Records that somebody agreed to the privacy notice, or withdrew (AI-40).
 *
 * Filed under the organisation the consent record itself is kept in, which is the one
 * the person belongs to: Technavious staff looking inside a customer agree for
 * themselves, not for the customer, and their consent lives at home.
 */
export function recordConsentAudit(
  actor: AuditActor,
  consent: ConsentDecisionMade,
  options: AuditOptions = {},
): Promise<void> {
  return recordAudit(
    { ...actor, orgId: actor.homeOrgId ?? actor.orgId },
    {
      action: consent.decision,
      subjectType: 'consent',
      subjectId: actor.id,
      detail:
        consent.decision === 'given'
          ? `Agreed to notice ${consent.noticeVersion}${consent.withProfile ? ', with a profile' : ''}`
          : `Withdrew consent given under notice ${consent.noticeVersion}`,
    },
    options,
  );
}

/** The parts of a roster row the history names. See roster/types.ts. */
export interface PersonRecorded {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/** How somebody came to be in a customer, or left it by being moved, for `recordPersonAudit`. */
export type PersonChange =
  /** Added by hand on the people screen, at an address not here before. */
  | { kind: 'added' }
  /** The same, at an address already here. `nameBefore` is the name they had until then. */
  | { kind: 'added-again'; nameBefore: string }
  /** Created by a row of a participant upload. */
  | { kind: 'uploaded'; line: number }
  /** Moved between customers by Technavious, as the customer they arrived in sees it. */
  | { kind: 'moved-in'; fromOrgId: string }
  /** The same move, as the customer they left sees it. */
  | { kind: 'moved-out'; toOrgId: string };

/**
 * Records that an administrator put somebody on a customer's roster, or took them off it
 * by moving them (D-02): who it was, the role they have, and how it was done. Who did it
 * and when come with every entry.
 *
 * Adding somebody decides who may sign in and be given training, so it belongs in the
 * history beside the role changes and removals that were already there. Somebody who
 * arrives by signing in themselves is not recorded here: that is their own act, not an
 * administrator's.
 *
 * Adding an address that is already here creates nobody and never changes a role, and
 * the entry says so, because "added again" beside an administrator's address would
 * otherwise read as a second way of being made one. It can change their name, which the
 * entry says too.
 *
 * `person` is the row as it is after the change. The actor's `orgId` is the customer the
 * entry is filed in, which for a move is not always the one staff are looking inside.
 */
export function recordPersonAudit(
  actor: AuditActor,
  person: PersonRecorded,
  change: PersonChange,
  options: AuditOptions = {},
): Promise<void> {
  const role = `with the role ${person.role}`;
  let action: AuditAction;
  let detail: string;
  switch (change.kind) {
    case 'added':
      action = 'created';
      detail = `Added ${person.email} by hand, ${role}`;
      break;
    case 'added-again': {
      const renamed =
        change.nameBefore === person.name
          ? ''
          : change.nameBefore
            ? `. Their name was changed from "${change.nameBefore}" to "${person.name}"`
            : `. Their name was set to "${person.name}"`;
      action = 'updated';
      detail = `Added ${person.email} again: already here ${role}, which was not changed${renamed}`;
      break;
    }
    case 'uploaded':
      action = 'created';
      detail = `Added ${person.email} from line ${change.line} of a participant upload, ${role}`;
      break;
    case 'moved-in':
      action = 'created';
      detail = `Moved ${person.email} here from "${change.fromOrgId}", ${role}`;
      break;
    case 'moved-out':
      action = 'deleted';
      detail = `Moved ${person.email} to "${change.toOrgId}", which removed them from here with their assignments`;
      break;
  }
  return recordAudit(
    actor,
    { action, subjectType: 'person', subjectId: person.id, detail },
    options,
  );
}

/** What happened to a customer, for `recordCustomerAudit`. */
export type CustomerChange =
  | { kind: 'suspended' }
  | { kind: 'reinstated' }
  | { kind: 'closed'; decks: number; documents: number };

/**
 * Records that Technavious suspended a customer, reinstated them, or closed them and
 * deleted everything of theirs (AI-52).
 *
 * Filed in the platform's collection, by the subject, so the entry survives the customer
 * it is about. Who did it and when come with every entry, as they do for the rest.
 */
export function recordCustomerAudit(
  actor: AuditActor,
  orgId: string,
  change: CustomerChange,
  options: AuditOptions = {},
): Promise<void> {
  const input: AuditInput =
    change.kind === 'suspended'
      ? {
          action: 'suspended',
          subjectType: 'customer',
          subjectId: orgId,
          detail: `Suspended customer ${orgId}: nobody there can sign in until it is reinstated`,
        }
      : change.kind === 'reinstated'
        ? {
            action: 'reinstated',
            subjectType: 'customer',
            subjectId: orgId,
            detail: `Reinstated customer ${orgId}: its people can sign in again`,
          }
        : {
            action: 'deleted',
            subjectType: 'customer',
            subjectId: orgId,
            detail: `Closed customer ${orgId} and deleted everything of theirs: ${change.decks} ${change.decks === 1 ? 'deck' : 'decks'} and ${change.documents} ${change.documents === 1 ? 'record' : 'records'}`,
          };
  return recordAudit(actor, input, options);
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

/** The platform's own entries, the glossary's and the customers', for a day or a month. */
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
