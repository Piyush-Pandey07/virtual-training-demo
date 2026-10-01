/**
 * POST /api/tts
 *
 * Turns one chunk of the trainer's speech into audio, in the voice the delegate chose.
 *
 * The response is raw 16-bit PCM rather than MP3 on purpose. The client queues
 * these chunks through the Web Audio API, and raw PCM needs no decoding step, so
 * playback starts sooner and a barge-in can cut it off cleanly mid-sentence.
 *
 * `voice` is optional. Without it this speaks in the deployment's default, exactly as
 * it did before there was a choice. A voice that is named but not offered is refused.
 */

import { checkUser } from '@/lib/auth/guard';
import { voiceModelFor } from '@/lib/voice/catalogue';
import { audioHeaders, synthesise, synthesisFailure } from '@/lib/voice/synthesise';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** One sentence per call, so a second or two. Generous headroom for a cold start. */
export const maxDuration = 30;

export async function POST(request: Request) {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;

  let text: string;
  let voice: unknown;
  try {
    const body = (await request.json()) as { text?: unknown; voice?: unknown };
    text = typeof body.text === 'string' ? body.text.trim() : '';
    voice = body.voice;
  } catch {
    return Response.json(
      { error: 'Request body must be JSON with a text field.' },
      { status: 400 },
    );
  }

  if (!text) {
    return Response.json({ error: 'text is required.' }, { status: 400 });
  }

  const model = voiceModelFor(voice);
  if (!model) {
    return Response.json({ error: 'That voice is not one this deployment offers.' }, { status: 400 });
  }

  const result = await synthesise(text, model, request.signal);
  if (!result.ok) return synthesisFailure(result);

  return new Response(result.audio, { headers: audioHeaders() });
}
