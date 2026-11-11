/**
 * Question banks, assessments and feedback, as the routes, pages and the participant
 * journey use them (BRD v2.3: AI-04, AI-29, AI-31).
 *
 * Everything that decides something lives here rather than in a route, so the rules
 * hold however a screen reaches them: one attempt at each assessment, feedback after the
 * post-session assessment and once, results and feedback shown only to the people
 * `access.ts` names, and a correct answer never leaving the server.
 *
 * The functions the participant journey and the trainer prompt need take the
 * organisation first, like every other reader of a customer's data. The ones that act
 * for somebody take the signed-in person, whose organisation is already settled.
 *
 * The audit history (AI-40) is written here too, for the same reason: submitting a
 * result, viewing a deck's results, and saving, re-banding or removing a bank are each
 * recorded once however a screen or route reaches them.
 */

import 'server-only';

import { recordAudit } from '../audit/log';
import { isAdministrator, isCompanyAdmin } from '../auth/permissions';
import { isRestricted, visibleOnly, visibleTo } from '../retention/restricted';
import type { DocumentStore } from '../roster/documents';
import { rosterStore } from '../roster/registry';
import type { RosterStore } from '../roster/store';
import type { Person, SignedInPerson } from '../roster/types';
import { trainingStore } from '../training/store';
import type { TrainingSession } from '../training/types';
import {
  mayManageBanks,
  mayOpenResults,
  mayReviewSession,
  maySeeFeedbackAtAll,
  maySeeResultsOf,
} from './access';
import { assessmentHref, feedbackHref } from './paths';
import {
  bandsOf,
  checkFeedback,
  levelFor,
  levelWithBands,
  mark,
  mostCommonLevel,
  outcomeCounts,
  paperFor,
  passes,
} from './scoring';
import {
  AlreadySubmitted,
  assessmentStore,
  bankId,
  bankVersionId,
  feedbackId,
  resultId,
} from './store';
import {
  CURRENT_FEEDBACK_SET,
  PASS_MARK,
  type AssessmentPaper,
  type AssessmentResult,
  type BankKind,
  type BankQuestion,
  type BankSource,
  type BankVersionSummary,
  type FeedbackRecord,
  type Level,
  type LevelBands,
  type QuestionBank,
  type QuestionBankVersion,
  type ResultsRow,
} from './types';

export { AlreadySubmitted } from './store';

export interface ServiceOptions {
  /** The document store underneath, before it is scoped. For the tests. */
  store?: DocumentStore;
  /** The roster, for assignments, attempts and names. For the tests. */
  roster?: RosterStore;
}

/** A refusal with the status a route should send and words a person can act on. */
export class Refused extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

function rosterFor(orgId: string, options: ServiceOptions): RosterStore {
  return options.roster ?? rosterStore(orgId);
}

export function hasQuestions(bank: QuestionBank | undefined): bank is QuestionBank {
  return Boolean(bank && bank.questions.length > 0);
}

// ------------------------------------------------- for the journey and the trainer

/**
 * Where the pre-session assessment placed this participant for this deck, or null when
 * they have not taken it (or the deck has no pre-session bank).
 *
 * For the trainer prompt, which pitches the session at this level.
 *
 * Null as well once the result is restricted under the retention policy (AI-41). The
 * level is the result's content, and pitching a session at it is using it. It is also
 * at least 90 days old by then, which is a poor guide to what somebody knows today, and
 * the standard explanation is what a participant with no level gets anyway.
 */
export async function assessedLevel(
  orgId: string,
  personId: string,
  deckId: string,
  options: ServiceOptions = {},
): Promise<Level | null> {
  const result = await assessmentStore(orgId, options.store).getResult(personId, deckId, 'pre');
  return visibleTo(null, result)?.level ?? null;
}

/**
 * A trainer-led session's level (AI-37): the level most of its attendees are at, and on
 * a tie the lower one, so the pitch suits the most people and leaves nobody behind.
 *
 * Attendees are the people listed who have not been marked absent. Each is placed by
 * this session's bands, from their pre-session score. Somebody with no result counts as
 * Beginner: they may simply not have taken it, and pitching above them is the worse
 * mistake. So is somebody whose result is restricted under the retention policy (AI-41),
 * whose level is no longer used, as for `assessedLevel`.
 *
 * Null when nobody is attending, or when the deck has no pre-session assessment and so
 * nobody could have been placed, which leaves the trainer's instruction as it was.
 */
