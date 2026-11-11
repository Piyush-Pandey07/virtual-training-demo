import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { GET as cronGet } from '@/app/api/cron/retention/route';
import { assessedLevel, resultsForDeck } from '../assessments/service';
import { ASSESSMENT_RESULTS, assessmentDocuments, FEEDBACK } from '../assessments/store';
import type { AssessmentResult, FeedbackRecord } from '../assessments/types';
import { CONSENTS } from '../profiles/consent';
import { profileForTrainer } from '../profiles/for-trainer';
import { PROFILES, profileDocuments, saveProfile } from '../profiles/store';
import type { LearnerProfileRecord } from '../profiles/types';
import { viewProfile } from '../profiles/view';
import { InMemoryDocumentStore } from '../roster/documents';
import { LEAVERS, leaverDocuments, recordLeaver } from '../roster/leavers';
import type { RosterStore } from '../roster/store';
import { DocumentRosterStore } from '../roster/store-documents';
import type { Attempt, Role, SignedInPerson } from '../roster/types';
import { scopedDocuments } from '../orgs/scope';
import { trainingStore } from '../training/store';
import type { TrainingSession } from '../training/types';
import { runRetention, RETENTION, zeroCounts, type Counts } from './job';
import {
  attendedAt,
  deletionDue,
  DELETE_AFTER_DAYS,
  lastSessionAt,
  RECORD_KEPT_YEARS,
  recordDeletionDue,
  RESTRICT_AFTER_DAYS,
  stepFor,
  yearsAfter,
  type RetentionMark,
} from './policy';
import { isRestricted, visibleOnly, visibleTo } from './restricted';

/**
 * Retention (AI-27, AI-41, AI-42), as the product owner decided it: profiles, results and
 * feedback restricted to administrators 90 days after the participant's last session;
 * the profile and the assessment answers deleted a year after last use, with the score,
 * pass or fail, level, ratings and dates kept; and the rest of the training record,
 * attempts, attendance and the names of people who have left included, deleted five
 * years after last use. Consent records are never touched.
 *
 * Driven against the in-memory store with fixed dates, so five years pass in a line.
 */

const ORG = 'acme';
const DECK = 'dc-power-a1b2c3';
const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const at = (days: number) => new Date(T0 + days * DAY);
const iso = (days: number) => at(days).toISOString();

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
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: null,
    ...extra,
  };
}

const benchmark = person('benchmark', 'admin', { platform: true, homeOrgId: 'technavious' });
const companyAdmin = person('hr', 'admin');
const facilitator = person('fran', 'facilitator');
const asha = person('asha', 'trainee');

function attempt(personId: string, lastSeenDay: number): Attempt {
  return {
    personId,
    deckId: DECK,
    covered: [],
    lastSlideId: null,
    slideCount: 5,
    totalSeconds: 600,
    startedAt: iso(lastSeenDay),
    lastSeenAt: iso(lastSeenDay),
    completedAt: null,
  };
}

/**
 * A roster that answers only what the job asks, with attempts the test controls. Removing
 * an attempt takes it out of the array the test passed in, so the test can look.
 */
function fakeRoster(attempts: Attempt[], options: { failing?: boolean } = {}): RosterStore {
  const find = (personId: string, deckId: string) =>
    attempts.findIndex((each) => each.personId === personId && each.deckId === deckId);
  return {
    kind: 'firestore',
    writable: true,
    async getPersonByEmail() {
      return undefined;
    },
    async listAttempts() {
      if (options.failing) throw new Error('Firestore is down');
      return [...attempts];
    },
    async getAttempt(personId: string, deckId: string) {
      return attempts[find(personId, deckId)];
    },
    async removeAttempt(personId: string, deckId: string) {
      const index = find(personId, deckId);
      if (index >= 0) attempts.splice(index, 1);
    },
  } as unknown as RosterStore;
}

/** Counts with only the kinds named, so a comparison says what changed and nothing else. */
const only = (counts: Partial<Counts>): Counts => ({ ...zeroCounts(), ...counts });

/** A day this many years and days after T0, on the calendar. */
const yearsOn = (years: number, days = 0) => new Date(yearsAfter(T0, years) + days * DAY);

