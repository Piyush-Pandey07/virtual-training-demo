/**
 * A provider's failure, as the trainee sees it and as the developer log records it.
 *
 * Every route that calls a paid provider fails through here, so the rule that a trainee
 * never sees a provider's own words is kept in one place rather than in each route.
 */

import 'server-only';

import { FAILURE_MESSAGES, type FailureCode } from './codes';
import { codeFor, type ProviderFailure } from './classify';
import { recordFailure } from './devlog';

export interface FailureContext {
  /** The route, as it appears in the log, such as `/api/tts`. */
  route: string;
  person?: { id: string; orgId: string };
  deckId?: string;
  language?: string;
}

export interface FailurePayload {
  error: string;
  code: FailureCode;
  retry: boolean;
  ref: string;
}

/** Logs the failure and returns what the trainee is sent. */
export async function failurePayload(
  failure: ProviderFailure,
  context: FailureContext,
): Promise<FailurePayload> {
  const { code, retry } = codeFor(failure.kind);
  const ref = await recordFailure({
    source: 'server',
    provider: failure.provider,
    kind: failure.kind,
    code,
    status: failure.status,
    detail: failure.detail,
    route: context.route,
    orgId: context.person?.orgId,
    personId: context.person?.id,
    deckId: context.deckId,
    language: context.language,
  });
  return { error: FAILURE_MESSAGES[code], code, retry, ref };
}

/**
 * The same, as a response.
 *
 * Busy is a 503 with a short Retry-After, so a client that knows nothing of codes still
 * waits and asks again. Everything else is a 502: the provider failed, not the request.
 */
export async function failureResponse(
  failure: ProviderFailure,
  context: FailureContext,
): Promise<Response> {
  const payload = await failurePayload(failure, context);
  const busy = payload.code === 'busy';
  return Response.json(payload, {
    status: busy ? 503 : 502,
    headers: busy ? { 'Retry-After': '2' } : undefined,
  });
}