export async function groupLevel(
  orgId: string,
  session: Pick<TrainingSession, 'deckId' | 'participantIds' | 'attendance' | 'levelBands'>,
  options: ServiceOptions = {},
): Promise<Level | null> {
  const attendees = session.participantIds.filter((id) => session.attendance[id] !== 'absent');
  if (attendees.length === 0) return null;
  const store = assessmentStore(orgId, options.store);
  const [bank, results] = await Promise.all([
    store.getBank(session.deckId, 'pre'),
    Promise.all(attendees.map((id) => store.getResult(id, session.deckId, 'pre'))),
  ]);
  if (!hasQuestions(bank) && results.every((result) => result === undefined)) return null;
  const bands = session.levelBands ?? bandsOf(bank);
  return mostCommonLevel(
    results.map((result) => {
      const usable = visibleTo(null, result);
      return usable ? levelWithBands(usable, bands) : 'beginner';
    }),
  );
}

/** Whether this participant has submitted the pre-session assessment for this deck. */
export async function preAssessmentDone(
  orgId: string,
  personId: string,
  deckId: string,
  options: ServiceOptions = {},
): Promise<boolean> {
  const result = await assessmentStore(orgId, options.store).getResult(personId, deckId, 'pre');
  return result !== undefined;
}

/**
 * Whether this participant must take the pre-session assessment before starting a
 * session of this deck: the deck has a pre-session bank and they have not submitted it.
 * A deck without one asks nothing.
 */
export async function preAssessmentRequired(
  orgId: string,
  personId: string,
  deckId: string,
  options: ServiceOptions = {},
): Promise<boolean> {
  const store = assessmentStore(orgId, options.store);
  const [bank, result] = await Promise.all([
    store.getBank(deckId, 'pre'),
    store.getResult(personId, deckId, 'pre'),
  ]);
  return hasQuestions(bank) && result === undefined;
}

/** Whether this participant has submitted the post-session assessment for this deck. */
export async function postAssessmentDone(
  orgId: string,
  personId: string,
  deckId: string,
  options: ServiceOptions = {},
): Promise<boolean> {
  const result = await assessmentStore(orgId, options.store).getResult(personId, deckId, 'post');
  return result !== undefined;
}

/** Whether this participant has given feedback on this deck, or on this trainer-led session. */
export async function feedbackDone(
  orgId: string,
  personId: string,
  deckId: string,
  sessionId: string | null = null,
  options: ServiceOptions = {},
): Promise<boolean> {
  const record = await assessmentStore(orgId, options.store).getFeedback(
    personId,
    deckId,
    sessionId,
  );
  return record !== undefined;
}

export interface NextStep {
  step: 'post' | 'feedback';
  href: string;
  label: string;
}

/**
 * What a participant should do once the session ends: the post-session assessment if the
 * deck has one and they have not taken it, then feedback, then nothing.
 */
export async function nextStepAfterSession(
  orgId: string,
  personId: string,
  deckId: string,
  sessionId: string | null = null,
  options: ServiceOptions = {},
): Promise<NextStep | null> {
  const store = assessmentStore(orgId, options.store);
  const [bank, post, feedback] = await Promise.all([
    store.getBank(deckId, 'post'),
    store.getResult(personId, deckId, 'post'),
    store.getFeedback(personId, deckId, sessionId),
  ]);
  if (hasQuestions(bank) && !post) {
    return {
      step: 'post',
      href: assessmentHref('post', deckId, sessionId),
      label: 'Take the short assessment',
    };
  }
  if (!feedback) {
    return { step: 'feedback', href: feedbackHref(deckId, sessionId), label: 'Give your feedback' };
  }
  return null;
}

/** The questions a participant is shown, without answers, or null when there is no bank. */
export async function assessmentPaper(
  orgId: string,
  deckId: string,
  kind: BankKind,
  options: ServiceOptions = {},
): Promise<AssessmentPaper | null> {
  const bank = await assessmentStore(orgId, options.store).getBank(deckId, kind);
  return hasQuestions(bank) ? paperFor(bank) : null;
}

