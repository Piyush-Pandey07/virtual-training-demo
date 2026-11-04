/**
 * POST /api/tts
 *
 * Turns one chunk of the trainer's speech into audio, in the voice the delegate chose.
 *
 * The response is raw 16-bit PCM unless the body asks for `format: 'mp3'`. Raw PCM
 * needs no decoding step, which is why it was the only format for a long time; the
 * session player now asks for MP3, about eight times smaller, because on a weak
 * connection the download, not the decoding, is what leaves the trainer silent between
 * sentences. Either way the browser ends up with a Web Audio buffer, so a barge-in still
 * cuts it off cleanly mid-sentence. The content type says which format came back.
 *
 * `voice` is optional. Without it this speaks in the deployment's default, exactly as
 * it did before there was a choice. A voice that is named but not offered is refused,
 * and so is Hindi sent to an English voice, which would otherwise play as nonsense.
 */

import { checkUser } from '@/lib/auth/guard';
import { rateLimited } from '@/lib/limits/rate';
import { canSpeak, voiceFor } from '@/lib/voice/catalogue';
import { audioHeaders, synthesise, synthesisFailure } from '@/lib/voice/synthesise';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** One sentence per call, so a second or two. Generous headroom for a cold start. */
export const maxDuration = 30;

export async function POST(request: Request) {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;

  let text: string;
  let requested: unknown;
  let compressed: boolean;
  try {
    const body = (await request.json()) as { text?: unknown; voice?: unknown; format?: unknown };
    text = typeof body.text === 'string' ? body.text.trim() : '';
    requested = body.voice;
    // The session player asks for MP3 to use less of a weak connection. Anything else
    // that calls this, and anything that does not ask, still gets raw PCM.
    compressed = body.format === 'mp3';
  } catch {
    return Response.json(
      { error: 'Request body must be JSON with a text field.' },
      { status: 400 },
    );
  }

  if (!text) {
    return Response.json({ error: 'text is required.' }, { status: 400 });
  }

  // After the body, because speech is billed by the character and the weight is how
  // long the text is: one unit per 320 characters, about one spoken sentence, so a
  // session's ordinary calls each count once and a paragraph sent in one go counts
  // as the sentences it is. Still before anything is billed.
  const weight = Math.max(1, Math.ceil(text.length / 320));
  const limited = await rateLimited(gate.person, 'speech', weight);
  if (limited) return limited;

  const voice = voiceFor(requested, gate.person);
  if (!voice) {
    return Response.json(
      { error: 'That voice is not one this deployment offers.' },
      { status: 400 },
    );
  }
  if (!canSpeak(voice, text)) {
    return Response.json(
      {
        error:
          'That voice speaks English only. Choose Hindi on the start screen for a Hindi session.',
      },
      { status: 400 },
    );
  }

  const result = await synthesise(text, voice, request.signal, { compressed });
  if (!result.ok) {
    return synthesisFailure(result, {
      route: '/api/tts',
      person: gate.person,
      language: voice.languageCode,
    });
  }

  return new Response(result.audio, { headers: audioHeaders('no-store', result.format) });
}
