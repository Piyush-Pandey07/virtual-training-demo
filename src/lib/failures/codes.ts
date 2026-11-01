/**
 * What a trainee is told when something they depend on fails.
 *
 * Safe to import from the browser, and free of imports so both sides share one list.
 *
 * The session talks to four paid services (Gemini, Deepgram, Sarvam and, on the test
 * page, OpenAI), and each fails in its own words. Those words used to reach the screen
 * as they were: a trainee read "Deepgram text to speech failed (402)" or "Add credit at
 * dashboard.sarvam.ai", which tells them nothing they can act on and tells a customer
 * which vendors sit behind the product. Every failure now becomes one of a few codes,
 * each with one message that names no provider. What the provider actually said goes to
 * the developer log (see `devlog.ts`), where Technavious staff can read it.
 *
 * The set is small on purpose. A trainee can do three things about a failure: wait for
 * the connection, wait a moment, or come back later. Anything finer is for the log.
 */

export type FailureCode =
  /** The trainee's own connection, or ours, dropped. Waiting for it fixes it. */
  | 'connection'
  /** A service is refusing for a moment because of load. A short wait fixes it. */
  | 'busy'
  /** A service is down, out of credit or misconfigured. Waiting a moment will not. */
  | 'unavailable'
  /** Our own rate limit. The server words that one itself, with how long to wait. */
  | 'limited';

export const FAILURE_CODES: readonly FailureCode[] = [
  'connection',
  'busy',
  'unavailable',
  'limited',
];

/**
 * The words on screen. Written for a trainee in the middle of a lesson: what happened in
 * plain terms, whether their place is safe, and what to do.
 */
export const FAILURE_MESSAGES: Record<FailureCode, string> = {
  connection:
    'The connection dropped. Nova will carry on from the same sentence as soon as it is back.',
  busy: 'Nova is very busy for a moment and will carry on shortly.',
  unavailable:
    'Nova cannot carry on right now. Your progress is saved. Try again in a few minutes, and tell your administrator if it keeps happening.',
  limited: 'That is more requests than this needs in a short time, so it has been paused.',
};

/**
 * A connection that dropped partway through a turn, once some of it had been heard.
 *
 * The one case the "carry on from the same sentence" promise cannot keep. The words are
 * generated as one stream, and the rest of a broken stream cannot be asked for again
 * without asking for the whole turn, so the trainee is told how to hear it rather than
 * promised it.
 */
export const CONNECTION_LOST_MID_TURN =
  'The connection dropped partway through. Press Explain again to hear this slide once it is back.';

/** Something the trainee said could not be sent, even after asking again. */
export const LISTENING_LOST =
  'The connection dropped, so that was not heard. Say it again once it is back, or type it.';

export function isFailureCode(value: unknown): value is FailureCode {
  return typeof value === 'string' && (FAILURE_CODES as readonly string[]).includes(value);
}

/** What a failed response from one of our routes carries, as the browser reads it. */
export interface Failure {
  code: FailureCode;
  message: string;
  /** Whether asking again could work. False for an empty account or a refused key. */
  retry: boolean;
  /** Seconds to wait first, when the server said. */
  retryAfter?: number;
  /** Ties what the trainee saw to the developer log entry, for support. */
  ref?: string;
}

/**
 * Reads a failed response from one of our routes.
 *
 * Every route that fails because of a provider sends `{ error, code, retry, ref }`. A
 * body without a code is either our own refusal (a 400 for a bad request, worded for the
 * person) or something that never reached our code at all, such as a gateway timeout,
 * and the status decides which.
 */
export async function readFailure(response: Response): Promise<Failure> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: unknown;
    code?: unknown;
    retry?: unknown;
    ref?: unknown;
  };
  const header = Number(response.headers.get('Retry-After'));
  const retryAfter = Number.isFinite(header) && header > 0 ? header : undefined;
  const ref = typeof body.ref === 'string' ? body.ref : undefined;
  const said = typeof body.error === 'string' && body.error ? body.error : undefined;

  if (response.status === 429 && !isFailureCode(body.code)) {
    return { code: 'limited', message: said ?? FAILURE_MESSAGES.limited, retry: true, retryAfter };
  }
  if (isFailureCode(body.code)) {
    return {
      code: body.code,
      message: said ?? FAILURE_MESSAGES[body.code],
      retry: body.retry !== false,
      retryAfter,
      ref,
    };
  }
  // A gateway in front of the function timed out or fell over. Nothing of ours ran to
  // completion, so it is treated like a dropped connection and asked again.
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return { code: 'connection', message: FAILURE_MESSAGES.connection, retry: true, retryAfter };
  }
  return { code: 'unavailable', message: said ?? FAILURE_MESSAGES.unavailable, retry: false, ref };
}

/**
 * A request that never got a response: the network went, or our own timeout gave up.
 *
 * `fetch` rejects with a TypeError whose wording differs in every browser ("Failed to
 * fetch", "Load failed", "NetworkError when attempting to fetch resource"), so the type
 * is what is trusted, not the words.
 */
export function connectionFailure(): Failure {
  return { code: 'connection', message: FAILURE_MESSAGES.connection, retry: true };
}

/** The message to show for a failure, with its reference when there is one. */
export function describeFailure(failure: Failure): string {
  return failure.ref ? `${failure.message} (Reference ${failure.ref})` : failure.message;
}
