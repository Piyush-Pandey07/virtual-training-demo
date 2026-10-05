/**
 * EXPERIMENTAL -- OpenAI voice trial.
 *
 * POST /api/experimental/openai-voice/transcribe
 *   multipart: audio (the browser's recording), model, hint ('1' to send the training
 *   vocabulary)  ->  { text, model, upstreamMs }
 *
 * One model per request. The page sends the same recording to each model it is
 * comparing, in parallel, so each comes back with its own timing.
 *
 * Signed-in users only, because the key behind it is billed. See
 * src/experimental/openai-voice/README.md.
 */

import { MAX_UPLOAD_BYTES } from '@/experimental/openai-voice/catalogue';
import { transcribe } from '@/experimental/openai-voice/openai';
import { parseTranscribeRequest } from '@/experimental/openai-voice/validate';
import { checkUser } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request) {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;

  // Refused before the body is read, rather than after buffering all of it.
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return Response.json(
      { error: 'That recording is too long. Keep it under thirty seconds.' },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Send the recording as multipart form data.' }, { status: 400 });
  }

  const audio = form.get('audio');
  if (!(audio instanceof Blob)) {
    return Response.json({ error: 'The recording is missing.' }, { status: 400 });
  }

  const parsed = parseTranscribeRequest({
    model: form.get('model'),
    hint: form.get('hint'),
    audioType: audio.type,
    audioSize: audio.size,
  });
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const result = await transcribe(parsed.value, audio, request.signal);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  return Response.json({
    text: result.text,
    model: parsed.value.model.id,
    upstreamMs: result.upstreamMs,
  });
}
