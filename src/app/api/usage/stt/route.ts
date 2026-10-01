/**
 * POST /api/usage/stt
 *
 * Records live speech-to-text minutes, which the browser reports because the audio
 * goes from the browser straight to Deepgram and never passes through here.
 *
 * Until this existed, `sttSeconds` counted only the batch fallback. The live transport,
 * which is the one nearly every session uses, recorded nothing, so usage showed zero
 * speech-to-text however long people trained.
 *
 * The write is awaited rather than fired and forgotten. The browser does not wait on
 * the answer, but Vercel may freeze a function the moment it responds, and an unawaited
 * write can be frozen with it.
 */

import { checkUser } from '@/lib/auth/guard';
import { record } from '@/lib/usage/store';
import { streamedSeconds } from '@/lib/usage/streamed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function POST(request: Request) {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => null)) as { seconds?: unknown } | null;
  const seconds = streamedSeconds(body?.seconds);

  // Metering never fails a session. A report that cannot be written is lost, which is
  // an under-count, and the trainee is not told about it because there is nothing for
  // them to do.
  if (seconds > 0) {
    await record(gate.person.orgId, { sttSeconds: seconds }).catch(() => undefined);
  }

  return new Response(null, { status: 204 });
}
