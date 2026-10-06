import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { voiceFor } from './catalogue';
import { sarvamFailure, synthesise } from './synthesise';
import { pcmFromWav } from './wav';

/**
 * Hindi, spoken by Sarvam.
 *
 * Nothing here reaches Sarvam. Its account is a prepaid credit meant for a developer
 * test and a user test, so every request below goes to a stand-in that answers the way
 * Sarvam's documentation says it does, and the tests check what is sent to it and what
 * is made of the reply.
 */

interface WavOptions {
  rate?: number;
  channels?: number;
  bits?: number;
  format?: number;
  /** Chunks placed between the format and the data, as some encoders write them. */
  extra?: Array<[string, Uint8Array]>;
  /** What the data chunk declares, when that is not its real length. */
  declaredDataSize?: number;
}

function chunk(id: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length + (body.length % 2));
  out.set(
    [...id].map((c) => c.charCodeAt(0)),
    0,
  );
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

function wav(samples: Int16Array, options: WavOptions = {}): Uint8Array {
  const { rate = 24000, channels = 1, bits = 16, format = 1, extra = [] } = options;
  const fmt = new Uint8Array(16);
  const view = new DataView(fmt.buffer);
  view.setUint16(0, format, true);
  view.setUint16(2, channels, true);
  view.setUint32(4, rate, true);
  view.setUint32(8, rate * channels * (bits / 8), true);
  view.setUint16(12, channels * (bits / 8), true);
  view.setUint16(14, bits, true);

  const pcm = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  const data = chunk('data', pcm);
  if (options.declaredDataSize !== undefined) {
    new DataView(data.buffer).setUint32(4, options.declaredDataSize, true);
  }
  const parts = [chunk('fmt ', fmt), ...extra.map(([id, body]) => chunk(id, body)), data];
  const length = 4 + parts.reduce((sum, part) => sum + part.length, 0);

  const out = new Uint8Array(8 + length);
  out.set(
    [...'RIFF'].map((c) => c.charCodeAt(0)),
    0,
  );
  new DataView(out.buffer).setUint32(4, length, true);
  out.set(
    [...'WAVE'].map((c) => c.charCodeAt(0)),
    8,
  );
  let at = 12;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const SAMPLES = new Int16Array([0, 1000, -1000, 32767, -32768, 12]);
const SAMPLE_BYTES = new Uint8Array(SAMPLES.buffer);

describe('opening the WAV Sarvam sends', () => {
  it('returns the samples and nothing of the header', () => {
    assert.deepEqual(pcmFromWav(wav(SAMPLES), 24000), SAMPLE_BYTES);
  });

  it('walks past a metadata chunk rather than playing it as noise', () => {
    const list = new TextEncoder().encode('INFOISFT\u0005\u0000\u0000\u0000Lavf\u0000');
    assert.deepEqual(pcmFromWav(wav(SAMPLES, { extra: [['LIST', list]] }), 24000), SAMPLE_BYTES);
  });

  it('copes with an odd-length chunk, which is padded to an even one', () => {
    const odd = new Uint8Array([1, 2, 3]);
    assert.deepEqual(pcmFromWav(wav(SAMPLES, { extra: [['junk', odd]] }), 24000), SAMPLE_BYTES);
  });

  it('takes the samples to the end when the length was not known in advance', () => {
    for (const declared of [0, 0xffffffff]) {
      assert.deepEqual(
        pcmFromWav(wav(SAMPLES, { declaredDataSize: declared }), 24000),
        SAMPLE_BYTES,
      );
    }
  });

  it('never reads past the end of a file that was cut short', () => {
    const whole = wav(SAMPLES);
    const cut = whole.subarray(0, whole.length - 5);
    const pcm = pcmFromWav(cut, 24000);
    assert.equal(pcm.length % 2, 0, 'half a sample was kept');
    assert.ok(pcm.length < SAMPLE_BYTES.length);
  });

  it('refuses audio the player would play wrongly', () => {
    // The wrong rate plays at the wrong pitch, stereo plays at half speed, and 8-bit or
    // compressed audio is read as noise. Each is refused rather than played.
    assert.throws(() => pcmFromWav(wav(SAMPLES, { rate: 22050 }), 24000), /22050 Hz/);
    assert.throws(() => pcmFromWav(wav(SAMPLES, { channels: 2 }), 24000), /2 channel/);
    assert.throws(() => pcmFromWav(wav(SAMPLES, { bits: 8 }), 24000), /8-bit/);
    assert.throws(() => pcmFromWav(wav(SAMPLES, { format: 3 }), 24000), /not plain PCM/);
  });

  it('refuses something that is not a WAV at all', () => {
    assert.throws(
      () => pcmFromWav(new TextEncoder().encode('{"error":"nope"}'), 24000),
      /not come back as a WAV/,
    );
    assert.throws(() => pcmFromWav(new Uint8Array(0), 24000), /not come back as a WAV/);
  });
});

type Call = { url: string; init: RequestInit };

describe('asking Sarvam for Hindi', () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.SARVAM_API_KEY;
  let calls: Call[] = [];
  /** What the stand-in answers with, one entry per call; the last repeats. */
  let replies: Array<() => Response> = [];

  beforeEach(() => {
    process.env.SARVAM_API_KEY = 'test-key';
    calls = [];
    replies = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (!reply) throw new Error('no reply set up');
      return reply();
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.SARVAM_API_KEY;
    else process.env.SARVAM_API_KEY = realKey;
  });

  const spoken = (bytes: Uint8Array) => () =>
    Response.json({ request_id: 'test', audios: [Buffer.from(bytes).toString('base64')] });

  const priya = () => voiceFor('sarvam-hi-priya')!;

  it('sends exactly the request Sarvam documents', async () => {
    replies = [spoken(wav(SAMPLES))];
    const result = await synthesise('आज हम UPS के बारे में बात करेंगे।', priya());
    assert.equal(result.ok, true);

    assert.equal(calls.length, 1);
    const [{ url, init }] = calls;
    assert.equal(url, 'https://api.sarvam.ai/text-to-speech');
    assert.equal(init.method, 'POST');
    const headers = init.headers as Record<string, string>;
    assert.equal(headers['api-subscription-key'], 'test-key');
    assert.deepEqual(JSON.parse(String(init.body)), {
      text: 'आज हम UPS के बारे में बात करेंगे।',
      language_code: 'hi-IN',
      speaker: 'priya',
      model: 'bulbul:v3',
      speech_sample_rate: 24000,
      output_audio_codec: 'wav',
    });
  });

  it('hands back bare samples, exactly as the English voices arrive', async () => {
    replies = [spoken(wav(SAMPLES, { extra: [['LIST', new Uint8Array(10)]] }))];
    const result = await synthesise('नमस्ते।', priya());
    assert.ok(result.ok);
    assert.ok(result.audio instanceof Uint8Array);
    assert.deepEqual(new Uint8Array(result.audio), SAMPLE_BYTES);
  });

  it('waits a moment and tries once more when Sarvam is busy', async () => {
    replies = [
      () =>
        Response.json(
          { error: { code: 'rate_limit_exceeded_error', message: 'slow down' } },
          { status: 429 },
        ),
      spoken(wav(SAMPLES)),
    ];
    const result = await synthesise('नमस्ते।', priya());
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
  });

  it('tries only once more, and then says so plainly', async () => {
    replies = [
      () =>
        Response.json(
          { error: { code: 'rate_limit_exceeded_error', message: 'slow down' } },
          { status: 429 },
        ),
    ];
    const result = await synthesise('नमस्ते।', priya());
    assert.equal(calls.length, 2);
    assert.ok(!result.ok);
    assert.match(result.error, /fewer requests a minute/);
  });

  it('says the credit has run out, and that English still works, when it has', async () => {
    replies = [
      () =>
        Response.json(
          { error: { code: 'insufficient_quota_error', message: 'quota' } },
          { status: 429 },
        ),
    ];
    const result = await synthesise('नमस्ते।', priya());
    assert.ok(!result.ok);
    assert.match(result.error, /credit has run out/);
    assert.match(result.error, /English session/);
    assert.equal(calls.length, 1, 'an empty account was asked twice');
  });

  it('points at the key when Sarvam refuses it', async () => {
    replies = [
      () =>
        Response.json(
          { error: { code: 'invalid_api_key_error', message: 'bad key' } },
          { status: 403 },
        ),
    ];
    const result = await synthesise('नमस्ते।', priya());
    assert.ok(!result.ok);
    assert.match(result.error, /SARVAM_API_KEY/);
    assert.equal(calls.length, 1, 'a refused key is not worth retrying');
  });

  it('refuses audio in a format the player would play wrongly', async () => {
    replies = [spoken(wav(SAMPLES, { rate: 22050 }))];
    const result = await synthesise('नमस्ते।', priya());
    assert.ok(!result.ok);
    assert.equal(result.status, 502);
    assert.match(result.error, /cannot use/);
  });

  it('asks for nothing without a key, and says which one is missing', async () => {
    delete process.env.SARVAM_API_KEY;
    // Built while the key was set, as a running session's voice would have been.
    const voice = { provider: 'sarvam' as const, model: 'priya', languageCode: 'hi-IN' as const };
    const result = await synthesise('नमस्ते।', voice);
    assert.ok(!result.ok);
    assert.match(result.error, /SARVAM_API_KEY is not set/);
    assert.equal(calls.length, 0);
  });

  it('stays silent when the trainee interrupts', async () => {
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = (async () => {
      throw new DOMException('aborted', 'AbortError');
    }) as typeof fetch;
    const result = await synthesise('नमस्ते।', priya(), controller.signal);
    assert.deepEqual(result, { ok: false, status: 499, error: '' });
  });

  it('leaves English with Deepgram, and never asks Sarvam for it', async () => {
    process.env.DEEPGRAM_API_KEY ??= 'test-deepgram-key';
    replies = [() => new Response(new Uint8Array(SAMPLE_BYTES))];
    const result = await synthesise('Welcome to the session.', voiceFor('aura-2-thalia-en')!);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.match(
      calls[0]!.url,
      /^https:\/\/api\.deepgram\.com\/v1\/speak\?model=aura-2-thalia-en&/,
    );
  });
});