/**
 * The paper this participant is given: the current questions, without answers, in the
 * order that is theirs for this version (see `paperFor`). Null when there is no bank.
 */
export async function assessmentPaperFor(
  person: SignedInPerson,
  deckId: string,
  kind: BankKind,
  options: ServiceOptions = {},
): Promise<AssessmentPaper | null> {
  const bank = await assessmentStore(person.orgId, options.store).getBank(deckId, kind);
  return hasQuestions(bank) ? paperFor(bank, person.id) : null;
}

/**
 * This participant's own result, if they have one.
 *
 * Whether or not it is restricted, because the journey needs to know it was taken: a
 * restricted result still stands, and the participant is not offered the paper again.
 * A screen that shows it asks `visibleTo` first.
 */
export async function ownResult(
  orgId: string,
  personId: string,
  deckId: string,
  kind: BankKind,
  options: ServiceOptions = {},
): Promise<AssessmentResult | undefined> {
  return assessmentStore(orgId, options.store).getResult(personId, deckId, kind);
}

// ------------------------------------------------------------- participating

/**
 * Whether this person is a participant in this deck, and in which trainer-led session.
 *
 * AI-led, they must have been assigned the deck, exactly as for attending it; an
 * administrator may attend anything in their own company and so passes. Trainer-led,
 * they must be on that session's list, and the session must be of this deck. Anything
 * else is a 404, for the same reason the session page gives one: a refusal that said
 * "not yours" would confirm the deck exists.
 */
export async function participation(
  person: SignedInPerson,
  deckId: string,
  sessionId: string | null,
  options: ServiceOptions = {},
): Promise<{ session: TrainingSession | null }> {
  if (sessionId) {
    const session = await trainingStore(person.orgId, options.store).getSession(sessionId);
    if (!session || session.deckId !== deckId || !session.participantIds.includes(person.id)) {
      throw new Refused(404, 'Not found.');
    }
    return { session };
  }
  if (person.role === 'admin') return { session: null };
  const assigned = await rosterFor(person.orgId, options).isAssigned(person.id, deckId);
  if (!assigned) throw new Refused(404, 'Not found.');
  return { session: null };
}

/**
 * Whether this participant has attended the session the post-session assessment and
 * feedback are about.
 *
 * AI-led, they have started it: there is an attempt. Not finished it, because a
 * participant who ends a little short of the completion mark has still sat the session
 * and is exactly who the assessment should measure. Trainer-led, the facilitator has
 * opened the session and has not marked them absent.
 */
export async function hasAttended(
  person: SignedInPerson,
  deckId: string,
  session: TrainingSession | null,
  options: ServiceOptions = {},
): Promise<boolean> {
  if (session) {
    // A cancelled session never took place, so there is nothing to have attended.
    if (session.status === 'cancelled') return false;
    // Marked present by the facilitator, and nothing less: somebody not yet marked may
    // still be on their way, doing the pre-session assessment first (AI-26), and must not
    // reach the post-session one by its address before they have joined.
    return (
      session.attendance[person.id] === 'present' &&
      (session.openedAt !== null || session.status !== 'scheduled')
    );
  }
  const attempt = await rosterFor(person.orgId, options)
    .getAttempt(person.id, deckId)
    .catch(() => undefined);
  return attempt !== undefined;
}

/**
 * Whether the pre-session assessment has closed for this participant: in a trainer-led
 * session, once the facilitator has marked them present or absent. Until then it stays
 * open, even after the session has started, so somebody arriving late can take it on
 * their own device before they join (AI-26, AI-32). Taken once they are in the room it
 * would measure what the session taught, not what they knew coming in, and skew both
 * the pre and post comparison and the level the trainer pitches to. Somebody who missed
 * it goes on to the post-session assessment without it.
 *
 * Closed for everybody once the session is closed, when everybody has been marked
 * anyway, or cancelled, when there is no session to prepare for.
 *
 * Never for a one-to-one session, whose pre-session assessment is what lets it start:
 * closing it there would lock out somebody whose deck gained one part-way through.
 */
