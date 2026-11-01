/**
 * Text to speech, for whichever provider serves the voice.
 *
 * One function, used by every route that speaks, so that adding a provider is a change
 * here rather than in each route. English is Deepgram Aura; Hindi is Sarvam Bulbul.
 *
 * Returns raw 16-bit mono PCM at AUDIO_SAMPLE_RATE, with no container. The browser
 * builds Web Audio buffers straight from those samples, which is what lets playback
 * start without a decoding step and a barge-in cut off cleanly mid-word. Any provider
 * added here has to return exactly that, converting if it must, as Sarvam's WAV is.
 */

import 'server-only';

import { AUDIO_SAMPLE_RATE, SARVAM_TTS_MODEL, requireEnv } from '../config';
import { classifyHttp, classifyThrown, type ProviderFailure } from '../failures/classify';
import { failureResponse, type FailureContext } from '../failures/respond';
import type { SpokenVoice } from './catalogue';
import { pcmFromWav } from './wav';

/**
 * Deepgram rejects very long single requests, and the client sentence-chunks anyway.
 * Sarvam's own ceiling, 2,500 characters, is higher still.
 */
export const MAX_SYNTHESIS_CHARS = 1800;

export type Synthesis =
  | {
      ok: true;
      audio: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer>;
      /** Raw PCM unless MP3 was asked for and the provider could give it. */
      format?: 'pcm' | 'mp3';
    }
  | {
      ok: false;
      status: number;
      /** For whoever reads the log or the staff test page, not for a trainee. */
      error: string;
      /** What kind of failure it was, for the standard message. Absent on a cancel. */
      failure?: ProviderFailure;
    };

export interface SynthesisOptions {
  /**
   * Ask for MP3 rather than raw PCM where the provider can give it.
   *
   * Raw PCM at 24 kHz is 48 KB for every second of speech, about 384 kbps, which is more
   * than a weak mobile connection carries, so the trainer falls silent between sentences
   * while the next one downloads. MP3 at 48 kbps is about eight times smaller for the same
   * sentence (measured: 267 KB of PCM against 32 KB of MP3) and takes Deepgram no longer
   * to produce. The cost is a decoding step in the browser, which is why it is asked for
   * rather than assumed: the voice samples and the staff test page still take PCM.
   *
   * Deepgram only. Sarvam's WAV is converted to PCM as before, and Hindi is paced to
   * playback anyway, so its downloads are already spread out.
   */
  compressed?: boolean;
}

export function synthesise(
  text: string,
  voice: SpokenVoice,
  signal?: AbortSignal,
  options: SynthesisOptions = {},
): Promise<Synthesis> {
  return voice.provider === 'sarvam'
    ? sarvam(text, voice, signal)
    : deepgram(text, voice.model, signal, options.compressed === true);
}

async function deepgram(
  text: string,
  model: string,
  signal?: AbortSignal,
  compressed = false,
): Promise<Synthesis> {
  let apiKey: string;
  try {
    apiKey = requireEnv('DEEPGRAM_API_KEY');
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: (error as Error).message,
      failure: classifyThrown('deepgram', error),
    };
  }

  const url = new URL('https://api.deepgram.com/v1/speak');
  url.searchParams.set('model', model);
  if (compressed) {
    // Deepgram fixes the MP3 sample rate itself; the browser resamples when it decodes.
    url.searchParams.set('encoding', 'mp3');
    url.searchParams.set('bit_rate', '48000');
  } else {
    url.searchParams.set('encoding', 'linear16');
    url.searchParams.set('sample_rate', String(AUDIO_SAMPLE_RATE));
    // No container, so the body is a bare PCM stream with no WAV header to skip.
    url.searchParams.set('container', 'none');
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: text.slice(0, MAX_SYNTHESIS_CHARS) }),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    // The listener stopped the trainer mid-sentence. Nothing to report.
    if (signal?.aborted) return { ok: false, status: 499, error: '' };
    return {
      ok: false,
      status: 502,
      error: `Could not reach Deepgram: ${(error as Error).message}`,
      failure: { provider: 'deepgram', kind: 'unreachable', detail: (error as Error).message },
    };
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    const hint =
      upstream.status === 400
        ? ' Check that the voice names a valid Aura voice.'
        : upstream.status === 401 || upstream.status === 403
          ? ' Check that DEEPGRAM_API_KEY is correct.'
          : '';
    return {
      ok: false,
      status: 502,
      error: `Deepgram text to speech failed (${upstream.status}).${hint} ${detail}`.trim(),
      failure: classifyHttp('deepgram', upstream.status, detail),
    };
  }

  return { ok: true, audio: upstream.body, format: compressed ? 'mp3' : 'pcm' };
}

const SARVAM_URL = 'https://api.sarvam.ai/text-to-speech';

/**
 * How long to wait before the one retry a busy Sarvam gets.
 *
 * Its starter plan allows thirty Bulbul v3 requests a minute. The player asks for speech
 * only shortly before it is needed, which keeps a session well inside that, so a refusal
 * is a brief burst, such as Next pressed several times in a row, and a moment's wait
 * rides it out. Retried once only: a second refusal is reported rather than queued.
 */
const SARVAM_RETRY_MS = 1200;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Says what went wrong in words that tell somebody what to do about it.
 *
 * The credit case matters most. The account behind this is prepaid, and when it runs out
 * every Hindi sentence fails; the trainee should be told that plainly rather than shown a
 * status code, and told that English still works.
 */
