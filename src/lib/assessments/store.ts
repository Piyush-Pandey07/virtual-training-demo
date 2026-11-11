/**
 * Where question banks, assessment results and feedback are kept: one customer's, in
 * their own Firestore prefix, through the same document store everything else uses.
 *
 * Falls back to memory when Firebase is not configured, so local builds and tests work.
 *
 * Results and feedback are written once and never changed. The refusal of a second one
 * happens inside the write itself rather than in a read before it, so in Firestore, where
 * the write is a transaction, two submissions arriving together (a double click, or the
 * same page open on two devices) cannot both see "nothing yet" and both be stored.
 */

import 'server-only';

import { firestoreDocuments } from '../firebase/firestore';
import { orgsConfigured } from '../orgs/registry';
import { scopedDocuments } from '../orgs/scope';
import { InMemoryDocumentStore, type DocumentStore } from '../roster/documents';
import type {
  AssessmentResult,
  BankKind,
  FeedbackRecord,
  QuestionBank,
  QuestionBankVersion,
} from './types';

export const QUESTION_BANKS = 'questionBanks';
/** Every version of every bank, kept so a result can always be read against its questions. */
export const QUESTION_BANK_VERSIONS = 'questionBankVersions';
export const ASSESSMENT_RESULTS = 'assessmentResults';
export const FEEDBACK = 'feedback';

const fallback = new InMemoryDocumentStore();

export function assessmentDocuments(orgId: string, store?: DocumentStore): DocumentStore {
  return scopedDocuments(store ?? (orgsConfigured() ? firestoreDocuments() : fallback), orgId);
}

/** Thrown when somebody submits a second time. The first one stands. */
export class AlreadySubmitted extends Error {
  constructor(readonly existing: AssessmentResult | FeedbackRecord) {
    super('This has already been submitted, and cannot be submitted again.');
  }
}

export function bankId(deckId: string, kind: BankKind): string {
  return `${deckId}__${kind}`;
}

export function bankVersionId(deckId: string, kind: BankKind, version: string): string {
  return `${bankId(deckId, kind)}__${version}`;
}

export function resultId(personId: string, deckId: string, kind: BankKind): string {
  return `${personId}__${deckId}__${kind}`;
}

/**
 * One per participant per deck, or per trainer-led session of a deck.
 *
 * A participant who attends the same deck twice in two trainer-led sessions is asked for
 * feedback on each, because a different facilitator and room are exactly what the
 * questions are about.
 */
export function feedbackId(personId: string, deckId: string, sessionId: string | null): string {
  return sessionId ? `${personId}__${deckId}__${sessionId}` : `${personId}__${deckId}`;
}

export class AssessmentStore {
  constructor(private readonly docs: DocumentStore) {}

  getBank(deckId: string, kind: BankKind): Promise<QuestionBank | undefined> {
    return this.docs.get<QuestionBank>(QUESTION_BANKS, bankId(deckId, kind));
  }
  saveBank(bank: QuestionBank): Promise<void> {
    return this.docs.set(QUESTION_BANKS, bank.id, bank);
  }
  /** Read, change and write a bank without another administrator's save getting between. */
  updateBank(
    deckId: string,
    kind: BankKind,
    change: (current: QuestionBank | undefined) => QuestionBank,
  ): Promise<QuestionBank> {
    return this.docs.update<QuestionBank>(QUESTION_BANKS, bankId(deckId, kind), change);
  }
  removeBank(deckId: string, kind: BankKind): Promise<void> {
    return this.docs.remove(QUESTION_BANKS, bankId(deckId, kind));
  }

  getBankVersion(
    deckId: string,
    kind: BankKind,
    version: string,
  ): Promise<QuestionBankVersion | undefined> {
    return this.docs.get<QuestionBankVersion>(
      QUESTION_BANK_VERSIONS,
      bankVersionId(deckId, kind, version),
    );
  }
  /** Every kept version of a deck's bank of this kind, oldest first. */
  async bankVersions(deckId: string, kind: BankKind): Promise<QuestionBankVersion[]> {
    const versions = await this.docs.where<QuestionBankVersion>(
      QUESTION_BANK_VERSIONS,
      'bankId',
      bankId(deckId, kind),
    );
    return versions.sort((a, b) => a.versionNumber - b.versionNumber);
  }
  /** Keeps a version. Writing the same one twice changes nothing, since a version never does. */
  keepBankVersion(version: QuestionBankVersion): Promise<void> {
    return this.docs.set(QUESTION_BANK_VERSIONS, version.id, version);
  }

  getResult(
    personId: string,
    deckId: string,
    kind: BankKind,
  ): Promise<AssessmentResult | undefined> {
    return this.docs.get<AssessmentResult>(ASSESSMENT_RESULTS, resultId(personId, deckId, kind));
  }
  resultsForDeck(deckId: string): Promise<AssessmentResult[]> {
    return this.docs.where<AssessmentResult>(ASSESSMENT_RESULTS, 'deckId', deckId);
  }
  resultsForPerson(personId: string): Promise<AssessmentResult[]> {
    return this.docs.where<AssessmentResult>(ASSESSMENT_RESULTS, 'personId', personId);
  }
  /** Stores a result, or throws `AlreadySubmitted` if there already is one. */
  async recordResult(result: AssessmentResult): Promise<AssessmentResult> {
    return this.docs.update<AssessmentResult>(ASSESSMENT_RESULTS, result.id, (current) => {
      if (current) throw new AlreadySubmitted(current);
      return result;
    });
  }

  getFeedback(
    personId: string,
    deckId: string,
    sessionId: string | null,
  ): Promise<FeedbackRecord | undefined> {
    return this.docs.get<FeedbackRecord>(FEEDBACK, feedbackId(personId, deckId, sessionId));
  }
  feedbackForDeck(deckId: string): Promise<FeedbackRecord[]> {
    return this.docs.where<FeedbackRecord>(FEEDBACK, 'deckId', deckId);
  }
  /** Stores feedback, or throws `AlreadySubmitted` if this person has already given it. */
  async recordFeedback(record: FeedbackRecord): Promise<FeedbackRecord> {
    return this.docs.update<FeedbackRecord>(FEEDBACK, record.id, (current) => {
      if (current) throw new AlreadySubmitted(current);
      return record;
    });
  }
}

export function assessmentStore(orgId: string, store?: DocumentStore): AssessmentStore {
  return new AssessmentStore(assessmentDocuments(orgId, store));
}
