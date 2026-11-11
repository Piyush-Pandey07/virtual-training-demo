/**
 * What happens to somebody's training data when an administrator removes them (AI-42).
 *
 * The same line the daily job draws a year after last use, drawn at once: the personal
 * detail goes now, and the training record stays for the five-year rule. Their learner
 * profile is deleted by the route, as before. This deletes their assessment answers, the
 * per-question answers on every result and anything they wrote in feedback, and keeps the
 * score, pass or fail, level, ratings and dates, which the daily job deletes five years
 * after their last use along with their attempts, attendance and name.
 *
 * Kept out of the route so the tests can drive it against the in-memory store.
 */

import 'server-only';

import { assessmentDocuments, ASSESSMENT_RESULTS, FEEDBACK } from '../assessments/store';
import type { AssessmentResult, FeedbackRecord } from '../assessments/types';
import type { DocumentStore } from '../roster/documents';

export interface ErasedOnLeaving {
  results: number;
  feedback: number;
}

/**
 * Deletes a leaver's assessment answers and feedback comments, in their organisation.
 *
 * Each record is changed inside a transaction and only if there is something to delete,
 * so running it twice, or after the daily job has already erased a record, writes nothing.
 */
export async function eraseLeaverAnswers(
  orgId: string,
  personId: string,
  options: { store?: DocumentStore } = {},
): Promise<ErasedOnLeaving> {
  const docs = assessmentDocuments(orgId, options.store);
  const [results, feedback] = await Promise.all([
    docs.where<AssessmentResult>(ASSESSMENT_RESULTS, 'personId', personId),
    docs.where<FeedbackRecord>(FEEDBACK, 'personId', personId),
  ]);

  // A record deleted between the read and the write is skipped, not recreated.
  const gone = Symbol('gone');
  const quietly = async (work: Promise<unknown>): Promise<boolean> => {
    try {
      await work;
      return true;
    } catch (error) {
      if (error === gone) return false;
      throw error;
    }
  };

  const erased: ErasedOnLeaving = { results: 0, feedback: 0 };
  for (const result of results) {
    if (!result.id || (result.answers ?? []).length === 0) continue;
    const done = await quietly(
      docs.update<AssessmentResult>(ASSESSMENT_RESULTS, result.id, (current) => {
        if (!current) throw gone;
        return { ...current, answers: [] };
      }),
    );
    if (done) erased.results += 1;
  }
  for (const record of feedback) {
    if (!record.id || Object.keys(record.comments ?? {}).length === 0) continue;
    const done = await quietly(
      docs.update<FeedbackRecord>(FEEDBACK, record.id, (current) => {
        if (!current) throw gone;
        return { ...current, comments: {} };
      }),
    );
    if (done) erased.feedback += 1;
  }
  return erased;
}
