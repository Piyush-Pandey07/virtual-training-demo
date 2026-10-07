/**
 * POST /api/openai-test/transcribe
 *
 * One recording, transcribed by OpenAI and by Deepgram at the same time, so the two can
 * be read side by side with how long each took. Technavious staff only, refused before
 * the upload is read.
 *
 * The body is a form with the recording as `audio` and the expected language as
 * `language` (`en`, `hi`, `id`, or anything else for "work it out").
 */

import { checkUser } from '@/lib/auth/guard';
import { mayUseOpenAiTest } from '@/lib/openai-test/access';
import { transcribeWithDeepgram, transcribeWithOpenAi } from '@/lib/openai-test/providers';
import { listeningChoice, MAX_RECORDING_BYTES } from '@/lib/openai-test/samples';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;
  if (!mayUseOpenAiTest(gate.person)) {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  const audio = form?.get('audio');
  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json({ error: 'Record something first.' }, { status: 400 });
  }
  if (audio.size > MAX_RECORDING_BYTES) {
    return Response.json(
      { error: 'That recording is too long. Keep it under 30 seconds.' },
      { status: 413 },
    );
  }

  const choice = listeningChoice(form?.get('language'));
  const [openai, deepgram] = await Promise.all([
    transcribeWithOpenAi(audio, choice, request.signal),
    transcribeWithDeepgram(audio, choice, request.signal),
  ]);

  return Response.json({ openai, deepgram }, { headers: { 'Cache-Control': 'no-store' } });
}
