/**
 * POST /api/consent
 *
 * Agreeing to the privacy notice at sign-in (BRD v2.3, AI-27).
 *
 * A participant agrees with their profile, which must have every required field: that is
 * what attending needs. An administrator or a facilitator agrees to the notice alone,
 * and may add a profile from My profile if they attend training too. Either way the
 * agreement is recorded with the notice version and the moment, and the pages stop
 * sending them to the consent page.
 *
 * The person is the signed-in one, never one named in the body. Guarded with `checkUser`
 * rather than anything that asks for consent first, since asking for consent is what this
 * is for.
 */

import { checkUser } from '@/lib/auth/guard';
import { profilesEnabled, profilesEnabledFor } from '@/lib/config';
import { recordConsent } from '@/lib/profiles/consent';
import { notFound, reply, signedOut } from '@/lib/profiles/responses';
import { saveProfile } from '@/lib/profiles/store';
import { parseSubmission } from '@/lib/profiles/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function POST(request: Request) {
  if (!profilesEnabled()) return notFound();
  const gate = await checkUser();
  if (!gate.ok) return signedOut(gate.response);
  const person = gate.person;
  if (!profilesEnabledFor(person)) return notFound();

  const parsed = parseSubmission(await request.json().catch(() => null), {
    profileRequired: person.role === 'trainee',
  });
  if (!parsed.ok) return reply({ error: parsed.error }, 400);

  // The profile first, so a failure to save it leaves no record of an agreement that
  // came with a profile we do not have.
  const { details } = parsed.value;
  if (details) await saveProfile(person, details);
  await recordConsent(person, 'given', details !== null);
  return reply({ ok: true });
}
