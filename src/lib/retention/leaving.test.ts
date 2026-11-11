import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { ASSESSMENT_RESULTS, assessmentDocuments, FEEDBACK } from '../assessments/store';
import type { AssessmentResult, FeedbackRecord } from '../assessments/types';
import { scopedDocuments } from '../orgs/scope';
import { InMemoryDocumentStore } from '../roster/documents';
import { LEAVERS, leaverDocuments, recordLeaver, type LeaverRecord } from '../roster/leavers';
import { DocumentRosterStore } from '../roster/store-documents';
import { eraseLeaverAnswers } from './leaving';

/**
 * Removing somebody (AI-42), as the product owner decided it: "profile fields and
 * assessment answers are deleted. Name, email, attendance, completion, score and pass or
 * fail are kept for 5 years."
 */

const ORG = 'acme';
const DECK = 'dc-power-a1b2c3';

describe('removing somebody', () => {
  it('deletes their answers and comments, and keeps the score, pass or fail and ratings', async () => {
    const store = new InMemoryDocumentStore();
    const docs = assessmentDocuments(ORG, store);
    const result: AssessmentResult = {
      id: `asha__${DECK}__post`,
      personId: 'asha',
      deckId: DECK,
      kind: 'post',
      sessionId: null,
      answers: [{ questionId: 'q1', chosenIndex: 1, correct: false }],
      correct: 7,
      total: 10,
      percent: 70,
      passed: true,
      passMark: 70,
      bankVersion: 'v1',
      bankSource: 'upload',
      submittedAt: '2026-11-01T00:00:00.000Z',
    };
    const feedback: FeedbackRecord = {
      id: `asha__${DECK}`,
      personId: 'asha',
      deckId: DECK,
      sessionId: null,
      questionSetId: 'interim-2026-11',
      ratings: { trainer: 4 },
      comments: { comment: 'The room was cold.' },
      submittedAt: '2026-11-01T00:00:00.000Z',
    };
    await docs.set(ASSESSMENT_RESULTS, result.id, result);
    await docs.set(FEEDBACK, feedback.id, feedback);

    assert.deepEqual(await eraseLeaverAnswers(ORG, 'asha', { store }), { results: 1, feedback: 1 });
    const kept = await docs.get<AssessmentResult>(ASSESSMENT_RESULTS, result.id);
    assert.deepEqual(kept?.answers, []);
    assert.equal(kept?.percent, 70);
    assert.equal(kept?.passed, true);
    const given = await docs.get<FeedbackRecord>(FEEDBACK, feedback.id);
    assert.deepEqual(given?.comments, {});
    assert.deepEqual(given?.ratings, { trainer: 4 });

    // Twice is harmless, and writes nothing.
    assert.deepEqual(await eraseLeaverAnswers(ORG, 'asha', { store }), { results: 0, feedback: 0 });
  });

  it('keeps their name and address for the five-year record', async () => {
    const store = new InMemoryDocumentStore();
    await recordLeaver(
      ORG,
      { id: 'asha', name: 'Asha Patil', email: 'Asha@acme.example', emailKey: 'asha@acme.example' },
      'hr',
      { store, now: new Date('2026-11-12T00:00:00.000Z') },
    );
    const leaver = await leaverDocuments(ORG, store).get<LeaverRecord>(LEAVERS, 'asha');
    assert.equal(leaver?.name, 'Asha Patil');
    assert.equal(leaver?.email, 'Asha@acme.example');
    assert.equal(leaver?.leftAt, '2026-11-12T00:00:00.000Z');
    assert.equal(leaver?.removedBy, 'hr');
  });

  it('keeps their attempts, the record of completion, when asked to', async () => {
    const roster = new DocumentRosterStore(scopedDocuments(new InMemoryDocumentStore(), ORG));
    const person = await roster.upsertPerson({ email: 'asha@acme.example', orgId: ORG });
    await roster.assign({ personId: person.id, deckId: DECK, assignedBy: 'hr' });
    await roster.recordCovered({
      personId: person.id,
      deckId: DECK,
      slideId: 1,
      targetSeconds: 60,
      slideCount: 5,
      totalSeconds: 300,
    });

    await roster.removePerson(person.id, { keepAttempts: true });
    assert.equal(await roster.getPerson(person.id), undefined, 'they can still sign in');
    assert.deepEqual(await roster.listAssignmentsForDeck(DECK), []);
    assert.ok(await roster.getAttempt(person.id, DECK), 'their completion went with them');
    assert.equal((await roster.listAttempts()).length, 1);

    await roster.removeAttempt(person.id, DECK);
    assert.equal(await roster.getAttempt(person.id, DECK), undefined);
  });

  it('is what the route does: login, profile and answers now; name and attempts kept', () => {
    const route = readFileSync('src/app/api/people/[id]/route.ts', 'utf8');
    const remove = route.slice(route.indexOf('export async function DELETE'));
    const leaver = remove.indexOf('recordLeaver(admin.orgId, leaving, admin.id)');
    const row = remove.indexOf('roster.removePerson(id, { keepAttempts: true })');
    assert.ok(leaver > 0 && row > 0, 'the route no longer keeps the name, or the attempts');
    assert.ok(leaver < row, 'the name is written after the row is gone, so a failure loses it');
    assert.match(remove, /deleteAccount\(id\)/);
    assert.match(remove, /deleteProfile\(\{ id, orgId: admin\.orgId/);
    assert.match(remove, /eraseLeaverAnswers\(admin\.orgId, id\)/);
  });
});
