import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { assessmentHref, feedbackHref } from '../assessments/paths';
import { assessmentStore, bankId, feedbackId, resultId } from '../assessments/store';
import type { BankKind } from '../assessments/types';
import { orgsConfigured } from '../orgs/registry';
import type { SignedInPerson } from '../roster/types';
import { journeyFor, type JourneyStep, type StepState } from './journey';
import type { TrainingSession } from './types';

/**
 * A participant's steps for a trainer-led session (AI-26): the pre-session assessment,
 * the session, the post-session assessment, then feedback, each open only once the one
 * before it is done, a step the deck does not need shown as not needed, and nothing
 * after the session for somebody marked absent.
 *
 * `journeyFor` reads banks, results and feedback through the assessment store's own
 * in-memory fallback, since it takes no store, so each case uses a deck of its own.
 * The exact wording of a session's time is not asserted: it belongs to src/lib/time.ts,
 * which has its own tests.
 */

const ORG = 'acme';
const LABELS = ['Pre-session assessment', 'The session', 'Post-session assessment', 'Feedback'];

const asha: SignedInPerson = {
  id: 'asha',
  orgId: ORG,
  homeOrgId: ORG,
  platform: false,
  email: 'asha@acme.example',
  emailKey: 'asha@acme.example',
  name: 'Asha Rao',
  role: 'trainee',
  createdAt: '2026-11-01T00:00:00.000Z',
  lastSeenAt: null,
};

const skipReason = orgsConfigured()
  ? 'Firebase is configured, so journeyFor would read the real assessment store'
  : false;

let deckCount = 0;
let deckId: string;

beforeEach(() => {
  deckCount += 1;
  deckId = `journey-${deckCount}-a1b2c3`;
});

const banks = () => assessmentStore(ORG);

async function bank(kind: BankKind): Promise<void> {
  await banks().saveBank({
    id: bankId(deckId, kind),
    deckId,
    kind,
    questions: [{ id: 'q1', question: 'One?', options: ['Yes', 'No'], correctIndex: 0 }],
    source: 'upload',
    version: 'v1',
    savedBy: 'benchmark',
    savedAt: '2026-11-01T00:00:00.000Z',
  });
}

async function result(kind: BankKind, sessionId: string | null = 's-room1'): Promise<void> {
  await banks().recordResult({
    id: resultId(asha.id, deckId, kind),
    personId: asha.id,
    deckId,
    kind,
    sessionId,
    answers: [],
    correct: 1,
    total: 1,
    percent: 100,
    bankVersion: 'v1',
    bankSource: 'upload',
    submittedAt: '2026-11-13T12:00:00.000Z',
  });
}

async function feedback(sessionId: string | null = 's-room1'): Promise<void> {
  await banks().recordFeedback({
    id: feedbackId(asha.id, deckId, sessionId),
    personId: asha.id,
    deckId,
    sessionId,
    questionSetId: 'interim-2026-11',
    ratings: { trainer: 5 },
    comments: {},
    submittedAt: '2026-11-13T12:30:00.000Z',
  });
}

function session(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: 's-room1',
    deckId,
    facilitatorId: 'fran',
    batchId: null,
    participantIds: [asha.id, 'ben'],
    scheduledFor: '2026-11-13T09:00:00.000Z',
    status: 'scheduled',
    attendance: {},
    createdBy: 'hr',
    createdAt: '2026-11-08T00:00:00.000Z',
    openedAt: null,
    closedAt: null,
    closedBy: null,
    ...overrides,
  };
}

const opened = (overrides: Partial<TrainingSession> = {}) =>
  session({ status: 'open', openedAt: '2026-11-13T09:05:00.000Z', ...overrides });

const closed = (overrides: Partial<TrainingSession> = {}) =>
  session({
    status: 'closed',
    openedAt: '2026-11-13T09:05:00.000Z',
    closedAt: '2026-11-13T11:00:00.000Z',
    closedBy: 'fran',
    attendance: { [asha.id]: 'present', ben: 'present' },
    ...overrides,
  });

async function stepsOf(value: TrainingSession): Promise<JourneyStep[]> {
  const journey = await journeyFor(asha, value, 'Safety basics');
  assert.deepEqual(
    journey.steps.map((step) => step.label),
    LABELS,
    'the steps are always the same four, in order',
  );
  for (const step of journey.steps) {
    // A link to each open step the participant does on their own device, and to nothing
    // else. The session itself runs on the facilitator's screen, so it never has one.
    const ownDevice = step.label !== 'The session';
    assert.equal(
      step.href !== undefined,
      ownDevice && step.state === 'open',
      `${step.label}: ${step.state}`,
    );
  }
  return journey.steps;
}