function profile(personId: string, day: number): LearnerProfileRecord {
  return {
    personId,
    name: 'Asha Patil',
    education: 'B.E., Electrical',
    yearsExperience: 6,
    department: 'Facilities',
    proficiency: 'beginner',
    source: 'self',
    confirmed: true,
    consent: { version: 'test', at: iso(day) },
    updatedAt: iso(day),
  };
}

function result(personId: string, kind: 'pre' | 'post', day: number): AssessmentResult {
  return {
    id: `${personId}__${DECK}__${kind}`,
    personId,
    deckId: DECK,
    kind,
    sessionId: null,
    answers: [{ questionId: 'q1', chosenIndex: 2, correct: true }],
    correct: 8,
    total: 10,
    percent: 80,
    ...(kind === 'pre' ? { level: 'advanced' as const } : { passed: true, passMark: 70 }),
    bankVersion: 'v1',
    bankSource: 'upload',
    submittedAt: iso(day),
  };
}

function feedback(personId: string, day: number): FeedbackRecord {
  return {
    id: `${personId}__${DECK}`,
    personId,
    deckId: DECK,
    sessionId: null,
    questionSetId: 'interim-2026-11',
    ratings: { trainer: 5 },
    comments: { comment: 'Very clear.' },
    submittedAt: iso(day),
  };
}

function trainerLed(overrides: Partial<TrainingSession>): TrainingSession {
  return {
    id: 's-1',
    deckId: DECK,
    facilitatorId: facilitator.id,
    batchId: null,
    participantIds: [asha.id],
    scheduledFor: null,
    status: 'closed',
    attendance: { [asha.id]: 'present' },
    createdBy: companyAdmin.id,
    createdAt: iso(0),
    openedAt: iso(0),
    closedAt: iso(0),
    closedBy: facilitator.id,
    ...overrides,
  };
}

/** Asha's records for the deck: a profile, both results and feedback, all from day 0. */
async function seed(store: InMemoryDocumentStore, day = 0): Promise<void> {
  const profiles = profileDocuments({ orgId: ORG }, { store });
  const assessments = assessmentDocuments(ORG, store);
  await profiles.set(PROFILES, asha.id, profile(asha.id, day));
  await profiles.set(CONSENTS, 'asha__consent', { id: 'asha__consent', personId: asha.id });
  await assessments.set(ASSESSMENT_RESULTS, `asha__${DECK}__pre`, result(asha.id, 'pre', day));
  await assessments.set(ASSESSMENT_RESULTS, `asha__${DECK}__post`, result(asha.id, 'post', day));
  await assessments.set(FEEDBACK, `asha__${DECK}`, feedback(asha.id, day));
}

async function records(store: InMemoryDocumentStore) {
  const profiles = profileDocuments({ orgId: ORG }, { store });
  const assessments = assessmentDocuments(ORG, store);
  return {
    profile: await profiles.get<LearnerProfileRecord>(PROFILES, asha.id),
    pre: await assessments.get<AssessmentResult>(ASSESSMENT_RESULTS, `asha__${DECK}__pre`),
    feedback: await assessments.get<FeedbackRecord>(FEEDBACK, `asha__${DECK}`),
    consents: await profiles.all(CONSENTS),
  };
}

