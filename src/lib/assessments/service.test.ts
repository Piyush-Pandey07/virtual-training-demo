import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { InMemoryDocumentStore } from '../roster/documents';
import { DocumentRosterStore } from '../roster/store-documents';
import type { Role, SignedInPerson } from '../roster/types';
import { trainingStore } from '../training/store';
import type { TrainingSession } from '../training/types';
import { mayManageBanks, mayOpenResults, maySeeFeedbackOf, maySeeResultsOf } from './access';
import { AnswersRejected } from './scoring';
import {
  AlreadySubmitted,
  assessedLevel,
  assessmentPaper,
  feedbackDone,
  nextStepAfterSession,
  postAssessmentDone,
  preAssessmentDone,
  preAssessmentRequired,
  Refused,
  resultsForDeck,
  saveBank,
  setLevelBands,
  submitAssessment,
  submitFeedback,
  type ServiceOptions,
} from './service';
import { assessmentStore } from './store';
import { CURRENT_FEEDBACK_SET, type BankKind, type BankQuestion } from './types';

/**
 * Who may submit, how often, in what order, and who sees what.
 *
 * Driven through the in-memory store, which runs the same service code the deployed one
 * does. The rules under test are the ones a screen cannot be trusted to hold: one attempt
 * enforced in the write, the post-session assessment only after attending, feedback only
 * after that, and each role seeing only the participants BRD v2.3 gives them.
 */

const ORG = 'acme';
const DECK = 'security-basics-a1b2c3';

function person(id: string, role: Role, extra: Partial<SignedInPerson> = {}): SignedInPerson {
  return {
    id,
    orgId: ORG,
    homeOrgId: ORG,
    platform: false,
    email: `${id}@acme.example`,
    emailKey: `${id}@acme.example`,
    name: id,
    role,
    createdAt: '2026-11-01T00:00:00.000Z',
    lastSeenAt: null,
    ...extra,
  };
}

/** Technavious staff, which is what makes somebody the Benchmark administrator. */
const benchmark = person('benchmark', 'admin', { platform: true, homeOrgId: 'technavious' });
const companyAdmin = person('hr', 'admin');
const facilitator = person('fran', 'facilitator');
const otherFacilitator = person('felix', 'facilitator');
const asha = person('asha', 'trainee');
const ben = person('ben', 'trainee');
const cara = person('cara', 'trainee');

/** Ten questions whose right answer is always the first option. */
const QUESTIONS: Omit<BankQuestion, 'id'>[] = Array.from({ length: 10 }, (_, index) => ({
  question: `Question ${index + 1}`,
  options: ['Right', 'Wrong'],
  correctIndex: 0,
}));

function answers(right: number): Record<string, number> {
  return Object.fromEntries(QUESTIONS.map((_, index) => [`q${index + 1}`, index < right ? 0 : 1]));
}

let options: ServiceOptions & { store: InMemoryDocumentStore; roster: DocumentRosterStore };

async function bank(kind: BankKind) {
  return saveBank(benchmark, DECK, kind, QUESTIONS, 'upload', options);
}

async function take(
  who: SignedInPerson,
  kind: BankKind,
  right: number,
  sessionId: string | null = null,
) {
  const paper = await assessmentPaper(ORG, DECK, kind, options);
  assert.ok(paper, 'there is a paper to take');
  return submitAssessment(
    who,
    { deckId: DECK, kind, version: paper.version, answers: answers(right), sessionId },
    options,
  );
}

const RATINGS = { trainer: 5, content: 4, material: 4, facility: 3, learned: 5 };

function feedback(who: SignedInPerson, sessionId: string | null = null, comments = {}) {
  return submitFeedback(
    who,
    { deckId: DECK, sessionId, questionSetId: CURRENT_FEEDBACK_SET.id, ratings: RATINGS, comments },
    options,
  );
}