export function preAssessmentClosed(session: TrainingSession | null, personId: string): boolean {
  if (session === null) return false;
  if (session.status === 'closed' || session.status === 'cancelled') return true;
  return session.attendance[personId] !== undefined;
}

export interface SubmittedAnswers {
  deckId: string;
  kind: BankKind;
  /** The bank version the participant was shown. */
  version: string;
  /** Chosen option index, by question id. */
  answers: Record<string, unknown>;
  sessionId: string | null;
}

/**
 * Marks and stores one participant's assessment.
 *
 * Marked against the version of the questions the participant was shown, which is kept
 * even once the bank has been replaced, so somebody answering while an administrator
 * uploaded new questions is marked on the paper they sat. Questions left blank are Not
 * attempted and score nothing; they do not stop the paper being marked.
 *
 * Throws `Refused` for anything the participant can act on, `AnswersRejected` for a
 * paper that is not the version it claims, and `AlreadySubmitted` for a second attempt,
 * whose first result stands. The result is stored once and never changed, which is the
 * whole of the no-retake rule: it is enforced here, in the write, and not by a screen
 * hiding a button.
 */
export async function submitAssessment(
  person: SignedInPerson,
  input: SubmittedAnswers,
  options: ServiceOptions = {},
): Promise<AssessmentResult> {
  const { session } = await participation(person, input.deckId, input.sessionId, options);
  const store = assessmentStore(person.orgId, options.store);

  // Checked before the bank is even read, so somebody who has already submitted is told
  // that rather than told about a changed paper.
  const existing = await store.getResult(person.id, input.deckId, input.kind);
  if (existing) throw new AlreadySubmitted(existing);

  const bank = await store.getBank(input.deckId, input.kind);
  if (!hasQuestions(bank)) throw new Refused(404, 'There is no assessment for this deck.');
  // The current version, or an earlier one this participant was shown before it was
  // replaced. A version nobody kept is a paper this server never gave out.
  const taken:
    Pick<QuestionBank, 'questions' | 'version' | 'versionNumber' | 'source'> | undefined =
    bank.version === input.version
      ? bank
      : await store.getBankVersion(input.deckId, input.kind, input.version);
  if (!taken || taken.questions.length === 0) {
    throw new Refused(
      409,
      'The questions changed while you were answering. Reload the page to see the current ones.',
    );
  }

  if (input.kind === 'pre' && preAssessmentClosed(session, person.id)) {
    throw new Refused(
      409,
      session?.status === 'cancelled'
        ? 'This session was cancelled.'
        : 'The pre-session assessment closed when you were marked in the session.',
    );
  }
  if (input.kind === 'post' && !(await hasAttended(person, input.deckId, session, options))) {
    throw new Refused(409, 'The post-session assessment opens once you have attended the session.');
  }

  const marked = mark(taken.questions, input.answers);
  const result: AssessmentResult = {
    id: resultId(person.id, input.deckId, input.kind),
    personId: person.id,
    deckId: input.deckId,
    kind: input.kind,
    sessionId: session?.id ?? null,
    answers: marked.answers,
    correct: marked.correct,
    wrong: marked.wrong,
    notAttempted: marked.notAttempted,
    total: marked.total,
    percent: marked.percent,
    bankVersion: taken.version,
    bankSource: taken.source,
    submittedAt: new Date().toISOString(),
  };
  if (taken.versionNumber !== undefined) result.bankVersionNumber = taken.versionNumber;
  if (input.kind === 'pre') {
    // Placed by the trainer-led session's bands when taken for one, and otherwise by the
    // deck's. Only ever a level: nobody fails the pre-session assessment.
    const bands = session?.levelBands ?? bandsOf(bank);
    result.level = levelFor(marked.percent, bands);
    result.bands = bands;
  } else {
    result.passed = passes(marked.percent, PASS_MARK);
    result.passMark = PASS_MARK;
  }

  const recorded = await store.recordResult(result);
  await recordAudit(
    person,
    {
      action: 'created',
      subjectType: 'assessment-result',
      subjectId: recorded.id,
      detail: `Submitted the ${input.kind}-session assessment for ${input.deckId}: ${recorded.percent}%`,
    },
    { store: options.store },
  );
  return recorded;
}