describe('what a Sarvam failure says', () => {
  it('reads the code out of the error body', () => {
    const body = (code: string) => JSON.stringify({ error: { code, message: 'x' } });
    assert.match(sarvamFailure(400, body('insufficient_quota_error')), /credit/);
    assert.match(sarvamFailure(401, body('authentication_error')), /key/);
    assert.match(sarvamFailure(429, body('rate_limit_exceeded_error')), /fewer requests/);
  });

  it("keeps Sarvam's own words beside the plain explanation", () => {
    // "Out of credit" is an empty account, an expired trial or a key from another
    // account, and only Sarvam's message says which.
    const quota = JSON.stringify({
      error: { code: 'insufficient_quota_error', message: 'Your trial credits have expired' },
    });
    const said = sarvamFailure(429, quota);
    assert.match(said, /credit has run out/);
    assert.match(said, /Sarvam said: "Your trial credits have expired" \(HTTP 429\)\.$/);
    const key = JSON.stringify({
      error: { code: 'invalid_api_key_error', message: 'Invalid key' },
    });
    assert.match(sarvamFailure(403, key), /Sarvam said: "Invalid key" \(HTTP 403\)\.$/);
    // Nothing to add when Sarvam said nothing.
    assert.ok(sarvamFailure(402, '').endsWith('or start an English session.'));
  });

  it('falls back to the status and whatever Sarvam said', () => {
    assert.equal(
      sarvamFailure(
        500,
        JSON.stringify({ error: { code: 'internal_server_error', message: 'boom' } }),
      ),
      'Sarvam text to speech failed (500). boom',
    );
    assert.equal(
      sarvamFailure(502, 'Bad gateway'),
      'Sarvam text to speech failed (502). Bad gateway',
    );
  });
});
