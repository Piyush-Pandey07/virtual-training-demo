/**
 * The gate and error handling every batch and session route shares.
 */

import 'server-only';

import { requireUser, unauthorisedResponse } from '../auth/guard';
import { mayRunSessions } from '../auth/permissions';
import type { SignedInPerson } from '../roster/types';
import { TrainingRuleError } from './service';

/** Facilitators, company administrators and Technavious. Anybody else gets a 404. */
export async function sessionRunner(): Promise<SignedInPerson | Response> {
  try {
    const person = await requireUser();
    if (!mayRunSessions(person)) return Response.json({ error: 'Not found.' }, { status: 404 });
    return person;
  } catch (error) {
    const refused = unauthorisedResponse(error);
    if (refused) return refused;
    throw error;
  }
}

/** A rule broken, as the response the browser shows; anything else is rethrown. */
export function ruleResponse(error: unknown): Response {
  if (error instanceof TrainingRuleError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  throw error;
}

export async function jsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const body = (await request.json()) as unknown;
    if (body && typeof body === 'object') return body as Record<string, unknown>;
  } catch {
    // Falls through to the refusal below.
  }
  return Response.json({ error: 'The request must be JSON.' }, { status: 400 });
}