async function trainerLed(overrides: Partial<TrainingSession> = {}): Promise<TrainingSession> {
  const session: TrainingSession = {
    id: 's-room1',
    deckId: DECK,
    facilitatorId: facilitator.id,
    batchId: null,
    participantIds: [asha.id, ben.id],
    scheduledFor: '2026-11-13T09:00:00.000Z',
    status: 'open',
    attendance: {},
    createdBy: companyAdmin.id,
    createdAt: '2026-11-08T00:00:00.000Z',
    openedAt: '2026-11-13T09:00:00.000Z',
    closedAt: null,
    closedBy: null,
    ...overrides,
  };
  await trainingStore(ORG, options.store).saveSession(session);
  return session;
}

beforeEach(async () => {
  const store = new InMemoryDocumentStore();
  options = { store, roster: new DocumentRosterStore(store) };
  for (const who of [asha, ben, cara]) {
    await options.roster.upsertPerson({ id: who.id, email: who.email, name: who.name, orgId: ORG });
    await options.roster.assign({ personId: who.id, deckId: DECK, assignedBy: companyAdmin.id });
  }
});

/** Starts the AI-led session, which is what attending means for the assessments. */
async function attend(who: SignedInPerson) {
  await options.roster.touchAttempt({
    personId: who.id,
    deckId: DECK,
    slideCount: 5,
    totalSeconds: 300,
  });
}

describe('the pre-session assessment', () => {
  it('asks nothing of a deck with no pre-session bank', async () => {
    assert.equal(await preAssessmentRequired(ORG, asha.id, DECK, options), false);
    assert.equal(await assessedLevel(ORG, asha.id, DECK, options), null);
  });

  it('is required until it is taken, and then places the participant', async () => {
    await bank('pre');
    assert.equal(await preAssessmentRequired(ORG, asha.id, DECK, options), true);
    assert.equal(await preAssessmentDone(ORG, asha.id, DECK, options), false);

    const result = await take(asha, 'pre', 5);
    assert.equal(result.percent, 50);
    assert.equal(result.level, 'intermediate');
    assert.equal(await preAssessmentRequired(ORG, asha.id, DECK, options), false);
    assert.equal(await preAssessmentDone(ORG, asha.id, DECK, options), true);
    assert.equal(await assessedLevel(ORG, asha.id, DECK, options), 'intermediate');
  });

  it('places by the bands set for the deck, and keeps the level once given', async () => {
    await bank('pre');
    await setLevelBands(benchmark, DECK, { intermediateFrom: 60, advancedFrom: 90 }, options);
    assert.equal((await take(asha, 'pre', 5)).level, 'beginner');
    assert.equal((await take(ben, 'pre', 9)).level, 'advanced');

    await setLevelBands(benchmark, DECK, { intermediateFrom: 40, advancedFrom: 75 }, options);
    assert.equal(await assessedLevel(ORG, asha.id, DECK, options), 'beginner');
  });

  it('keeps the bands when the questions are replaced', async () => {
    await bank('pre');
    await setLevelBands(benchmark, DECK, { intermediateFrom: 30, advancedFrom: 60 }, options);
    const replaced = await bank('pre');
    assert.deepEqual(replaced.bands, { intermediateFrom: 30, advancedFrom: 60 });
  });

  it('refuses a paper that changed while somebody was answering', async () => {
    await bank('pre');
    const paper = await assessmentPaper(ORG, DECK, 'pre', options);
    await bank('pre');
    await assert.rejects(
      submitAssessment(
        asha,
        {
          deckId: DECK,
          kind: 'pre',
          version: paper!.version,
          answers: answers(10),
          sessionId: null,
        },
        options,
      ),
      (error: unknown) => error instanceof Refused && error.status === 409,
    );
    assert.equal(await preAssessmentDone(ORG, asha.id, DECK, options), false);
  });

  it('refuses an incomplete paper without using up the attempt', async () => {
    await bank('pre');
    const paper = await assessmentPaper(ORG, DECK, 'pre', options);
    const partial = answers(10);
    delete partial.q3;
    await assert.rejects(
      submitAssessment(
        asha,
        { deckId: DECK, kind: 'pre', version: paper!.version, answers: partial, sessionId: null },
        options,
      ),
      AnswersRejected,
    );
    assert.equal((await take(asha, 'pre', 10)).percent, 100);
  });
});

