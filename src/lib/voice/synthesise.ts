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
import type { SpokenVoice } from './catalogue';
import { pcmFromWav } from './wav';

/**
 * Deepgram rejects very long single requests, and the client sentence-chunks anyway.
 * Sarvam's own ceiling, 2,500 characters, is higher still.
 */
export const MAX_SYNTHESIS_CHARS = 1800;

export type Synthesis =
  | { ok: true; audio: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer> }
  | { ok: false; status: number; error: string };

export function synthesise(
  text: string,
  voice: SpokenVoice,
  signal?: AbortSignal,
): Promise<Synthesis> {
  return voice.provider === 'sarvam'
    ? sarvam(text, voice, signal)
    : deepgram(text, voice.model, signal);
}

async function deepgram(text: string, model: string, signal?: AbortSignal): Promise<Synthesis> {
  let apiKey: string;
  try {
    apiKey = requireEnv('DEEPGRAM_API_KEY');
  } catch (error) {
    return { ok: false, status: 500, error: (error as Error).message };
  }

  const url = new URL('https://api.deepgram.com/v1/speak');
  url.searchParams.set('model', model);
  url.searchParams.set('encoding', 'linear16');
  url.searchParams.set('sample_rate', String(AUDIO_SAMPLE_RATE));
  // No container, so the body is a bare PCM stream with no WAV header to skip.
  url.searchParams.set('container', 'none');

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
    };
  }

  return { ok: true, audio: upstream.body };
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

  if (code === 'insufficient_quota_error' || status === 402) {
    return 'Hindi speech has stopped because the Sarvam credit has run out. Add credit at dashboard.sarvam.ai, or start an English session.';
  }
  if (
    code === 'invalid_api_key_error' ||
    code === 'authentication_error' ||
    status === 401 ||
    status === 403
  ) {
    return 'Sarvam refused the key, so Hindi cannot be spoken. Check that SARVAM_API_KEY is correct.';
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
    return { ok: false, status: 500, error: (error as Error).message };
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
    return { ok: false, status: 502, error: `Could not reach Sarvam: ${(error as Error).message}` };
  }

  if (!upstream.ok) {
    if (!detail) detail = await upstream.text().catch(() => '');
    return { ok: false, status: 502, error: sarvamFailure(upstream.status, detail) };
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
    };
  }
}

/** The headers every speaking route sends with its audio. */
export function audioHeaders(cacheControl = 'no-store'): HeadersInit {
  return {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': cacheControl,
    'X-Sample-Rate': String(AUDIO_SAMPLE_RATE),
    'X-Accel-Buffering': 'no',
  };
}

/** A failed synthesis as a response, keeping a cancelled request silent. */
export function synthesisFailure(result: Extract<Synthesis, { ok: false }>): Response {
  if (result.status === 499) return new Response(null, { status: 499 });
  return Response.json({ error: result.error }, { status: result.status });
}