export function sarvamFailure(status: number, detail: string): string {
  let code = '';
  let message = '';
  try {
    const parsed = JSON.parse(detail) as { error?: { code?: string; message?: string } };
    code = parsed.error?.code ?? '';
    message = parsed.error?.message ?? '';
  } catch {
    message = detail.slice(0, 200);
  }

  // Sarvam's own words, beside the plain explanation. "Out of credit" covers an empty
  // account, an expired trial and a key from another account alike, and only its message
  // says which. The first real call from production hit exactly that, with nothing to go on.
  const said = message ? ` Sarvam said: "${message.slice(0, 200)}" (HTTP ${status}).` : '';

  if (code === 'insufficient_quota_error' || status === 402) {
    return `Hindi speech has stopped because the Sarvam credit has run out. Add credit at dashboard.sarvam.ai, or start an English session.${said}`;
  }
  if (
    code === 'invalid_api_key_error' ||
    code === 'authentication_error' ||
    status === 401 ||
    status === 403
  ) {
    return `Sarvam refused the key, so Hindi cannot be spoken. Check that SARVAM_API_KEY is correct.${said}`;
  }
  if (code === 'rate_limit_exceeded_error' || status === 429) {
    return 'Sarvam is asking for fewer requests a minute. Wait a moment, then carry on.';
  }
  return `Sarvam text to speech failed (${status}). ${message}`.trim();
}

async function sarvam(text: string, voice: SpokenVoice, signal?: AbortSignal): Promise<Synthesis> {
  let apiKey: string;
  try {
    apiKey = requireEnv('SARVAM_API_KEY');
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: (error as Error).message,
      failure: classifyThrown('sarvam', error),
    };
  }

  const request = () =>
    fetch(SARVAM_URL, {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text.slice(0, MAX_SYNTHESIS_CHARS),
        language_code: voice.languageCode,
        speaker: voice.model,
        model: SARVAM_TTS_MODEL(),
        // The rate the player runs at, so nothing is resampled on the way.
        speech_sample_rate: AUDIO_SAMPLE_RATE,
        // A WAV rather than bare samples, so the format can be checked before it plays.
        output_audio_codec: 'wav',
      }),
      signal,
      cache: 'no-store',
    });

  let upstream: Response;
  let detail = '';
  try {
    upstream = await request();
    if (upstream.status === 429 || upstream.status === 503) {
      detail = await upstream.text().catch(() => '');
      // Out of credit is not busy, and asking again would only be refused again.
      if (!detail.includes('insufficient_quota')) {
        await wait(SARVAM_RETRY_MS, signal);
        upstream = await request();
        detail = '';
      }
    }
  } catch (error) {
    if (signal?.aborted) return { ok: false, status: 499, error: '' };
    return {
      ok: false,
      status: 502,
      error: `Could not reach Sarvam: ${(error as Error).message}`,
      failure: { provider: 'sarvam', kind: 'unreachable', detail: (error as Error).message },
    };
  }

  if (!upstream.ok) {
    if (!detail) detail = await upstream.text().catch(() => '');
    return {
      ok: false,
      status: 502,
      error: sarvamFailure(upstream.status, detail),
      // Sarvam reports an empty account as `insufficient_quota_error`, sometimes on a
      // 429, which the classifier reads as credit before it reads it as busy.
      failure: classifyHttp('sarvam', upstream.status, detail),
    };
  }

  try {
    // One base64 WAV per text sent, and this sends one.
    const body = (await upstream.json()) as { audios?: unknown };
    const audios = Array.isArray(body.audios)
      ? body.audios.filter((audio): audio is string => typeof audio === 'string')
      : [];
    if (audios.length === 0) throw new Error('there was no audio in the reply');
    const parts = audios.map((audio) =>
      pcmFromWav(Buffer.from(audio, 'base64'), AUDIO_SAMPLE_RATE),
    );
    // Copied into a buffer of its own, which is also what the response body wants.
    const pcm = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      pcm.set(part, offset);
      offset += part.length;
    }
    return { ok: true, audio: pcm };
  } catch (error) {
    if (signal?.aborted) return { ok: false, status: 499, error: '' };
    return {
      ok: false,
      status: 502,
      error: `Sarvam text to speech returned audio the player cannot use: ${(error as Error).message}`,
      failure: { provider: 'sarvam', kind: 'bad_output', detail: (error as Error).message },
    };
  }
}

/**
 * The headers every speaking route sends with its audio.
 *
 * The content type is how the browser tells MP3 from raw PCM, so an MP3 is labelled as
 * one and everything else stays the plain byte stream it always was.
 */
export function audioHeaders(
  cacheControl = 'no-store',
  format: 'pcm' | 'mp3' = 'pcm',
): HeadersInit {
  return {
    'Content-Type': format === 'mp3' ? 'audio/mpeg' : 'application/octet-stream',
    'Cache-Control': cacheControl,
    'X-Sample-Rate': String(AUDIO_SAMPLE_RATE),
    'X-Accel-Buffering': 'no',
  };
}

/**
 * A failed synthesis as a response, keeping a cancelled request silent.
 *
 * The trainee gets the standard message for the kind of failure, and the provider's own
 * words go to the developer log under the reference the message carries.
 */
export function synthesisFailure(
  result: Extract<Synthesis, { ok: false }>,
  context: FailureContext,
): Promise<Response> | Response {
  if (result.status === 499) return new Response(null, { status: 499 });
  const failure = result.failure ?? {
    provider: 'deepgram' as const,
    kind: 'other' as const,
    detail: result.error,
  };
  return failureResponse({ ...failure, detail: failure.detail || result.error }, context);
}
