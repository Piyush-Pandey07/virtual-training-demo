/**
 * POST /api/stt
 *
 * Transcribes one complete utterance. The body is raw 16-bit little-endian PCM
 * at the capture sample rate, exactly as the microphone worklet produces it.
 *
 * This is the fallback transport for speech to text, used when the Deepgram key
 * cannot mint short-lived browser tokens. The browser detects the end of an
 * utterance locally and posts the buffered audio here, so the account key stays
 * on the server. See /api/deepgram/token for the streaming route, which is
 * preferred when available because it also gives live partial transcripts.
 */

import { CAPTURE_SAMPLE_RATE, DEEPGRAM_STT_MODEL, requireEnv } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Two minutes of 16 kHz mono PCM. Far longer than any single spoken question. */
const MAX_BYTES = CAPTURE_SAMPLE_RATE * 2 * 120;

/** Below roughly 200 ms there is nothing worth sending. */
const MIN_BYTES = CAPTURE_SAMPLE_RATE * 2 * 0.2;

interface DeepgramListenResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: string; confidence?: number }>;
    }>;
  };
}

export async function POST(request: Request) {
  let apiKey: string;
  try {
    apiKey = requireEnv('DEEPGRAM_API_KEY');
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }

  const audio = await request.arrayBuffer().catch(() => null);
  if (!audio) {
    return Response.json({ error: 'Expected a raw PCM body.' }, { status: 400 });
  }
  if (audio.byteLength > MAX_BYTES) {
    return Response.json({ error: 'Utterance too long.' }, { status: 413 });
  }
  // Too short to be speech. Answer normally with an empty transcript so the
  // client can simply carry on listening.
  if (audio.byteLength < MIN_BYTES) {
    return Response.json({ transcript: '', confidence: 0 });
  }

  const url = new URL('https://api.deepgram.com/v1/listen');
  url.searchParams.set('model', DEEPGRAM_STT_MODEL());
  url.searchParams.set('smart_format', 'true');
  url.searchParams.set('punctuate', 'true');
  url.searchParams.set('language', 'en');
  // Raw audio, so Deepgram needs to be told the format explicitly.
  url.searchParams.set('encoding', 'linear16');
  url.searchParams.set('sample_rate', String(CAPTURE_SAMPLE_RATE));
  url.searchParams.set('channels', '1');

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/octet-stream',
      },
      body: audio,
      signal: request.signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return Response.json(
      { error: `Could not reach Deepgram: ${(error as Error).message}` },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    const hint =
      upstream.status === 401 || upstream.status === 403
        ? ' Check that DEEPGRAM_API_KEY is correct.'
        : '';
    return Response.json(
      { error: `Deepgram transcription failed (${upstream.status}).${hint} ${detail}`.trim() },
      { status: 502 },
    );
  }

  const body = (await upstream.json()) as DeepgramListenResponse;
  const alternative = body.results?.channels?.[0]?.alternatives?.[0];

  return Response.json(
    {
      transcript: alternative?.transcript?.trim() ?? '',
      confidence: alternative?.confidence ?? 0,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
