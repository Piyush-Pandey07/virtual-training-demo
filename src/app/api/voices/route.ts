/**
 * GET /api/voices
 *
 * The voices a delegate may choose for the trainer, and which one to select first.
 *
 * The session screen takes its list from here and from nowhere else, so that which
 * provider the voices come from is decided on the server and can change, per
 * deployment or later per customer, without the screen knowing.
 */

import { checkUser } from '@/lib/auth/guard';
import { voiceCatalogue } from '@/lib/voice/catalogue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;

  return Response.json(voiceCatalogue(), {
    // The same for everybody and changes only with a release, but it is behind sign-in,
    // so private: a shared cache must not answer for a signed-out visitor.
    headers: { 'Cache-Control': 'private, max-age=300' },
  });
}