async function statesOf(value: TrainingSession): Promise<StepState[]> {
  return (await stepsOf(value)).map((step) => step.state);
}

describe('a participant’s journey through a trainer-led session', { skip: skipReason }, () => {
  it('carries the session, the deck and its title', async () => {
    const journey = await journeyFor(asha, session(), 'Safety basics');
    assert.equal(journey.sessionId, 's-room1');
    assert.equal(journey.deckId, deckId);
    assert.equal(journey.deckTitle, 'Safety basics');
  });

  it('says when, only when the session has a time', async () => {
    const timed = await journeyFor(asha, session(), 'Safety basics');
    assert.equal(typeof timed.when, 'string');
    assert.ok(timed.when && timed.when.trim().length > 0);

    const untimed = await journeyFor(asha, session({ scheduledFor: null }), 'Safety basics');
    assert.equal(untimed.when, null);
    assert.equal((await stepsOf(session({ scheduledFor: null })))[1]?.note, 'In the room.');
  });

  describe('for a deck with no question banks', () => {
    it('needs no assessments, and locks the session and feedback until it starts', async () => {
      assert.deepEqual(await statesOf(session()), ['not needed', 'locked', 'not needed', 'locked']);
      const steps = await stepsOf(session());
      assert.equal(steps[3]?.note, 'Opens after the session.');
    });

    it('opens feedback once the session has started', async () => {
      const here = { attendance: { [asha.id]: 'present' as const } };
      assert.deepEqual(await statesOf(opened(here)), ['not needed', 'open', 'not needed', 'open']);
      // Not yet marked present: they may still be on their way, so nothing after opens.
      assert.deepEqual(await statesOf(opened()), ['not needed', 'open', 'not needed', 'locked']);
      const steps = await stepsOf(closed());
      assert.deepEqual(
        steps.map((step) => step.state),
        ['not needed', 'done', 'not needed', 'open'],
      );
      assert.equal(steps[3]?.href, feedbackHref(deckId, 's-room1'));
    });

    it('is all done once feedback is given for this session', async () => {
      await feedback();
      assert.deepEqual(await statesOf(closed()), ['not needed', 'done', 'not needed', 'done']);
    });

    it('does not count feedback given for another session of the same deck', async () => {
      await feedback('s-earlier');
      assert.equal((await statesOf(closed()))[3], 'open');
    });
  });

  describe('for a deck with both banks', () => {
    beforeEach(async () => {
      await bank('pre');
      await bank('post');
    });

    it('opens the pre-session assessment first, and nothing after it', async () => {
      const steps = await stepsOf(session());
      assert.deepEqual(
        steps.map((step) => step.state),
        ['open', 'locked', 'locked', 'locked'],
      );
      assert.equal(steps[0]?.href, assessmentHref('pre', deckId, 's-room1'));
      assert.equal(steps[2]?.note, 'Opens after the session.');
      assert.equal(steps[3]?.note, 'Opens after the post-session assessment.');
    });

    it('waits for the room once the pre-session assessment is done', async () => {
      await result('pre');
      assert.deepEqual(await statesOf(session()), ['done', 'locked', 'locked', 'locked']);
    });

    it('opens the post-session assessment once the session has started, not feedback', async () => {
      await result('pre');
      const steps = await stepsOf(opened({ attendance: { [asha.id]: 'present' } }));
      assert.deepEqual(
        steps.map((step) => step.state),
        ['done', 'open', 'open', 'locked'],
      );
      assert.equal(steps[2]?.href, assessmentHref('post', deckId, 's-room1'));
    });

    it('marks a pre-session assessment not taken by the time they were marked as missed, and goes on', async () => {
      assert.deepEqual(await statesOf(closed()), ['missed', 'done', 'open', 'locked']);
    });

    it('opens feedback only after the post-session assessment', async () => {
      await result('pre');
      assert.deepEqual(await statesOf(closed()), ['done', 'done', 'open', 'locked']);
      await result('post');
      const steps = await stepsOf(closed());
      assert.deepEqual(
        steps.map((step) => step.state),
        ['done', 'done', 'done', 'open'],
      );
      assert.equal(steps[3]?.href, feedbackHref(deckId, 's-room1'));
      await feedback();
      assert.deepEqual(await statesOf(closed()), ['done', 'done', 'done', 'done']);
    });

    it('tells the session apart while waiting, under way and finished', async () => {
      assert.match((await stepsOf(session()))[1]?.note ?? '', /^In the room/);
      assert.equal((await stepsOf(opened()))[1]?.note, "Under way, on the facilitator's screen.");
      assert.equal((await stepsOf(closed()))[1]?.note, 'Finished.');
    });
  });

  describe('for a participant arriving late (AI-26)', () => {
    beforeEach(async () => {
      await bank('pre');
      await bank('post');
    });

    it('keeps the pre-session assessment open once the session has started, until they are marked', async () => {
      const steps = await stepsOf(opened({ attendance: { ben: 'present' } }));
      assert.deepEqual(
        steps.map((step) => step.state),
        ['open', 'open', 'locked', 'locked'],
      );
      assert.equal(steps[0]?.href, assessmentHref('pre', deckId, 's-room1'));
      assert.equal(steps[0]?.note, 'The session has started. Do this now, before you join.');
      assert.equal(steps[2]?.note, 'Opens after the pre-session assessment.');
    });

    it('shows them as joined late once marked present after the start', async () => {
      await result('pre');
      const late = opened({
        attendance: { [asha.id]: 'present' },
        attendanceAt: { [asha.id]: '2026-11-13T09:40:00.000Z' },
      });
      const journey = await journeyFor(asha, late, 'Safety basics');
      assert.equal(journey.joinedLate, true);
      assert.deepEqual(
        journey.steps.map((step) => step.state),
        ['done', 'open', 'open', 'locked'],
      );
      assert.match(journey.steps[1]?.note ?? '', /You joined late\./);

      const onTime = await journeyFor(
        asha,
        opened({
          attendance: { [asha.id]: 'present' },
          attendanceAt: { [asha.id]: '2026-11-13T09:00:00.000Z' },
        }),
        'Safety basics',
      );
      assert.equal(onTime.joinedLate, false);
    });

    it('says missed only once they were marked present without it', async () => {
      const marked = opened({
        attendance: { [asha.id]: 'present' },
        attendanceAt: { [asha.id]: '2026-11-13T09:40:00.000Z' },
      });
      const steps = await stepsOf(marked);
      assert.deepEqual(
        steps.map((step) => step.state),
        ['missed', 'open', 'open', 'locked'],
      );
      assert.equal(steps[0]?.note, 'Closed when you were marked present.');
    });
  });

  describe('for a cancelled session', () => {
    it('shows it as cancelled, with nothing to do', async () => {
      await bank('pre');
      const journey = await journeyFor(
        asha,
        session({ status: 'cancelled', cancelledAt: '2026-11-12T00:00:00.000Z' }),
        'Safety basics',
      );
      assert.equal(journey.cancelled, true);
      assert.deepEqual(journey.steps, []);
    });
  });

  describe('for a participant marked absent', () => {
    const absent = { [asha.id]: 'absent', ben: 'present' } as const;

    it('locks the post-session assessment and feedback, and says why', async () => {
      await bank('pre');
      await bank('post');
      await result('pre');
      const steps = await stepsOf(closed({ attendance: absent }));
      assert.deepEqual(
        steps.map((step) => step.state),
        ['done', 'done', 'locked', 'locked'],
      );
      assert.equal(steps[1]?.note, 'You were marked absent.');
    });

    it('locks them while the session is still open, too', async () => {
      await bank('post');
      assert.deepEqual(await statesOf(opened({ attendance: absent })), [
        'not needed',
        'open',
        'locked',
        'locked',
      ]);
    });

    it('locks feedback even for a deck with no banks', async () => {
      assert.deepEqual(await statesOf(closed({ attendance: absent })), [
        'not needed',
        'done',
        'not needed',
        'locked',
      ]);
    });
  });

  describe('for a deck with only a post-session bank', () => {
    it('does not ask for a pre-session assessment, and opens the post one after the start', async () => {
      await bank('post');
      assert.deepEqual(await statesOf(session()), ['not needed', 'locked', 'locked', 'locked']);
      assert.deepEqual(await statesOf(closed()), ['not needed', 'done', 'open', 'locked']);
    });
  });

  describe('for a deck whose stored bank has no questions', () => {
    it('treats it as no bank, as the assessment service does', async () => {
      await banks().saveBank({
        id: bankId(deckId, 'pre'),
        deckId,
        kind: 'pre',
        questions: [],
        source: 'upload',
        version: 'v0',
        savedBy: 'benchmark',
        savedAt: '2026-11-01T00:00:00.000Z',
      });
      assert.deepEqual(await statesOf(closed()), ['not needed', 'done', 'not needed', 'open']);
    });
  });

  describe('for a deck with only a pre-session bank', () => {
    it('opens feedback straight after the session once the pre-session one is done', async () => {
      await bank('pre');
      await result('pre');
      assert.deepEqual(await statesOf(closed()), ['done', 'done', 'not needed', 'open']);
    });
  });
});