describe('the post-session assessment', () => {
  it('opens only once the participant has attended', async () => {
    await bank('post');
    await assert.rejects(
      take(asha, 'post', 10),
      (error: unknown) => error instanceof Refused && error.status === 409,
    );
    await attend(asha);
    assert.equal((await take(asha, 'post', 10)).passed, true);
  });

  it('passes at 70% and fails below it', async () => {
    await bank('post');
    await attend(asha);
    await attend(ben);
    const pass = await take(asha, 'post', 7);
    assert.equal(pass.percent, 70);
    assert.equal(pass.passed, true);
    assert.equal(pass.passMark, 70);
    const fail = await take(ben, 'post', 6);
    assert.equal(fail.passed, false);
  });

  it('cannot be retaken, and the first result stands', async () => {
    await bank('post');
    await attend(asha);
    await take(asha, 'post', 4);
    await assert.rejects(take(asha, 'post', 10), (error: unknown) => {
      return (
        error instanceof AlreadySubmitted &&
        'percent' in error.existing &&
        error.existing.percent === 40
      );
    });
    const stored = await assessmentStore(ORG, options.store).getResult(asha.id, DECK, 'post');
    assert.equal(stored?.percent, 40);
    assert.equal(stored?.passed, false);
  });

  it('is refused by the write itself, not only by the read before it', async () => {
    // Two submissions landing together both pass the service's read, so the refusal that
    // holds is the one inside the store's write, which Firestore runs as a transaction.
    // The in-memory store cannot interleave a real race, so the write is driven directly
    // with a result already stored, which is what the losing transaction would see.
    await bank('post');
    await attend(asha);
    const first = await take(asha, 'post', 9);
    const store = assessmentStore(ORG, options.store);
    await assert.rejects(
      store.recordResult({ ...first, percent: 20, passed: false }),
      AlreadySubmitted,
    );
    assert.equal((await store.getResult(asha.id, DECK, 'post'))?.percent, 90);
  });

  it('refuses somebody who was not given the deck, as a 404', async () => {
    await bank('post');
    const stranger = person('stranger', 'trainee');
    await assert.rejects(
      take(stranger, 'post', 10),
      (error: unknown) => error instanceof Refused && error.status === 404,
    );
  });
});

describe('trainer-led sessions', () => {
  it('let the people listed take part, and record which session', async () => {
    await bank('post');
    const session = await trainerLed();
    const result = await take(asha, 'post', 8, session.id);
    assert.equal(result.sessionId, session.id);
  });

  it('refuse somebody not on the list, a session of another deck, and anyone marked absent', async () => {
    await bank('post');
    const session = await trainerLed({ attendance: { ben: 'absent' } });
    await assert.rejects(
      take(cara, 'post', 8, session.id),
      (e: unknown) => e instanceof Refused && e.status === 404,
    );
    await assert.rejects(
      take(ben, 'post', 8, session.id),
      (e: unknown) => e instanceof Refused && e.status === 409,
    );
    await trainerLed({ id: 's-other', deckId: 'another-deck' });
    await assert.rejects(
      take(asha, 'post', 8, 's-other'),
      (e: unknown) => e instanceof Refused && e.status === 404,
    );
  });

  it('do not open the post-session assessment before the facilitator opens the session', async () => {
    await bank('post');
    const session = await trainerLed({ status: 'scheduled', openedAt: null });
    await assert.rejects(
      take(asha, 'post', 8, session.id),
      (e: unknown) => e instanceof Refused && e.status === 409,
    );
  });

  it('keep the pre-session assessment open to a late arrival until they are marked (AI-26)', async () => {
    await bank('pre');
    const session = await trainerLed({ attendance: { ben: 'present' } });
    // Under way, and Asha not marked yet: she takes it on her own device, then joins.
    const result = await take(asha, 'pre', 8, session.id);
    assert.equal(result.sessionId, session.id);
    // Ben was marked present before taking it, so it closed for him.
    await assert.rejects(
      take(ben, 'pre', 8, session.id),
      (e: unknown) => e instanceof Refused && e.status === 409,
    );
  });

  it('take nothing for a cancelled session', async () => {
    await bank('pre');
    await bank('post');
    const session = await trainerLed({
      status: 'cancelled',
      openedAt: null,
      cancelledAt: '2026-11-12T09:00:00.000Z',
      cancelledBy: companyAdmin.id,
    });
    for (const kind of ['pre', 'post'] as const) {
      await assert.rejects(
        take(asha, kind, 8, session.id),
        (e: unknown) => e instanceof Refused && e.status === 409,
        kind,
      );
    }
    await assert.rejects(
      feedback(asha, session.id),
      (e: unknown) => e instanceof Refused && e.status === 409,
    );
  });

  it('ask for feedback once per session', async () => {
    await trainerLed();
    await trainerLed({ id: 's-room2' });
    await feedback(asha, 's-room1');
    await feedback(asha, 's-room2');
    await assert.rejects(feedback(asha, 's-room1'), AlreadySubmitted);
    assert.equal(await feedbackDone(ORG, asha.id, DECK, 's-room1', options), true);
    assert.equal(await feedbackDone(ORG, asha.id, DECK, null, options), false);
  });
});