export interface SubmittedFeedback {
  deckId: string;
  sessionId: string | null;
  questionSetId: string;
  ratings: unknown;
  comments: unknown;
}

/**
 * Stores one participant's feedback.
 *
 * After the session, and after the post-session assessment when the deck has one,
 * because AI-31 asks for feedback straight after it and a rating of a session somebody
 * has not attended tells nobody anything. Once per deck, or per trainer-led session.
 */
export async function submitFeedback(
  person: SignedInPerson,
  input: SubmittedFeedback,
  options: ServiceOptions = {},
): Promise<FeedbackRecord> {
  const { session } = await participation(person, input.deckId, input.sessionId, options);
  const store = assessmentStore(person.orgId, options.store);

  const existing = await store.getFeedback(person.id, input.deckId, session?.id ?? null);
  if (existing) throw new AlreadySubmitted(existing);

  if (input.questionSetId !== CURRENT_FEEDBACK_SET.id) {
    throw new Refused(409, 'That feedback form is out of date. Reload the page.');
  }
  if (!(await hasAttended(person, input.deckId, session, options))) {
    throw new Refused(409, 'Feedback opens once you have attended the session.');
  }
  const [postBank, postResult] = await Promise.all([
    store.getBank(input.deckId, 'post'),
    store.getResult(person.id, input.deckId, 'post'),
  ]);
  if (hasQuestions(postBank) && !postResult) {
    throw new Refused(
      409,
      'Take the post-session assessment first. Feedback comes straight after it.',
    );
  }

  const checked = checkFeedback(input.ratings, input.comments);
  if (!checked.ok) throw new Refused(400, checked.error);

  return store.recordFeedback({
    id: feedbackId(person.id, input.deckId, session?.id ?? null),
    personId: person.id,
    deckId: input.deckId,
    sessionId: session?.id ?? null,
    questionSetId: CURRENT_FEEDBACK_SET.id,
    ratings: checked.feedback.ratings,
    comments: checked.feedback.comments,
    submittedAt: new Date().toISOString(),
  });
}

// ----------------------------------------------------------- managing banks

