import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { FAILURE_MESSAGES } from '../failures/codes';
import { fetchSpeech, stallRetryDelayMs, streamSpeech, type FetchDeps } from './fetch-speech';

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

describe('streaming the opening sentence (AI-44)', () => {
  const streamed = (pieces: number[][]) => async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const piece of pieces) controller.enqueue(new Uint8Array(piece));
          controller.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/octet-stream' } },
    );

  it('hands over each piece as it arrives, asking for PCM rather than MP3', async () => {
    const fake = deps([streamed([[1, 2, 3], [4, 5], [6]])]);
    const got: number[][] = [];
    const result = await streamSpeech(
      { text: 'Hello there.' },
      new AbortController().signal,
      (piece) => got.push([...piece]),
      fake,
    );
    assert.deepEqual(got, [[1, 2, 3], [4, 5], [6]]);
    assert.deepEqual(result, { ok: true, received: 6 });
    assert.doesNotMatch(fake.calls[0]!, /mp3/);
  });

  it('gives back the failure when nothing arrived, so the player can fetch it as usual', async () => {
    const result = await streamSpeech(
      { text: 'Hello there.' },
      new AbortController().signal,
      () => assert.fail('nothing should arrive'),
      deps([refused(503, { error: 'busy', retry: true })]),
    );
    assert.equal(result.ok, false);
    assert.equal(result.received, 0);
  });

  it('refuses MP3, which cannot be played piece by piece', async () => {
    const result = await streamSpeech(
      { text: 'Hello there.' },
      new AbortController().signal,
      () => assert.fail('nothing should be handed over'),
      deps([audio('audio/mpeg')]),
    );
    assert.equal(result.ok, false);
  });

  it('is used by the player for the opening sentence only, with a fallback', () => {
    const player = readFileSync('src/hooks/useTtsPlayer.ts', 'utf8').replaceAll(
      String.fromCharCode(13),
      '',
    );
    assert.match(player, /enqueue\(buffer\.slice\(0, cut\), opening\);/);
    assert.match(player, /if \(item\.stream && !pacedToPlayback\(languageRef\.current\)\)/);
    assert.match(player, /if \(await playStreamed\(item\)\) return;/);
    assert.match(player, /!item\.audio && !item\.stream/);
  });
});

describe('the opening sentence fetched ahead (AI-44)', () => {
  it('is fetched while the last turn plays, and used before streaming is tried', () => {
    const player = readFileSync('src/hooks/useTtsPlayer.ts', 'utf8').replaceAll(
      String.fromCharCode(13),
      '',
    );
    const session = readFileSync('src/hooks/useTrainingSession.ts', 'utf8').replaceAll(
      String.fromCharCode(13),
      '',
    );
    assert.match(session, /ttsRef\.current\.preloadOpening\(result\)/);
    assert.match(player, /const ready = preloadedRef\.current\.get\(key\);/);
    // Cut as playback will cut it, so the text matches the sentence it is used for.
    assert.match(player, /const cut = nextOpeningCut\(fullText\);/);
    // Never for the Sarvam languages, whose credit is spent only on what is heard.
    assert.match(
      player,
      /preloadOpening = useCallback\(\s*\(fullText: string\) => \{\s*if \(pacedToPlayback/,
    );
  });
});