describe('feedback', () => {
  it('comes after the post-session assessment, once', async () => {
    await bank('post');
    await attend(asha);
    assert.equal((await nextStepAfterSession(ORG, asha.id, DECK, null, options))?.step, 'post');
    await assert.rejects(
      feedback(asha),
      (e: unknown) => e instanceof Refused && /assessment first/.test(e.message),
    );

    await take(asha, 'post', 8);
    assert.equal(await postAssessmentDone(ORG, asha.id, DECK, options), true);
    assert.equal((await nextStepAfterSession(ORG, asha.id, DECK, null, options))?.step, 'feedback');

    const record = await feedback(asha, null, { comment: '  Clear and useful. ' });
    assert.equal(record.comments.comment, 'Clear and useful.');
    assert.equal(record.questionSetId, CURRENT_FEEDBACK_SET.id);
    assert.equal(await nextStepAfterSession(ORG, asha.id, DECK, null, options), null);
    await assert.rejects(feedback(asha), AlreadySubmitted);
  });

  it('needs no assessment first when the deck has no post-session bank, but does need attending', async () => {
    await assert.rejects(feedback(asha), (e: unknown) => e instanceof Refused && e.status === 409);
    await attend(asha);
    await feedback(asha);
  });

  it('refuses a missing rating and a form from an old question set', async () => {
    await attend(asha);
    await assert.rejects(
      submitFeedback(
        asha,
        {
          deckId: DECK,
          sessionId: null,
          questionSetId: CURRENT_FEEDBACK_SET.id,
          ratings: { trainer: 5 },
          comments: {},
        },
        options,
      ),
      (e: unknown) => e instanceof Refused && e.status === 400,
    );
    await assert.rejects(
      submitFeedback(
        asha,
        { deckId: DECK, sessionId: null, questionSetId: 'old', ratings: RATINGS, comments: {} },
        options,
      ),
      (e: unknown) => e instanceof Refused && e.status === 409,
    );
  });
});

describe('who manages the banks', () => {
  it('is the Benchmark administrator, and nobody else', async () => {
    assert.equal(mayManageBanks(benchmark), true);
    assert.equal(
      mayManageBanks(
        person('tech-admin', 'admin', { homeOrgId: 'technavious', orgId: 'technavious' }),
      ),
      true,
    );
    for (const who of [companyAdmin, facilitator, asha]) {
      assert.equal(mayManageBanks(who), false, who.id);
      await assert.rejects(
        saveBank(who, DECK, 'pre', QUESTIONS, 'upload', options),
        (e: unknown) => e instanceof Refused && e.status === 404,
      );
    }
  });

  it('never lets a sample replace an uploaded bank', async () => {
    await bank('post');
    await assert.rejects(saveBank(benchmark, DECK, 'post', QUESTIONS, 'sample', options), Refused);
    const sample = await saveBank(benchmark, DECK, 'pre', QUESTIONS, 'sample', options);
    assert.equal(sample.source, 'sample');
    assert.equal((await assessmentPaper(ORG, DECK, 'pre', options))?.sample, true);
  });
});

