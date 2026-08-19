/**
 * POST /api/tts
 *
 * Turns one chunk of the trainer's speech into audio using Deepgram Aura.
 *
 * The response is raw 16-bit PCM rather than MP3 on purpose. The client queues
 * these chunks through the Web Audio API, and raw PCM needs no decoding step, so
 * playback starts sooner and a barge-in can cut it off cleanly mid-sentence.
 */

import { AUDIO_SAMPLE_RATE, DEEPGRAM_TTS_MODEL, requireEnv } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Deepgram rejects very long single requests, and the client sentence-chunks anyway. */
const MAX_CHARS = 1800;

export async function POST(request: Request) {
  let apiKey: string;
  try {
    apiKey = requireEnv('DEEPGRAM_API_KEY');
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }

  let text: string;
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === 'string' ? body.text.trim() : '';
  } catch {
    return Response.json(
      { error: 'Request body must be JSON with a text field.' },
      { status: 400 },
    );
  }

  if (!text) {
    return Response.json({ error: 'text is required.' }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
  }

  const url = new URL('https://api.deepgram.com/v1/speak');
  url.searchParams.set('model', DEEPGRAM_TTS_MODEL());
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
      body: JSON.stringify({ text }),
      signal: request.signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (request.signal.aborted) {
      // The listener stopped the trainer mid-sentence. Nothing to report.
      return new Response(null, { status: 499 });
    }
    return Response.json(
      { error: `Could not reach Deepgram: ${(error as Error).message}` },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    const hint =
      upstream.status === 400
        ? ' Check that DEEPGRAM_TTS_MODEL names a valid Aura voice.'
        : upstream.status === 401 || upstream.status === 403
          ? ' Check that DEEPGRAM_API_KEY is correct.'
          : '';
    return Response.json(
      { error: `Deepgram text to speech failed (${upstream.status}).${hint} ${detail}`.trim() },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Sample-Rate': String(AUDIO_SAMPLE_RATE),
      'X-Accel-Buffering': 'no',
    },
  });
}