describe('the policy', () => {
  it('keeps for 90 days, restricts until a year, erases detail until five years, then deletes', () => {
    assert.equal(RESTRICT_AFTER_DAYS, 90);
    assert.equal(DELETE_AFTER_DAYS, 365);
    assert.equal(RECORD_KEPT_YEARS, 5);
    assert.equal(stepFor(T0, at(89).getTime()), 'keep');
    assert.equal(stepFor(T0, at(90).getTime()), 'restrict');
    assert.equal(stepFor(T0, at(364).getTime()), 'restrict');
    assert.equal(stepFor(T0, at(365).getTime()), 'erase');
    assert.equal(stepFor(T0, yearsOn(5, -1).getTime()), 'erase');
    assert.equal(stepFor(T0, yearsOn(5).getTime()), 'delete');
  });

  it('counts five years on the calendar, leap days included', () => {
    // 2028 is a leap year, so five years from 1 January 2026 is 1826 days, and from
    // 1 March 2027 it is 1827, since 2028 and 2032 both fall inside.
    assert.equal(yearsAfter(T0, 5), Date.parse('2031-01-01T00:00:00.000Z'));
    const march = Date.parse('2027-03-01T00:00:00.000Z');
    assert.equal(yearsAfter(march, 5), Date.parse('2032-03-01T00:00:00.000Z'));
  });

  it('never acts on a record whose last use cannot be read', () => {
    assert.equal(stepFor(null, at(10_000).getTime()), 'keep');
  });

  it('takes the latest of AI-led activity and trainer-led sessions attended', () => {
    const sessions = [trainerLed({ closedAt: iso(40), openedAt: iso(40) })];
    assert.equal(lastSessionAt(asha.id, [attempt(asha.id, 10)], sessions), at(40).getTime());
    assert.equal(lastSessionAt(asha.id, [attempt(asha.id, 50)], sessions), at(50).getTime());
    assert.equal(lastSessionAt('nobody', [attempt(asha.id, 50)], sessions), null);
  });

  it('counts a trainer-led session only when it was opened and they were not absent', () => {
    assert.equal(attendedAt(trainerLed({ attendance: { asha: 'absent' } }), asha.id), null);
    assert.equal(
      attendedAt(trainerLed({ status: 'scheduled', openedAt: null, closedAt: null }), asha.id),
      null,
    );
    assert.equal(attendedAt(trainerLed({ participantIds: ['ben'] }), asha.id), null);
    assert.equal(
      attendedAt(trainerLed({ status: 'open', closedAt: null, openedAt: iso(3) }), asha.id),
      at(3).getTime(),
    );
  });

  it('says when a restricted record loses its detail, and when the rest of it goes', () => {
    const mark = { restrictedAt: iso(100), lastUsedAt: iso(10) };
    assert.equal(deletionDue(mark), at(10 + DELETE_AFTER_DAYS).toISOString());
    assert.equal(recordDeletionDue(mark), new Date(yearsAfter(at(10).getTime(), 5)).toISOString());
  });
});

