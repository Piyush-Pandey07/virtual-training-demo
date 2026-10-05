/**
 * EXPERIMENTAL -- OpenAI voice trial.
 *
 * POST /api/experimental/openai-voice/speech
 *   { text, voice, model, style? }  ->  raw 16-bit mono PCM, sample rate in X-Sample-Rate
 *
 * Signed-in users only, because the key behind it is billed. Unlike the app's own
 * /api/voices/sample this takes the words from the browser, so testers can try their
 * own; `parseSpeechRequest` caps the length. See src/experimental/openai-voice/README.md.
 */

import { speak } from '@/experimental/openai-voice/openai';
import { parseSpeechRequest } from '@/experimental/openai-voice/validate';
import { checkUser } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request) {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const parsed = parseSpeechRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const result = await speak(parsed.value, request.signal);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  return new Response(result.audio, {
    headers: {
      'Content-Type': 'audio/pcm',
      'X-Sample-Rate': String(result.sampleRate),
      'Cache-Control': 'no-store',
    },
  });
}
