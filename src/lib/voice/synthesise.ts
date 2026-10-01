/**
 * Text to speech, for whichever provider serves the voice.
 *
 * One function, used by every route that speaks, so that adding a provider is a change
 * here rather than in each route. Today that is Deepgram Aura.
 *
 * Returns raw 16-bit mono PCM at AUDIO_SAMPLE_RATE, with no container. The browser
 * builds Web Audio buffers straight from those samples, which is what lets playback
 * start without a decoding step and a barge-in cut off cleanly mid-word. Any provider
 * added here has to return exactly that, converting if it must.
 */

import 'server-only';

import { AUDIO_SAMPLE_RATE, requireEnv } from '../config';

/** Deepgram rejects very long single requests, and the client sentence-chunks anyway. */
export const MAX_SYNTHESIS_CHARS = 1800;

export type Synthesis =
  | { ok: true; audio: ReadableStream<Uint8Array> }
  | { ok: false; status: number; error: string };

export async function synthesise(
  text: string,
  model: string,
  signal?: AbortSignal,
): Promise<Synthesis> {
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
    return { ok: false, status: 502, error: `Could not reach Deepgram: ${(error as Error).message}` };
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
