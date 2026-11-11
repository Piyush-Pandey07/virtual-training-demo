/**
 * Approving a deck before it can be assigned, and again after it changes (BRD v2.3,
 * AI-39).
 *
 * Publishing says the person who set the deck up has read it. Approval says the person
 * accountable for what Technavious teaches, Srikant, has signed it off. A deck can be
 * assigned, to one person or through a trainer-led session, only while it is approved,
 * and the approval is of the deck exactly as it stood: any later change to what it
 * teaches, or withdrawing it, means approving it again. Reviewing slide by slide stays
 * optional; this is one decision about the whole deck.
 *
 * "Exactly as it stood" is a fingerprint. Approving records a hash of the deck's
 * teachable content, its meta, every slide's teaching fields, its topics and its
 * status, and the deck is approved only while the hash of the deck now matches it. That
 * makes the rule hold however a deck changes, through the review screen, a re-analysis,
 * or a path written next year that nobody remembered to wire in here, and it means a
 * save that changes nothing does not cost an approval.
 *
 * The known paths also clear the approval explicitly when they change the deck, for two
 * reasons the hash alone cannot cover. Editing a deck and then editing it back would
 * otherwise restore an approval nobody gave to the deck in between. And unpublishing
 * and republishing would restore the hash exactly, when withdrawing a deck is meant to
 * need a fresh approval. A cleared approval stays on record, so the screens can say
 * "changed since approval" rather than "never approved".
 *
 * Existing assignments are left alone when an approval clears. People part-way through
 * a deck keep it; the deck page says it needs approving again, and nobody new can be
 * given it until it is.
 *
 * Approvals live in the customer's own `deckApprovals` collection, keyed on the deck,
 * beside everything else known about them. Without Firebase they are held in memory,
 * as batches and sessions are, so on a developer's machine they last until a restart.
 */

import 'server-only';

import { createHash } from 'node:crypto';

import { recordAudit } from '../audit/log';
import { isAdministrator } from '../auth/permissions';
import { deckApprovers } from '../config';
import type { DeckRecord } from '../deck-types';
import { firestoreDocuments } from '../firebase/firestore';
import { orgsConfigured } from '../orgs/registry';
import { scopedDocuments } from '../orgs/scope';
import { InMemoryDocumentStore, type DocumentStore } from '../roster/documents';
import type { Role, SignedInPerson } from '../roster/types';
import { loadStoredDeck } from './registry';
import type { DeckStatus, DeckSummary } from './store';

export const DECK_APPROVALS = 'deckApprovals';

/** Why an approval stopped applying. */
export type ClearedReason = 'changed' | 'withdrawn';

export interface DeckApproval {
  /** The deck's id, which is also the document's. */
  id: string;
  deckId: string;
  /** `deckFingerprint` of the deck at the moment it was approved. */
  fingerprint: string;
  approvedById: string;
  approvedByEmail: string;
  approvedByName: string;
  /** ISO 8601. */
  approvedAt: string;
  /** Set when a change or a withdrawal cleared it. Absent while it applies. */
  clearedAt?: string;
  clearedReason?: ClearedReason;
  clearedById?: string;
}

/** What the screens and the assignment paths need to know. */
export type ApprovalState =
  | { state: 'approved'; by: string; at: string }
  | { state: 'changed'; by: string; at: string; reason: ClearedReason }
  | { state: 'unapproved' };

