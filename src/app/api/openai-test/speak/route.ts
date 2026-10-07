/**
 * POST /api/openai-test/speak
 *
 * One test sentence in one of OpenAI's voices, for the OpenAI test page. Technavious
 * staff only: anybody else gets the same 404 as any other administrator's tool, before
 * the body is read.
 *
 * Returns raw PCM under the same headers as the session's own speech, so the page plays
 * it exactly the way a session would.
 */

import { checkUser } from '@/lib/auth/guard';
import { mayUseOpenAiTest } from '@/lib/openai-test/access';
import { speakWithOpenAi } from '@/lib/openai-test/providers';
import { parseSpeakRequest } from '@/lib/openai-test/samples';
import { audioHeaders } from '@/lib/voice/synthesise';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;
  if (!mayUseOpenAiTest(gate.person)) {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }

  const parsed = parseSpeakRequest(await request.json().catch(() => null));
  if (typeof parsed === 'string') return Response.json({ error: parsed }, { status: 400 });

  const result = await speakWithOpenAi(parsed, request.signal);
  if (!result.ok) {
    if (result.status === 499) return new Response(null, { status: 499 });
    return Response.json({ error: result.error }, { status: result.status });
  }
  return new Response(result.audio, { headers: audioHeaders() });
}