describe('the daily job', () => {
  let store: InMemoryDocumentStore;
  beforeEach(async () => {
    store = new InMemoryDocumentStore();
    await seed(store);
  });
  const run = (day: number, extra: Parameters<typeof runRetention>[0] = {}) =>
    runRetention({
      store,
      orgIds: [ORG],
      asOf: at(day),
      roster: () => fakeRoster([attempt(asha.id, 10)]),
      ...extra,
    });

  it('leaves everything alone inside 90 days of the last session', async () => {
    // Day 95 is past 90 days from the records' own dates, but not from the session on day 10.
    const report = await run(95);
    assert.equal(report.writes, 0);
    assert.equal(isRestricted((await records(store)).profile), false);
  });

  it('restricts the profile, results and feedback 90 days after the last session', async () => {
    const report = await run(101);
    assert.deepEqual(report.totals.restricted, only({ profiles: 1, results: 2, feedback: 1 }));
    const { profile: stored, pre, feedback: given } = await records(store);
    assert.deepEqual(stored?.retention, { restrictedAt: iso(101), lastUsedAt: iso(10) });
    assert.ok(isRestricted(pre));
    assert.ok(isRestricted(given));
    // Nothing else about the record changed.
    assert.equal(stored?.education, 'B.E., Electrical');
    assert.equal(pre?.percent, 80);
  });

  it('is idempotent: a second run the same day, or the next, changes nothing', async () => {
    await run(101);
    const again = await run(101);
    assert.equal(again.writes, 0);
    const tomorrow = await run(102);
    assert.equal(tomorrow.writes, 0);
    assert.equal((await records(store)).profile?.retention?.restrictedAt, iso(101));
  });

  it('a year after last use deletes the profile and the answers, and keeps the score', async () => {
    await trainingStore(ORG, store).saveSession(trainerLed({ closedAt: iso(5), openedAt: iso(5) }));
    const attempts = [attempt(asha.id, 10)];
    await run(101);
    const report = await run(10 + 365, { roster: () => fakeRoster(attempts) });
    assert.deepEqual(report.totals.deleted, only({ profiles: 1 }));
    assert.deepEqual(report.totals.erased, only({ results: 2, feedback: 1 }));

    const left = await records(store);
    assert.equal(left.profile, undefined, 'the profile was kept past a year');
    // The result stays, without its answers: score, level, pass or fail and dates kept.
    assert.ok(left.pre, 'the result was deleted at a year');
    assert.deepEqual(left.pre.answers, []);
    assert.equal(left.pre.percent, 80);
    assert.equal(left.pre.correct, 8);
    assert.equal(left.pre.level, 'advanced');
    assert.equal(left.pre.submittedAt, iso(0));
    // The result's own type writes the mark inline and without `erasedAt`, to stay free of
    // imports; the job writes the full `RetentionMark`.
    const mark = left.pre.retention as RetentionMark | undefined;
    assert.equal(mark?.erasedAt, at(375).toISOString());
    assert.ok(isRestricted(left.pre), 'an erased result is still restricted');
    const post = await assessmentDocuments(ORG, store).get<AssessmentResult>(
      ASSESSMENT_RESULTS,
      `asha__${DECK}__post`,
    );
    assert.equal(post?.passed, true);
    // Feedback keeps its ratings and loses what was written.
    assert.deepEqual(left.feedback?.comments, {});
    assert.deepEqual(left.feedback?.ratings, { trainer: 5 });
    // Consent, completion and attendance are untouched.
    assert.equal(left.consents.length, 1, 'a consent record was deleted');
    assert.equal(attempts.length, 1, 'an attempt was deleted at a year');
    assert.equal((await trainingStore(ORG, store).listSessions()).length, 1);
  });

  it('erases only once', async () => {
    await run(10 + 365);
    const again = await run(10 + 366);
    assert.equal(again.writes, 0);
  });

  it('five years after last use deletes the rest: results, feedback, completion and attendance', async () => {
    await trainingStore(ORG, store).saveSession(trainerLed({ closedAt: iso(5), openedAt: iso(5) }));
    const attempts = [attempt(asha.id, 10)];
    const roster = () => fakeRoster(attempts);
    await run(10 + 365, { roster });

    const before = await run(0, { roster, asOf: new Date(yearsAfter(at(10).getTime(), 5) - DAY) });
    assert.deepEqual(before.totals.deleted, zeroCounts(), 'deleted before five years');

    const report = await run(0, { roster, asOf: new Date(yearsAfter(at(10).getTime(), 5)) });
    assert.deepEqual(
      report.totals.deleted,
      only({ results: 2, feedback: 1, attempts: 1, sessions: 1 }),
    );
    const left = await records(store);
    assert.equal(left.pre, undefined);
    assert.equal(left.feedback, undefined);
    assert.equal(attempts.length, 0, 'the attempt outlived five years');
    assert.equal((await trainingStore(ORG, store).listSessions()).length, 0);
    assert.equal(left.consents.length, 1, 'a consent record was deleted');
  });

  it('keeps a trainer-led session while anybody on it trained inside five years', async () => {
    await trainingStore(ORG, store).saveSession(
      trainerLed({
        participantIds: [asha.id, 'ben'],
        attendance: { asha: 'present', ben: 'present' },
      }),
    );
    // Ben trained again in year four; Asha last trained on day 10.
    const attempts = [attempt(asha.id, 10), attempt('ben', 4 * 365)];
    const report = await run(0, { roster: () => fakeRoster(attempts), asOf: yearsOn(5, 30) });
    assert.equal(report.totals.deleted.sessions, 0, 'the session went with Ben still in use');
    assert.equal(report.totals.deleted.attempts, 1, "Asha's attempt alone should go");
    assert.equal((await trainingStore(ORG, store).listSessions()).length, 1);
  });

  it("keeps a leaver's name and address for five years after their last use, then deletes it", async () => {
    await recordLeaver(ORG, asha, companyAdmin.id, { store, now: at(20) });
    const roster = () => fakeRoster([attempt(asha.id, 10)]);
    const inside = await run(0, { roster, asOf: yearsOn(5, 10) });
    assert.equal(inside.totals.deleted.leavers, 0, 'measured from when they left, day 20');
    assert.ok(await leaverDocuments(ORG, store).get(LEAVERS, asha.id));

    const after = await run(0, { roster, asOf: yearsOn(5, 20) });
    assert.equal(after.totals.deleted.leavers, 1);
    assert.equal(await leaverDocuments(ORG, store).get(LEAVERS, asha.id), undefined);
  });

  it('lifts a restriction once a later session puts the records back in use', async () => {
    await run(101);
    const report = await run(120, { roster: () => fakeRoster([attempt(asha.id, 115)]) });
    assert.deepEqual(report.totals.lifted, only({ profiles: 1, results: 2, feedback: 1 }));
    const { profile: stored } = await records(store);
    assert.equal(stored?.retention, undefined);
    assert.ok(!('retention' in (stored ?? {})));
  });

  it('counts a trainer-led session the participant attended', async () => {
    await trainingStore(ORG, store).saveSession(
      trainerLed({ closedAt: iso(60), openedAt: iso(60) }),
    );
    const report = await run(120);
    assert.equal(report.writes, 0, 'attended on day 60, so in use until day 150');
  });

  it('counts a profile saved again as a use, whatever the sessions say', async () => {
    await profileDocuments({ orgId: ORG }, { store }).set(PROFILES, asha.id, profile(asha.id, 100));
    const report = await run(150);
    assert.equal(report.totals.restricted.profiles, 0);
    assert.equal(report.totals.restricted.results, 2);
  });

  it('skips an organisation whose attempts cannot be read, rather than judging people idle', async () => {
    const report = await run(500, { roster: () => fakeRoster([], { failing: true }) });
    assert.equal(report.writes, 0);
    assert.match(report.orgs[0]!.error ?? '', /Firestore is down/);
    assert.ok((await records(store)).profile, 'a profile was deleted on a failed read');
  });

  it('reports what it would do in a dry run, and changes nothing', async () => {
    const report = await run(101, { dryRun: true });
    assert.equal(report.dryRun, true);
    assert.deepEqual(report.totals.restricted, only({ profiles: 1, results: 2, feedback: 1 }));
    assert.equal(report.writes, 0);
    assert.ok(report.orgs[0]!.examples!.includes(`restrict profiles ${asha.id}`));
    assert.equal(isRestricted((await records(store)).profile), false);
  });

  it('stops when its budget runs out, and resumes from there the next day', async () => {
    const other = 'globex';
    await profileDocuments({ orgId: other }, { store }).set(PROFILES, 'gita', profile('gita', 0));
    const both = { orgIds: [ORG, other] };

    const first = await run(101, { ...both, maxWrites: 2 });
    assert.equal(first.complete, false);
    assert.equal(first.resumeFrom, ORG);
    assert.equal(first.writes, 2);
    assert.ok(await store.get(RETENTION, 'cursor'), 'the cursor was not saved');

    const second = await run(101, both);
    assert.equal(second.complete, true);
    assert.equal(second.orgs[0]!.orgId, ORG, 'did not start where the last run stopped');
    assert.equal(await store.get(RETENTION, 'cursor'), undefined);
    const gita = await profileDocuments({ orgId: other }, { store }).get<LearnerProfileRecord>(
      PROFILES,
      'gita',
    );
    assert.ok(isRestricted(gita));
  });

  it('stops before its time limit', async () => {
    let now = 0;
    const report = await run(101, { budgetMs: 10, clock: () => (now += 20) });
    assert.equal(report.complete, false);
    assert.equal(report.writes, 0);
  });

  it('skips an organisation with no roster storage', async () => {
    const report = await run(500, {
      roster: () => ({ writable: false }) as unknown as RosterStore,
    });
    assert.equal(report.writes, 0);
    assert.match(report.orgs[0]!.error ?? '', /roster/);
  });
});