function newVersion(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${Date.now().toString(36)}-${Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('')}`;
}

function refuseUnlessAdministrator(viewer: SignedInPerson): void {
  // A 404, as for the rest of an administrator's tools: a facilitator or company
  // administrator does not need to learn the screen exists.
  if (!mayManageBanks(viewer)) throw new Refused(404, 'Not found.');
}

/** A deck's bank as the administrator's screen shows it, answers included. */
export async function bankForAdministrator(
  viewer: SignedInPerson,
  deckId: string,
  kind: BankKind,
  options: ServiceOptions = {},
): Promise<QuestionBank | null> {
  refuseUnlessAdministrator(viewer);
  return (await assessmentStore(viewer.orgId, options.store).getBank(deckId, kind)) ?? null;
}

/** A bank as the version kept of it. */
function versionOf(bank: QuestionBank, versionNumber: number): QuestionBankVersion {
  return {
    id: bankVersionId(bank.deckId, bank.kind, bank.version),
    bankId: bank.id,
    deckId: bank.deckId,
    kind: bank.kind,
    version: bank.version,
    versionNumber,
    questions: bank.questions,
    source: bank.source,
    savedBy: bank.savedBy,
    savedAt: bank.savedAt,
  };
}

/**
 * Saves a bank's questions as its new version.
 *
 * Participants are given the new version from now on, and every earlier one is kept, so
 * a result is always marked and read against the questions it was taken on. A bank saved
 * before versions were kept is kept too, the first time it is replaced, numbered after
 * any versions already kept.
 *
 * The level bands survive a replacement, since they are a decision about the deck and
 * not about one set of questions. A sample never replaces an uploaded bank: that would
 * swap questions the user team wrote for ones nobody has checked.
 */
export async function saveBank(
  viewer: SignedInPerson,
  deckId: string,
  kind: BankKind,
  questions: Omit<BankQuestion, 'id'>[],
  source: BankSource,
  options: ServiceOptions = {},
): Promise<QuestionBank> {
  refuseUnlessAdministrator(viewer);
  if (questions.length === 0) throw new Refused(400, 'A bank needs at least one question.');

  const store = assessmentStore(viewer.orgId, options.store);
  const kept = await store.bankVersions(deckId, kind);
  const highestKept = kept.reduce((highest, each) => Math.max(highest, each.versionNumber), 0);

  // What the save replaced, and the number it is kept under. Set inside the change, which
  // may run more than once in a transaction, so the last run is the one that stands.
  let replaced: { bank: QuestionBank; versionNumber: number } | null = null;
  const saved = await store.updateBank(deckId, kind, (current) => {
    if (source === 'sample' && current?.source === 'upload') {
      throw new Refused(
        409,
        'This deck already has an uploaded bank. Remove it first if you really want a sample in its place.',
      );
    }
    replaced = null;
    let before = highestKept;
    if (current) {
      const number =
        current.versionNumber ??
        kept.find((each) => each.version === current.version)?.versionNumber ??
        highestKept + 1;
      replaced = { bank: current, versionNumber: number };
      before = Math.max(before, number);
    }
    const bank: QuestionBank = {
      id: bankId(deckId, kind),
      deckId,
      kind,
      questions: questions.map((question, index) => ({
        id: `q${index + 1}`,
        question: question.question,
        options: [...question.options],
        correctIndex: question.correctIndex,
      })),
      source,
      version: newVersion(),
      versionNumber: before + 1,
      savedBy: viewer.id,
      savedAt: new Date().toISOString(),
    };
    if (kind === 'pre') {
      bank.bands = bandsOf(current);
      if (current?.bandsChosen) bank.bandsChosen = true;
    }
    return bank;
  });

  // Kept after the write rather than inside it, since the store's transaction covers one
  // document. Writing a version twice is harmless, so a retry loses nothing.
  const previous = replaced as { bank: QuestionBank; versionNumber: number } | null;
  if (previous && !kept.some((each) => each.version === previous.bank.version)) {
    await store.keepBankVersion(versionOf(previous.bank, previous.versionNumber));
  }
  await store.keepBankVersion(versionOf(saved, saved.versionNumber ?? highestKept + 1));

  await recordAudit(
    viewer,
    {
      action: source === 'upload' ? 'uploaded' : 'created',
      subjectType: 'question-bank',
      subjectId: saved.id,
      detail: `${source === 'upload' ? 'Uploaded' : 'Generated a sample'} ${kind}-session bank of ${saved.questions.length} questions for ${deckId}, as version ${saved.versionNumber}`,
    },
    { store: options.store },
  );
  return saved;
}

/** Every kept version of a deck's bank, oldest first, for the administrator's screen. */
export async function bankVersionsForAdministrator(
  viewer: SignedInPerson,
  deckId: string,
  kind: BankKind,
  options: ServiceOptions = {},
): Promise<BankVersionSummary[]> {
  refuseUnlessAdministrator(viewer);
  const versions = await assessmentStore(viewer.orgId, options.store).bankVersions(deckId, kind);
  return versions.map((each) => ({
    version: each.version,
    versionNumber: each.versionNumber,
    source: each.source,
    questions: each.questions.length,
    savedAt: each.savedAt,
  }));
}

/** Changes the pre-session bank's level bands. Results already given keep their level. */
export async function setLevelBands(
  viewer: SignedInPerson,
  deckId: string,
  bands: LevelBands,
  options: ServiceOptions = {},
): Promise<QuestionBank> {
  refuseUnlessAdministrator(viewer);
  const store = assessmentStore(viewer.orgId, options.store);
  if (!(await store.getBank(deckId, 'pre'))) {
    throw new Refused(404, 'Upload or generate the pre-session bank first.');
  }
  const saved = await store.updateBank(deckId, 'pre', (current) => {
    if (!current) throw new Refused(404, 'Upload or generate the pre-session bank first.');
    return {
      ...current,
      bands,
      bandsChosen: true,
      savedBy: viewer.id,
      savedAt: new Date().toISOString(),
    };
  });
  await recordAudit(
    viewer,
    {
      action: 'updated',
      subjectType: 'question-bank',
      subjectId: saved.id,
      detail: `Changed the level bands of the pre-session bank for ${deckId}`,
    },
    { store: options.store },
  );
  return saved;
}

/**
 * Removes a bank. Results already given stay, and so does every version of its questions
 * they were scored against, because a participant's result is a record of what happened
 * and not of the current bank.
 */
export async function removeBank(
  viewer: SignedInPerson,
  deckId: string,
  kind: BankKind,
  options: ServiceOptions = {},
): Promise<void> {
  refuseUnlessAdministrator(viewer);
  const store = assessmentStore(viewer.orgId, options.store);
  // A bank saved before versions were kept has no kept copy yet, so it is given one
  // before it goes.
  const [current, kept] = await Promise.all([
    store.getBank(deckId, kind),
    store.bankVersions(deckId, kind),
  ]);
  if (current && !kept.some((each) => each.version === current.version)) {
    const highestKept = kept.reduce((highest, each) => Math.max(highest, each.versionNumber), 0);
    await store.keepBankVersion(versionOf(current, current.versionNumber ?? highestKept + 1));
  }
  await store.removeBank(deckId, kind);
  await recordAudit(
    viewer,
    {
      action: 'deleted',
      subjectType: 'question-bank',
      subjectId: bankId(deckId, kind),
      detail: `Removed the ${kind}-session bank for ${deckId}`,
    },
    { store: options.store },
  );
}

// ---------------------------------------------------------------- reporting

export interface RatingAverage {
  id: string;
  prompt: string;
  /** To one decimal place, or null when nobody has answered it. */
  average: number | null;
  count: number;
}

export interface FeedbackSummary {
  responses: number;
  pending: number;
  averages: RatingAverage[];
  /** Comments as written, newest first, without names. */
  comments: { text: string; submittedAt: string }[];
}

export interface DeckResults {
  rows: ResultsRow[];
  /** Null when this viewer is not shown feedback at all. */
  feedback: FeedbackSummary | null;
  session: TrainingSession | null;
}

function nameless(personId: string): Pick<Person, 'name' | 'email'> & { id: string } {
  return { id: personId, name: 'Somebody no longer on the roster', email: '' };
}

/**
 * The results and feedback screen for one deck, or for one trainer-led session of it.
 *
 * Lists everybody who should take part: who was assigned the deck, who is on a
 * trainer-led session of it, and anybody who has a result or feedback for it anyway.
 * Each viewer sees only the participants `access.ts` lets them see, so a facilitator's
 * screen lists only the people in their own sessions and batches. Feedback is summarised
 * from the visible participants only, so an average cannot carry somebody else's ratings.
 */
export async function resultsForDeck(
  viewer: SignedInPerson,
  deckId: string,
  sessionId: string | null = null,
  options: ServiceOptions = {},
): Promise<DeckResults> {
  if (!mayOpenResults(viewer)) throw new Refused(404, 'Not found.');

  const training = trainingStore(viewer.orgId, options.store);
  const assessments = assessmentStore(viewer.orgId, options.store);
  const roster = rosterFor(viewer.orgId, options);

  let session: TrainingSession | null = null;
  if (sessionId) {
    const found = await training.getSession(sessionId);
    if (!found || found.deckId !== deckId || !mayReviewSession(viewer, found)) {
      throw new Refused(404, 'Not found.');
    }
    session = found;
  }

  const [people, assignments, sessions, stored, storedFeedback] = await Promise.all([
    roster.listPeople().catch(() => [] as Person[]),
    session ? Promise.resolve([]) : roster.listAssignmentsForDeck(deckId).catch(() => []),
    session ? Promise.resolve([session]) : training.listSessions(),
    assessments.resultsForDeck(deckId),
    assessments.feedbackForDeck(deckId),
  ]);

  // Restricted records (AI-41) are left out for everybody but administrators, before
  // anything is counted or averaged, so a facilitator's averages cannot carry them. The
  // people they belong to are still listed, marked restricted, rather than shown as
  // having taken nothing.
  const results = visibleOnly(viewer, stored);
  const feedback = visibleOnly(viewer, storedFeedback);
  const restrictedFor = new Set(
    [...stored, ...storedFeedback.filter((record) => !session || record.sessionId === session.id)]
      .filter((record) => isRestricted(record))
      .map((record) => record.personId),
  );

  const relevantFeedback = session
    ? feedback.filter((record) => record.sessionId === session.id)
    : feedback;

  const candidates = new Set<string>();
  if (session) {
    session.participantIds.forEach((id) => candidates.add(id));
  } else {
    assignments.forEach((assignment) => candidates.add(assignment.personId));
    sessions
      .filter((each) => each.deckId === deckId)
      .forEach((each) => each.participantIds.forEach((id) => candidates.add(id)));
    results.forEach((result) => candidates.add(result.personId));
    relevantFeedback.forEach((record) => candidates.add(record.personId));
    restrictedFor.forEach((personId) => candidates.add(personId));
  }

  // Administrators of either kind see the whole company; anybody else is asked about each
  // person, which for a facilitator is `facilitatesPerson`.
  const everybody = isAdministrator(viewer) || isCompanyAdmin(viewer);
  const ids = [...candidates];
  const allowed = everybody
    ? ids
    : (
        await Promise.all(
          ids.map(async (id) => ((await maySeeResultsOf(viewer, id, options)) ? id : null)),
        )
      ).filter((id): id is string => id !== null);
  const visible = new Set(allowed);

  const byId = new Map(people.map((person) => [person.id, person]));
  const resultFor = (personId: string, kind: BankKind) =>
    results.find((result) => result.personId === personId && result.kind === kind);
  const showFeedback = maySeeFeedbackAtAll(viewer);
  const gaveFeedback = new Set(relevantFeedback.map((record) => record.personId));

  const rows: ResultsRow[] = [...visible].map((personId) => {
    const person = byId.get(personId) ?? nameless(personId);
    const pre = resultFor(personId, 'pre');
    const post = resultFor(personId, 'post');
    return {
      personId,
      name: person.name || person.email || 'Unnamed',
      email: person.email,
      pre: pre
        ? {
            ...outcomeCounts(pre),
            percent: pre.percent,
            // Narrowed to a trainer-led session, the level that session's bands give,
            // which is the one its trainer pitched to.
            level: session ? levelWithBands(pre, session.levelBands) : (pre.level ?? null),
            submittedAt: pre.submittedAt,
            versionNumber: pre.bankVersionNumber ?? null,
          }
        : null,
      post: post
        ? {
            ...outcomeCounts(post),
            percent: post.percent,
            passed: post.passed === true,
            submittedAt: post.submittedAt,
            sessionId: post.sessionId ?? null,
            versionNumber: post.bankVersionNumber ?? null,
          }
        : null,
      feedback: showFeedback ? (gaveFeedback.has(personId) ? 'submitted' : 'pending') : null,
      restricted: restrictedFor.has(personId),
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));

  // What was shown, to whom: the deck, the session if narrowed to one, and how many
  // people's results were on the screen (AI-40).
  await recordAudit(
    viewer,
    {
      action: 'viewed',
      subjectType: 'assessment-result',
      subjectId: session ? `${deckId}/${session.id}` : deckId,
      detail: `Viewed results for ${rows.length} ${rows.length === 1 ? 'person' : 'people'} on ${deckId}${session ? `, session ${session.id}` : ''}`,
    },
    { store: options.store },
  );

  return {
    rows,
    session,
    feedback: showFeedback
      ? summariseFeedback(
          relevantFeedback.filter((record) => visible.has(record.personId)),
          // Somebody whose feedback is restricted gave it, and is not waiting to.
          rows.filter((row) => row.feedback === 'pending' && !row.restricted).length,
        )
      : null,
  };
}

/** Averages per rating and the comments, from the records given. */
export function summariseFeedback(records: FeedbackRecord[], pending: number): FeedbackSummary {
  const averages: RatingAverage[] = CURRENT_FEEDBACK_SET.questions
    .filter((question) => question.kind === 'rating')
    .map((question) => {
      const values = records
        .map((record) => record.ratings[question.id])
        .filter((value): value is number => typeof value === 'number');
      const average =
        values.length === 0
          ? null
          : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
      return { id: question.id, prompt: question.prompt, average, count: values.length };
    });

  const comments = records
    .flatMap((record) =>
      Object.values(record.comments).map((text) => ({ text, submittedAt: record.submittedAt })),
    )
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  return { responses: records.length, pending, averages, comments };
}
