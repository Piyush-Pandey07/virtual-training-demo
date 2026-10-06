/**
 * GET /api/voices/sample?voice=<id>
 *
 * A few seconds of one voice, so a delegate can hear it before choosing.
 *
 * The words are fixed here rather than sent by the browser. That keeps this from being
 * a second way to synthesise anything at all, and means every delegate hears the same
 * line from each voice, which is what makes the voices comparable. A Hindi voice says
 * the Hindi line.
 *
 * Synthesised by the same function as the trainer's real speech, so a sample sounds
 * exactly like the session will, and moving provider moves the samples with it.
 */

import { checkUser } from '@/lib/auth/guard';
import { sampleTextFor, voiceFor } from '@/lib/voice/catalogue';
import { audioHeaders, synthesise, synthesisFailure } from '@/lib/voice/synthesise';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: Request) {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;

  // Required here, unlike /api/tts: a sample of no voice in particular means nothing.
  const requested = new URL(request.url).searchParams.get('voice');
  const voice = requested ? voiceFor(requested) : null;
  if (!voice) {
    return Response.json({ error: 'Name a voice this deployment offers.' }, { status: 400 });
  }

  const result = await synthesise(sampleTextFor(voice), voice, request.signal);
  if (!result.ok) return synthesisFailure(result);

  // The same few seconds for every delegate, so a replay need not pay for synthesis
  // again. Private, because the route is behind sign-in.
  return new Response(result.audio, { headers: audioHeaders('private, max-age=86400') });
}