describe('once restricted', () => {
  let store: InMemoryDocumentStore;
  let roster: DocumentRosterStore;
  let saved: string | undefined;

  beforeEach(async () => {
    saved = process.env.PROFILES_ENABLED;
    process.env.PROFILES_ENABLED = 'true';
    store = new InMemoryDocumentStore();
    roster = new DocumentRosterStore(scopedDocuments(store, ORG));
    for (const each of [asha, facilitator, companyAdmin]) {
      await roster.upsertPerson({ id: each.id, email: each.email, name: each.name });
    }
    await roster.assign({ personId: asha.id, deckId: DECK, assignedBy: companyAdmin.id });
    await trainingStore(ORG, store).saveSession(trainerLed({}));
    await seed(store);
    await runRetention({
      store,
      orgIds: [ORG],
      asOf: at(200),
      roster: () => fakeRoster([]),
    });
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.PROFILES_ENABLED;
    else process.env.PROFILES_ENABLED = saved;
  });

  it('is visible to an administrator and nobody else', () => {
    const record = { retention: { restrictedAt: iso(1), lastUsedAt: iso(0) } };
    assert.equal(visibleTo(benchmark, record), record);
    for (const viewer of [companyAdmin, facilitator, asha, null]) {
      assert.equal(visibleTo(viewer, record), undefined);
    }
    assert.deepEqual(visibleOnly(facilitator, [record, {}]), [{}]);
  });

  it('is not given to the trainer', async () => {
    assert.equal(await profileForTrainer(asha, { store }), undefined);
  });

  it('is not shown to the facilitator or the participant, who are told it is restricted', async () => {
    for (const viewer of [facilitator, asha]) {
      const view = await viewProfile(viewer, asha.id, { store, roster });
      assert.equal(view?.profile, null);
      assert.equal(view?.restricted, true);
    }
  });

  it('is still shown to the administrator', async () => {
    const view = await viewProfile(benchmark, asha.id, { store, roster });
    assert.equal(view?.profile?.education, 'B.E., Electrical');
    assert.equal(view?.restricted, true);
  });

  it('keeps results and feedback out of the report for anybody else, and marks the row', async () => {
    for (const viewer of [facilitator, companyAdmin]) {
      const report = await resultsForDeck(viewer, DECK, null, { store, roster });
      const row = report.rows.find((each) => each.personId === asha.id);
      assert.ok(row, 'the participant disappeared from the report');
      assert.equal(row.restricted, true);
      assert.equal(row.pre, null);
      assert.equal(row.post, null);
      if (report.feedback) {
        assert.equal(report.feedback.responses, 0);
        assert.equal(report.feedback.pending, 0);
      }
    }
    const admin = await resultsForDeck(benchmark, DECK, null, { store, roster });
    const row = admin.rows.find((each) => each.personId === asha.id);
    assert.equal(row?.pre?.percent, 80);
    assert.equal(admin.feedback?.responses, 1);
  });

  it('no longer pitches a session at the restricted level', async () => {
    assert.equal(await assessedLevel(ORG, asha.id, DECK, { store }), null);
  });

  it('is lifted when the participant fills their profile in again', async () => {
    const next = await saveProfile(asha, profile(asha.id, 0), { store });
    assert.equal(isRestricted(next), false);
    assert.ok(await profileForTrainer(asha, { store }));
  });
});