export class ApprovalError extends Error {
  constructor(
    readonly status: 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export interface ApprovalOptions {
  /** The document store underneath, before it is scoped. For the tests. */
  store?: DocumentStore;
  now?: () => string;
}

// ------------------------------------------------------------------ who approves

/** What `mayApproveDecks` needs to know about somebody. */
export interface Approver {
  email: string;
  role: Role;
  platform: boolean;
  homeOrgId?: string;
}

/**
 * Whether this person may approve decks.
 *
 * The people listed in DECK_APPROVERS, which is where Srikant's address goes. While
 * that list is empty, every Technavious administrator instead, so UAT can approve decks
 * before the list is settled. Once it holds anybody, it is the whole list: being a
 * Technavious administrator is no longer enough on its own.
 */
export function mayApproveDecks(person: Approver): boolean {
  const listed = deckApprovers();
  if (listed.size > 0) return listed.has(person.email.trim().toLowerCase());
  return isAdministrator(person);
}

// ------------------------------------------------------------------- fingerprint

/** JSON with every object's keys in order and undefined left out, so equal means equal. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, field]) => field !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, field]) => [key, canonical(field)]),
    );
  }
  return value;
}

/**
 * A hash of everything about a deck that a trainee is taught from, and its status.
 *
 * Left out, deliberately: when the outline pass last ran and against which prompt,
 * which change on every re-analysis whether or not the answer does; and each slide's
 * author-only notes, its printed title and its pixel size, none of which reaches the
 * trainer or the trainee. Everything else counts, the topics included, since they are
 * the expertise the trainer answers from.
 *
 * The lesson plan counts too (AI-43): it changes how every slide is taught and how long
 * each part should take, so uploading, changing or removing one needs a fresh approval.
 * Only what the trainer is given counts, not when it was saved, which file it came from,
 * or the alignment, which is worked out from the plan and the slides already counted. A
 * deck with no plan hashes exactly as it did before plans existed, so no approval given
 * then is lost.
 */
export function deckFingerprint(record: DeckRecord, status: DeckStatus): string {
  const meta: Record<string, unknown> = { ...record.meta };
  delete meta.outlineAnalysedAt;
  delete meta.outlinePromptVersion;

  const slides = record.slides.map((slide) => ({
    id: slide.id,
    title: slide.title,
    shortLabel: slide.shortLabel,
    summary: slide.summary,
    image: slide.image,
    bullets: slide.bullets,
    speakerNotes: slide.speakerNotes,
    narrationBrief: slide.narrationBrief,
    keyPoints: slide.keyPoints,
    discussionPrompts: slide.discussionPrompts,
    targetSeconds: slide.targetSeconds,
    teaches: slide.teaches,
    role: slide.role,
  }));

  const plan = record.lessonPlan;
  const lessonPlan = plan
    ? { title: plan.title, sections: plan.sections, outcomes: plan.outcomes }
    : undefined;

  const teachable = canonical({ status, meta, slides, topics: record.topics, lessonPlan });
  return createHash('sha256').update(JSON.stringify(teachable)).digest('hex');
}

// ------------------------------------------------------------------------ rules

/** Where a deck stands, from its approval record and the deck as it is now. */
export function approvalStateOf(
  approval: DeckApproval | undefined,
  record: DeckRecord,
  status: DeckStatus,
): ApprovalState {
  if (!approval) return { state: 'unapproved' };
  const who = approval.approvedByName.trim() || approval.approvedByEmail;
  if (approval.clearedAt) {
    return {
      state: 'changed',
      by: who,
      at: approval.approvedAt,
      reason: approval.clearedReason ?? 'changed',
    };
  }
  if (approval.fingerprint !== deckFingerprint(record, status)) {
    return { state: 'changed', by: who, at: approval.approvedAt, reason: 'changed' };
  }
  return { state: 'approved', by: who, at: approval.approvedAt };
}

function onDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? 'an earlier date'
    : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Why a deck in this state cannot be assigned, in words for the screen, or null if it can. */
export function assignmentRefusalFor(state: ApprovalState): string | null {
  if (state.state === 'approved') return null;
  if (state.state === 'unapproved') {
    return 'This deck has not been approved yet, so it cannot be assigned. It needs approving on its deck page first.';
  }
  return state.reason === 'withdrawn'
    ? `This deck was withdrawn after ${state.by} approved it on ${onDate(state.at)}, so it needs approving again before it can be assigned.`
    : `This deck has changed since ${state.by} approved it on ${onDate(state.at)}, so it needs approving again before it can be assigned.`;
}

// ---------------------------------------------------------------------- storage

const fallback = new InMemoryDocumentStore();

/** One customer's deck approvals, and no other customer's. */
export function deckApprovalDocuments(orgId: string, store?: DocumentStore): DocumentStore {
  return scopedDocuments(store ?? (orgsConfigured() ? firestoreDocuments() : fallback), orgId);
}

export async function deckApprovalFor(
  orgId: string,
  deckId: string,
  options: ApprovalOptions = {},
): Promise<DeckApproval | undefined> {
  return deckApprovalDocuments(orgId, options.store).get<DeckApproval>(DECK_APPROVALS, deckId);
}

/** Where one deck stands. A deck that does not exist is unapproved. */
export async function deckApprovalState(
  orgId: string,
  deckId: string,
  options: ApprovalOptions = {},
): Promise<ApprovalState> {
  const [approval, stored] = await Promise.all([
    deckApprovalFor(orgId, deckId, options),
    loadStoredDeck(orgId, deckId).catch(() => undefined),
  ]);
  if (!stored) return { state: 'unapproved' };
  return approvalStateOf(approval, stored.record, stored.status);
}

/**
 * Where each of a list of decks stands, for the pickers and the library.
 *
 * One read of the approvals, and a deck read only for a deck whose approval still
 * applies, since only its fingerprint is in question. A deck that was never approved, or
 * whose approval was cleared, needs no read to know where it stands.
 */
export async function deckApprovalStates(
  orgId: string,
  decks: readonly Pick<DeckSummary, 'id'>[],
  options: ApprovalOptions = {},
): Promise<Map<string, ApprovalState>> {
  const approvals = new Map(
    (await deckApprovalDocuments(orgId, options.store).all<DeckApproval>(DECK_APPROVALS)).map(
      (approval) => [approval.deckId, approval],
    ),
  );
  const states = new Map<string, ApprovalState>();
  await Promise.all(
    decks.map(async (deck) => {
      const approval = approvals.get(deck.id);
      if (!approval) {
        states.set(deck.id, { state: 'unapproved' });
        return;
      }
      if (approval.clearedAt) {
        // The record alone decides it, so no deck is read.
        states.set(deck.id, {
          state: 'changed',
          by: approval.approvedByName.trim() || approval.approvedByEmail,
          at: approval.approvedAt,
          reason: approval.clearedReason ?? 'changed',
        });
        return;
      }
      const stored = await loadStoredDeck(orgId, deck.id).catch(() => undefined);
      states.set(
        deck.id,
        stored ? approvalStateOf(approval, stored.record, stored.status) : { state: 'unapproved' },
      );
    }),
  );
  return states;
}

/**
 * Why this deck cannot be assigned right now, or null if it can.
 *
 * Every path that gives somebody a deck asks this, after it has found the deck and
 * before it writes anything: the assignments API and trainer-led session creation.
 */
export async function assignmentRefusal(
  orgId: string,
  deckId: string,
  options: ApprovalOptions = {},
): Promise<string | null> {
  return assignmentRefusalFor(await deckApprovalState(orgId, deckId, options));
}

// ---------------------------------------------------------------------- actions

const nowIso = () => new Date().toISOString();

/** Approves the deck as it stands now. Only a published deck: a draft is not finished. */
export async function approveDeck(
  person: SignedInPerson,
  deckId: string,
  options: ApprovalOptions = {},
): Promise<ApprovalState> {
  if (!mayApproveDecks(person)) {
    throw new ApprovalError(403, 'Only the deck approver may approve decks.');
  }
  const stored = await loadStoredDeck(person.orgId, deckId).catch(() => undefined);
  if (!stored) throw new ApprovalError(404, 'No such deck.');
  if (stored.status !== 'published') {
    throw new ApprovalError(
      409,
      'Publish this deck before approving it. Publishing changes the deck, so an approval given to the draft would not last.',
    );
  }

  const approval: DeckApproval = {
    id: deckId,
    deckId,
    fingerprint: deckFingerprint(stored.record, stored.status),
    approvedById: person.id,
    approvedByEmail: person.email,
    approvedByName: person.name,
    approvedAt: (options.now ?? nowIso)(),
  };
  await deckApprovalDocuments(person.orgId, options.store).set(DECK_APPROVALS, deckId, approval);
  await recordAudit(
    person,
    {
      action: 'approved',
      subjectType: 'deck-approval',
      subjectId: deckId,
      detail: `Approved "${stored.record.meta.title}"`,
    },
    { store: options.store },
  );
  return approvalStateOf(approval, stored.record, stored.status);
}

/**
 * Clears a deck's approval, if one applies, so it needs approving again.
 *
 * Returns whether there was one to clear. Read, changed and written in one step, so two
 * saves landing together clear it once and record it once.
 */
export async function clearDeckApproval(
  person: SignedInPerson,
  deckId: string,
  reason: ClearedReason,
  options: ApprovalOptions = {},
): Promise<boolean> {
  const docs = deckApprovalDocuments(person.orgId, options.store);
  const existing = await docs.get<DeckApproval>(DECK_APPROVALS, deckId);
  if (!existing || existing.clearedAt) return false;

  let cleared = false;
  const at = (options.now ?? nowIso)();
  await docs.update<DeckApproval>(DECK_APPROVALS, deckId, (current) => {
    cleared = false;
    if (!current) throw new ApprovalError(404, 'The approval has gone.');
    if (current.clearedAt) return current;
    cleared = true;
    return { ...current, clearedAt: at, clearedReason: reason, clearedById: person.id };
  });

  if (cleared) {
    await recordAudit(
      person,
      {
        action: 'withdrawn',
        subjectType: 'deck-approval',
        subjectId: deckId,
        detail:
          reason === 'withdrawn'
            ? 'Approval cleared because the deck was withdrawn'
            : 'Approval cleared because the deck changed',
      },
      { store: options.store },
    );
  }
  return cleared;
}

/**
 * Called after a deck has been saved, with what was saved.
 *
 * Clears the approval if the deck no longer matches what was approved, and leaves it
 * alone if nothing that counts has changed. Never throws: the save has already happened,
 * and the fingerprint check in `approvalStateOf` refuses an assignment either way.
 */
export async function noteDeckSaved(
  person: SignedInPerson,
  record: DeckRecord,
  status: DeckStatus,
  options: ApprovalOptions = {},
): Promise<void> {
  try {
    const approval = await deckApprovalFor(person.orgId, record.meta.id, options);
    if (!approval || approval.clearedAt) return;
    if (approval.fingerprint === deckFingerprint(record, status)) return;
    await clearDeckApproval(person, record.meta.id, 'changed', options);
  } catch (error) {
    console.error(`[approval] could not check ${record.meta.id}: ${(error as Error).message}`);
  }
}