describe('who sees results and feedback', () => {
  beforeEach(async () => {
    // Fran runs a session with Asha and Ben. Cara is in nobody's session.
    await trainerLed();
  });

  it('gives each role the participants BRD v2.3 gives them', async () => {
    const cases: [SignedInPerson, string, boolean, boolean][] = [
      // viewer, participant, sees results, sees feedback
      [asha, asha.id, true, false],
      [asha, ben.id, false, false],
      [benchmark, cara.id, true, true],
      [companyAdmin, cara.id, true, false],
      [facilitator, asha.id, true, true],
      [facilitator, cara.id, false, false],
      [otherFacilitator, asha.id, false, false],
    ];
    for (const [viewer, participant, results, seesFeedback] of cases) {
      assert.equal(
        await maySeeResultsOf(viewer, participant, options),
        results,
        `${viewer.id} results of ${participant}`,
      );
      assert.equal(
        await maySeeFeedbackOf(viewer, participant, options),
        seesFeedback,
        `${viewer.id} feedback of ${participant}`,
      );
    }
  });

  it('shows a facilitator only their own participants, with feedback', async () => {
    await bank('post');
    for (const who of [asha, cara]) await attend(who);
    await take(asha, 'post', 9);
    await take(cara, 'post', 3);
    await feedback(asha, null, { comment: 'Good.' });
    await feedback(cara, null, { comment: 'Not for the facilitator to see.' });

    const report = await resultsForDeck(facilitator, DECK, null, options);
    assert.deepEqual(report.rows.map((row) => row.personId).sort(), ['asha', 'ben']);
    const ashaRow = report.rows.find((row) => row.personId === 'asha')!;
    assert.equal(ashaRow.post?.passed, true);
    assert.equal(ashaRow.feedback, 'submitted');
    assert.equal(report.rows.find((row) => row.personId === 'ben')!.feedback, 'pending');
    assert.equal(report.feedback?.responses, 1);
    assert.equal(report.feedback?.pending, 1);
    assert.deepEqual(
      report.feedback?.comments.map((comment) => comment.text),
      ['Good.'],
    );
  });

  it('shows the administrator everybody, and who is pending', async () => {
    await attend(cara);
    await feedback(cara);
    const report = await resultsForDeck(benchmark, DECK, null, options);
    assert.deepEqual(
      report.rows.map((row) => row.personId),
      ['asha', 'ben', 'cara'],
    );
    assert.equal(report.feedback?.pending, 2);
    assert.equal(report.feedback?.averages.find((a) => a.id === 'trainer')?.average, 5);
  });

  it('shows a company administrator everybody, with results but no feedback', async () => {
    await attend(cara);
    await feedback(cara, null, { comment: 'Private.' });
    const report = await resultsForDeck(companyAdmin, DECK, null, options);
    assert.equal(report.rows.length, 3);
    assert.equal(report.feedback, null);
    assert.ok(report.rows.every((row) => row.feedback === null));
  });

  it("refuses a participant, and a facilitator looking at somebody else's session", async () => {
    assert.equal(mayOpenResults(asha), false);
    await assert.rejects(
      resultsForDeck(asha, DECK, null, options),
      (e: unknown) => e instanceof Refused && e.status === 404,
    );
    await assert.rejects(resultsForDeck(otherFacilitator, DECK, 's-room1', options), Refused);
    const own = await resultsForDeck(facilitator, DECK, 's-room1', options);
    assert.equal(own.session?.id, 's-room1');
    assert.deepEqual(
      own.rows.map((row) => row.personId),
      ['asha', 'ben'],
    );
  });

  it('narrows feedback to the session asked about', async () => {
    await feedback(asha, 's-room1');
    await attend(ben);
    await feedback(ben);
    const report = await resultsForDeck(facilitator, DECK, 's-room1', options);
    assert.equal(report.rows.find((row) => row.personId === 'asha')!.feedback, 'submitted');
    assert.equal(report.rows.find((row) => row.personId === 'ben')!.feedback, 'pending');
  });
});