describe('the cron route', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.CRON_SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  const call = (query = '', authorization?: string) =>
    cronGet(
      new Request(`http://localhost/api/cron/retention${query}`, {
        headers: authorization ? { authorization } : {},
      }),
    );

  it('is a 404 with no secret configured, whatever is sent', async () => {
    delete process.env.CRON_SECRET;
    assert.equal((await call('?dryRun=1', 'Bearer ')).status, 404);
    assert.equal((await call('?dryRun=1', 'Bearer undefined')).status, 404);
  });

  it('is a 404 without the right bearer token', async () => {
    process.env.CRON_SECRET = 'test-secret-value';
    assert.equal((await call('?dryRun=1')).status, 404);
    assert.equal((await call('?dryRun=1', 'Bearer wrong')).status, 404);
    assert.equal((await call('?dryRun=1', 'test-secret-value')).status, 404);
  });

  it('runs a dry run for the right token, and only a dry run may move the date', async () => {
    process.env.CRON_SECRET = 'test-secret-value';
    const ok = await call('?dryRun=1&asOf=2027-03-01', 'Bearer test-secret-value');
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { dryRun: boolean; asOf: string };
    assert.equal(body.dryRun, true);
    assert.equal(body.asOf, '2027-03-01T00:00:00.000Z');
    assert.equal((await call('?asOf=2027-03-01', 'Bearer test-secret-value')).status, 400);
    assert.equal((await call('?dryRun=1&asOf=soon', 'Bearer test-secret-value')).status, 400);
  });

  it('is scheduled once a day', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      crons?: { path: string; schedule: string }[];
    };
    const cron = config.crons?.find((each) => each.path === '/api/cron/retention');
    assert.ok(cron, 'no cron entry for the retention job');
    // Minute and hour fixed, every day: Hobby allows one run a day and no more.
    assert.match(cron.schedule, /^\d{1,2} \d{1,2} \* \* \*$/);
  });
});
