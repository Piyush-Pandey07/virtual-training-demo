/**
 * What kind of failure a provider's error is, whichever provider it came from.
 *
 * Each provider says the same few things differently. Out of credit is a 402 from
 * Deepgram and Gemini, a 402 or a 429 with `insufficient_quota_error` from Sarvam, and a
 * 429 from OpenAI whose only clue is its wording. Google moved Gemini's empty prepaid
 * account from 429 to 402 in September 2026, so status codes alone are not enough and
 * the words are read too. That is fragile by nature, which is why the tests hold recorded
 * bodies from each provider.
 *
 * Pure, so it can be tested without a server. `respond.ts` turns the result into what
 * the trainee sees and what the developer log records.
 */

import type { FailureCode } from './codes';

export type Provider = 'gemini' | 'deepgram' | 'sarvam' | 'openai';

export type FailureKind =
  /** The prepaid account is empty, or billing has lapsed. */
  | 'out_of_credit'
  /** The provider wants fewer requests for a while. */
  | 'rate_limited'
  /** The key is wrong, revoked, or lacks permission. */
  | 'bad_key'
  /** The key is not set in this deployment at all. */
  | 'not_configured'
  /** Our server could not reach the provider. */
  | 'unreachable'
  /** The provider answered with a server error of its own. */
  | 'upstream_error'
  /** The provider answered, but with something we cannot use. */
  | 'bad_output'
  | 'other';

export interface ProviderFailure {
  provider: Provider;
  kind: FailureKind;
  /** The provider's HTTP status, when there was one. */
  status?: number;
  /** What the provider said, for the developer log. Never shown to a trainee. */
  detail: string;
}

const CREDIT_WORDS =
  /insufficient[ _-]?(credit|fund|quota|balance)|no credits?\b|credits? (have |has )?(run out|expired|exhausted)|out of credit|prepa(y|id)[^.]{0,40}(deplet|exhaust|insufficient)|billing[^.]{0,40}(not enabled|disabled|inactive|required)|payment required/i;

const KEY_WORDS =
  /invalid[ _-]?api[ _-]?key|api key not valid|incorrect api key|authentication|unauthori[sz]ed|permission[ _-]?denied/i;

const RATE_WORDS = /rate[ _-]?limit|too many requests|slow down/i;

/** A failed HTTP response from a provider. */
export function classifyHttp(provider: Provider, status: number, body: string): ProviderFailure {
  const detail = body.slice(0, 1000);
  const failure = (kind: FailureKind): ProviderFailure => ({ provider, kind, status, detail });

  // Credit first, because an empty account arrives as a 429 from Sarvam and OpenAI and
  // would otherwise be read as busy and retried for ever.
  if (status === 402 || CREDIT_WORDS.test(body)) return failure('out_of_credit');
  if (status === 401 || status === 403 || KEY_WORDS.test(body)) return failure('bad_key');
  if (status === 429 || RATE_WORDS.test(body)) return failure('rate_limited');
  if (status >= 500) return failure('upstream_error');
  return failure('other');
}

/**
 * Something thrown on the way to a provider or by its SDK.
 *
 * The Gemini SDK throws an error carrying the HTTP status and the body in its message,
 * so that is classified like a response. A bare network failure has no status at all.
 */
export function classifyThrown(provider: Provider, error: unknown): ProviderFailure {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400) return classifyHttp(provider, status, message);

  const detail = message.slice(0, 1000);
  if (/is not set/i.test(message)) return { provider, kind: 'not_configured', detail };
  if (
    error instanceof TypeError ||
    /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(
      message,
    )
  ) {
    return { provider, kind: 'unreachable', detail };
  }
  // The SDK sometimes puts the status only in the words.
  const inWords = /\b(4\d\d|5\d\d)\b/.exec(message);
  if (inWords) return classifyHttp(provider, Number(inWords[1]), message);
  if (CREDIT_WORDS.test(message)) return { provider, kind: 'out_of_credit', detail };
  if (RATE_WORDS.test(message) || /RESOURCE_EXHAUSTED/.test(message)) {
    return { provider, kind: 'rate_limited', detail };
  }
  return { provider, kind: 'other', detail };
}

/**
 * What the trainee is told for each kind, and whether asking again could help.
 *
 * Only a busy provider is "busy": the rest are "unavailable", because from the trainee's
 * side a provider that is down, empty or misconfigured looks the same and needs the same
 * thing from them, which is to come back later. Retrying is worth it for the kinds that
 * clear on their own, and pointless for an empty account or a refused key, where every
 * attempt is refused the same way.
 */
export function codeFor(kind: FailureKind): { code: FailureCode; retry: boolean } {
  switch (kind) {
    case 'rate_limited':
      return { code: 'busy', retry: true };
    case 'out_of_credit':
    case 'bad_key':
    case 'not_configured':
    case 'other':
      return { code: 'unavailable', retry: false };
    case 'unreachable':
    case 'upstream_error':
    case 'bad_output':
      return { code: 'unavailable', retry: true };
  }
}
