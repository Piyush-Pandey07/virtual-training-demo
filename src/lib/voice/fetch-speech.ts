/**
 * Fetching one sentence of the trainer's speech, on a connection that may not hold.
 *
 * Browser-side, and kept apart from the player so the rules can be tested without an
 * audio stack. The player used to send each sentence once, with no timeout: a request
 * that hung left the trainer silent until the server gave up thirty seconds later, and
 * one that failed was skipped, so the slide carried on with a sentence missing and was
 * still marked as taught. Trainees on mobile data heard exactly that as "the voice
 * dropped, then it started again from somewhere else".
 *
 * Now every request has a deadline, a failure that might clear is asked again once
 * straight away, and anything still failing goes back to the player as a failure with
 * a standard message, which the player turns into a pause rather than a skip.
 */

import { connectionFailure, readFailure, type Failure } from '../failures/codes';

/**
 * How long one sentence may take before it is asked again.
 *
 * Deepgram takes two to three seconds for a long sentence, a cold server a few more,
 * and an MP3 sentence is about 30 KB, under a second even on a poor 3G link. Twelve
 * seconds is well past all of that together, so it only ever fires on a request that
 * is not coming back.
 */
export const SPEECH_TIMEOUT_MS = 12_000;

/** One request and one retry, then the player pauses and keeps trying on its own. */
export const SPEECH_ATTEMPTS = 2;

export const SPEECH_RETRY_DELAY_MS = 1000;

/** The longest a server's Retry-After is honoured inside a fetch, before pausing instead. */
const MAX_INLINE_WAIT_MS = 5000;

export interface SpeechBody {
  text: string;
  voice?: string;
  format?: 'mp3';
}

export type SpeechFetch =
  | { ok: true; bytes: ArrayBuffer; format: 'mp3' | 'pcm' }
  | { ok: false; aborted: true }
  | {
      ok: false;
      aborted: false;
      failure: Failure;
      /** For the developer log: `timeout`, `network`, or `http-` and the status. */
      kind: string;
    };

export interface FetchDeps {
  fetch: typeof fetch;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

const DEFAULT_DEPS: FetchDeps = { fetch: (...args) => fetch(...args), sleep };

/** One attempt, bounded by the deadline as well as by whoever may cancel it. */
async function attempt(
  body: SpeechBody,
  signal: AbortSignal,
  deps: FetchDeps,
): Promise<SpeechFetch> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), SPEECH_TIMEOUT_MS);
  const cancel = () => deadline.abort();
  signal.addEventListener('abort', cancel, { once: true });

  try {
    const response = await deps.fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No voice field at all when none was chosen, so the server's default applies
      // exactly as it did before there was a choice.
      body: JSON.stringify(body),
      signal: deadline.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        aborted: false,
        failure: await readFailure(response),
        kind: `http-${response.status}`,
      };
    }
    const bytes = await response.arrayBuffer();
    const format = response.headers.get('Content-Type')?.includes('audio/mpeg') ? 'mp3' : 'pcm';
    return { ok: true, bytes, format };
  } catch {
    if (signal.aborted) return { ok: false, aborted: true };
    // Our deadline, or the network. Either way nothing came back, and from the
    // trainee's side both are the connection.
    const kind = deadline.signal.aborted ? 'timeout' : 'network';
    return { ok: false, aborted: false, failure: connectionFailure(), kind };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

/**
 * Fetches one sentence, asking again once if the failure might clear.
 *
 * A refusal that will not clear (an empty account, a refused key) is returned at once,
 * because asking again only spends time before the trainee is told.
 */
export async function fetchSpeech(
  body: SpeechBody,
  signal: AbortSignal,
  deps: FetchDeps = DEFAULT_DEPS,
): Promise<SpeechFetch> {
  let result: SpeechFetch = { ok: false, aborted: true };
  for (let tries = 0; tries < SPEECH_ATTEMPTS; tries += 1) {
    if (tries > 0) {
      const asked = !result.ok && !result.aborted ? result.failure.retryAfter : undefined;
      const wait = asked ? asked * 1000 : SPEECH_RETRY_DELAY_MS;
      // A long wait the server asked for is the player's to take, visibly, not this
      // function's to sit through in silence.
      if (wait > MAX_INLINE_WAIT_MS) return result;
      try {
        await deps.sleep(wait, signal);
      } catch {
        return { ok: false, aborted: true };
      }
    }
    result = await attempt(body, signal, deps);
    if (result.ok || result.aborted || !result.failure.retry) return result;
  }
  return result;
}

/**
 * How long the player waits before trying again on its own, once paused.
 *
 * Quick at first, because most drops are seconds long, then backing off so a trainee
 * who has gone offline for a while is not costing a request every few seconds. Null
 * when waiting will not help and only the trainee asking again should try.
 */
export function stallRetryDelayMs(stalls: number, failure: Failure): number | null {
  if (!failure.retry) return null;
  if (failure.retryAfter) return failure.retryAfter * 1000;
  const steps = [3000, 6000, 10_000, 15_000];
  return steps[Math.min(stalls, steps.length - 1)]!;
}

/**
 * One sentence as raw PCM, handed over piece by piece as it arrives (AI-44).
 *
 * The opening sentence of a turn is the one the trainee waits for in silence, and
 * measured on the live site its audio began arriving after about 0.85 s but took 1.5 to
 * 3 s to arrive whole. MP3 has to be whole before it can be decoded; PCM does not, so
 * this asks for PCM and gives the player each piece to schedule straight away.
 *
 * One attempt only, no retry: a failure before anything arrived returns the failure, and
 * the player falls back to fetching the sentence the ordinary way, with its retries and
 * holds. `received` says how many bytes were handed over before it ended.
 */
export async function streamSpeech(
  body: Omit<SpeechBody, 'format'>,
  signal: AbortSignal,
  onPiece: (pcm: Uint8Array) => void,
  deps: Pick<FetchDeps, 'fetch'> = DEFAULT_DEPS,
): Promise<
  | { ok: true; received: number }
  | { ok: false; aborted: true; received: number }
  | { ok: false; aborted: false; failure: Failure; kind: string; received: number }
> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), SPEECH_TIMEOUT_MS);
  const cancel = () => deadline.abort();
  signal.addEventListener('abort', cancel, { once: true });
  let received = 0;
  try {
    const response = await deps.fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: deadline.signal,
    });
    if (!response.ok || !response.body) {
      return {
        ok: false,
        aborted: false,
        failure: await readFailure(response),
        kind: `http-${response.status}`,
        received,
      };
    }
    if (response.headers.get('Content-Type')?.includes('audio/mpeg')) {
      // Not PCM after all: nothing here can play it piece by piece.
      return { ok: false, aborted: false, failure: connectionFailure(), kind: 'not-pcm', received };
    }
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        received += value.byteLength;
        onPiece(value);
      }
    }
    return { ok: true, received };
  } catch {
    if (signal.aborted) return { ok: false, aborted: true, received };
    const kind = deadline.signal.aborted ? 'timeout' : 'network';
    return { ok: false, aborted: false, failure: connectionFailure(), kind, received };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}
