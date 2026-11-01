import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FAILURE_MESSAGES } from '../failures/codes';
import { fetchSpeech, stallRetryDelayMs, type FetchDeps } from './fetch-speech';

/**
 * Fetching a sentence on a connection that may not hold (AI-10).
 *
 * With a fake fetch, so each way a request can go wrong is made to happen on purpose:
 * the network failing, the server refusing, and the trainee cancelling.
 */

function deps(
  responses: Array<() => Promise<Response>>,
): FetchDeps & { calls: string[]; slept: number[] } {
  const calls: string[] = [];
  const slept: number[] = [];
  return {
    calls,
    slept,
    fetch: async (_url, init) => {
      calls.push(String(init?.body));
      const next = responses.shift();
      if (!next) throw new Error('more requests than expected');
      return next();
    },
    sleep: async (ms) => {
      slept.push(ms);
    },
  };
}

const audio = (type: string) => async () =>
  new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'Content-Type': type } });
const offline = async (): Promise<Response> => {
  throw new TypeError('Failed to fetch');
};
const refused =
  (status: number, body: unknown, headers: Record<string, string> = {}) =>
  async () =>
    new Response(JSON.stringify(body), { status, headers });

describe('fetching one sentence', () => {
  it('reports MP3 when the server sent MP3, and PCM otherwise', async () => {
    const mp3 = await fetchSpeech(
      { text: 'Hello.', format: 'mp3' },
      new AbortController().signal,
      deps([audio('audio/mpeg')]),
    );
    assert.ok(mp3.ok && mp3.format === 'mp3');
    const pcm = await fetchSpeech(
      { text: 'Hello.' },
      new AbortController().signal,
      deps([audio('application/octet-stream')]),
    );
    assert.ok(pcm.ok && pcm.format === 'pcm');
  });

  it('asks once more after the network fails, then succeeds', async () => {
    const fake = deps([offline, audio('audio/mpeg')]);
    const result = await fetchSpeech({ text: 'Hello.' }, new AbortController().signal, fake);
    assert.ok(result.ok);
    assert.equal(fake.calls.length, 2);
    assert.deepEqual(fake.slept, [1000]);
  });

  it('gives back a connection failure when both attempts fail', async () => {
    const fake = deps([offline, offline]);
    const result = await fetchSpeech({ text: 'Hello.' }, new AbortController().signal, fake);
    assert.ok(!result.ok && !result.aborted);
    assert.equal(result.failure.code, 'connection');
    assert.equal(result.failure.message, FAILURE_MESSAGES.connection);
    assert.equal(result.kind, 'network');
  });

  it('does not ask again when waiting will not help', async () => {
    const fake = deps([
      refused(502, {
        error: FAILURE_MESSAGES.unavailable,
        code: 'unavailable',
        retry: false,
        ref: 'R',
      }),
    ]);
    const result = await fetchSpeech({ text: 'Hello.' }, new AbortController().signal, fake);
    assert.ok(!result.ok && !result.aborted);
    assert.equal(fake.calls.length, 1);
    assert.equal(result.failure.ref, 'R');
    assert.equal(result.kind, 'http-502');
  });

  it('leaves a long wait the server asked for to the player', async () => {
    const fake = deps([refused(429, { error: 'Paused.' }, { 'Retry-After': '30' })]);
    const result = await fetchSpeech({ text: 'Hello.' }, new AbortController().signal, fake);
    assert.ok(!result.ok && !result.aborted);
    assert.equal(result.failure.retryAfter, 30);
    assert.deepEqual(fake.slept, [], 'it sat through thirty seconds of silence');
  });

  it('honours a short wait inline', async () => {
    const fake = deps([
      refused(
        503,
        { error: FAILURE_MESSAGES.busy, code: 'busy', retry: true },
        { 'Retry-After': '2' },
      ),
      audio('audio/mpeg'),
    ]);
    const result = await fetchSpeech({ text: 'Hello.' }, new AbortController().signal, fake);
    assert.ok(result.ok);
    assert.deepEqual(fake.slept, [2000]);
  });

  it('is silent when the trainee cancelled', async () => {
    const controller = new AbortController();
    const fake = deps([
      async () => {
        controller.abort();
        throw new DOMException('Aborted', 'AbortError');
      },
    ]);
    const result = await fetchSpeech({ text: 'Hello.' }, controller.signal, fake);
    assert.deepEqual(result, { ok: false, aborted: true });
  });

  it('sends the voice and format it was given, and nothing it was not', async () => {
    const fake = deps([audio('audio/mpeg')]);
    await fetchSpeech(
      { text: 'Hi.', voice: 'aura-2-thalia-en', format: 'mp3' },
      new AbortController().signal,
      fake,
    );
    assert.deepEqual(JSON.parse(fake.calls[0]!), {
      text: 'Hi.',
      voice: 'aura-2-thalia-en',
      format: 'mp3',
    });
  });
});

describe('trying again once held', () => {
  const connection = { code: 'connection' as const, message: '', retry: true };

  it('backs off, quickly at first', () => {
    assert.deepEqual(
      [0, 1, 2, 3, 9].map((stalls) => stallRetryDelayMs(stalls, connection)),
      [3000, 6000, 10_000, 15_000, 15_000],
    );
  });

  it('waits exactly as long as the server asked', () => {
    assert.equal(stallRetryDelayMs(0, { ...connection, retryAfter: 42 }), 42_000);
  });

  it('waits for the trainee when waiting will not help', () => {
    assert.equal(stallRetryDelayMs(0, { code: 'unavailable', message: '', retry: false }), null);
  });
});
