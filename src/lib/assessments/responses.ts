/**
 * The service's refusals, as responses.
 *
 * In one place so every assessment route words a second attempt, a stale paper and a
 * missing deck the same way, and a route cannot forget one of them and send a 500.
 */

import 'server-only';

import { isRestricted } from '../retention/restricted';
import { AnswersRejected, summaryOf } from './scoring';
import { Refused } from './service';
import { AlreadySubmitted } from './store';
import type { AssessmentResult } from './types';

/** A response for a refusal the service threw, or null when it was something else. */
export function refusalResponse(error: unknown): Response | null {
  if (error instanceof AlreadySubmitted) {
    // The first result travels back with the refusal, so a page that was open on two
    // devices can show the score that stands rather than only saying no. Not once it is
    // restricted under the retention policy, when only the refusal does.
    const existing = error.existing;
    const result =
      'kind' in existing && 'percent' in existing && !isRestricted(existing)
        ? summaryOf(existing as AssessmentResult)
        : undefined;
    return Response.json({ error: error.message, result }, { status: 409 });
  }
  if (error instanceof Refused || error instanceof AnswersRejected) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}
