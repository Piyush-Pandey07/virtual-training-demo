/**
 * GET, PUT, DELETE /api/profile
 *
 * The signed-in person's own learner profile: read it, change it, or delete it.
 *
 * Only ever their own. The person comes from the session and never from the request,
 * so there is no id to send and no way to name somebody else's profile. Administrators
 * and Technavious staff get nothing more than anybody else does here, which is their
 * own profile: who else may ever see one is an open decision, so nothing is built for it.
 *
 * With PROFILES_ENABLED off every method answers 404, the same body any hidden route
 * gives, before anything else is looked at, including who is asking. Off is meant to
 * look exactly like a deployment where this route was never written.
 */

import { checkUser } from '@/lib/auth/guard';
import { profilesEnabled } from '@/lib/config';
import { deleteProfile, getProfile, saveProfile } from '@/lib/profiles/store';
import { parseProfileChange, ProfileTooLarge } from '@/lib/profiles/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** One small read or write. Nothing here waits on a model. */
export const maxDuration = 15;

/**
 * Personal data, so nothing between here and the browser may keep a copy. Built per
 * call: a Response shared between requests can only be read once.
 */
function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function notFound(): Response {
  return Response.json({ error: 'Not found.' }, { status: 404 });
}

export async function GET() {
  if (!profilesEnabled()) return notFound();
  const gate = await checkUser();
  if (!gate.ok) return gate.response;

  const profile = await getProfile(gate.person);
  return reply({ profile: profile ?? null });
}

export async function PUT(request: Request) {
  if (!profilesEnabled()) return notFound();
  const gate = await checkUser();
  if (!gate.ok) return gate.response;

  const parsed = parseProfileChange(await request.json().catch(() => null));
  if (!parsed.ok) return reply({ error: parsed.error }, 400);

  try {
    const profile = await saveProfile(gate.person, parsed.change);
    return reply({ profile });
  } catch (error) {
    if (error instanceof ProfileTooLarge) return reply({ error: error.message }, 400);
    throw error;
  }
}

export async function DELETE() {
  if (!profilesEnabled()) return notFound();
  const gate = await checkUser();
  if (!gate.ok) return gate.response;

  await deleteProfile(gate.person);
  return reply({ ok: true });
}
