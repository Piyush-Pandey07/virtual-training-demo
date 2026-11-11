/**
 * GET, PUT, DELETE /api/profile
 *
 * The signed-in person's own learner profile: read it, change it, or withdraw consent,
 * which deletes it.
 *
 * Only ever their own. The person comes from the session and never from the request, so
 * there is no id to send and no way to name somebody else's profile. The views a
 * facilitator or the administrator are allowed are a separate route, under the person
 * they are about, with their own rule: /api/people/{id}/profile.
 *
 * With PROFILES_ENABLED off every method answers 404, the same body any hidden route
 * gives, before anything else is looked at, including who is asking. Off is meant to
 * look exactly like a deployment where this route was never written. With it on for
 * Technavious only, everybody else gets the same 404.
 *
 * Changes are recorded in the audit history (AI-40). Reading one's own profile is not:
 * the history is of who looked at somebody else's.
 */

import { recordAudit } from '@/lib/audit/log';
import { checkUser } from '@/lib/auth/guard';
import { profilesEnabled, profilesEnabledFor } from '@/lib/config';
import { consentHistory, latestDecision, recordConsent } from '@/lib/profiles/consent';
import { notFound, reply, signedOut } from '@/lib/profiles/responses';
import { deleteProfile, findProfile, saveProfile } from '@/lib/profiles/store';
import { parseSubmission } from '@/lib/profiles/validate';
import { isRestricted, visibleTo } from '@/lib/retention/restricted';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A few small reads and writes. Nothing here waits on a model. */
export const maxDuration = 15;

export async function GET() {
  if (!profilesEnabled()) return notFound();
  const gate = await checkUser();
  if (!gate.ok) return signedOut(gate.response);
  if (!profilesEnabledFor(gate.person)) return notFound();

  const [profile, history] = await Promise.all([
    findProfile(gate.person),
    consentHistory(gate.person),
  ]);
  // A restricted profile (AI-41) is not shown to its owner either, only said to exist.
  // Saving the form again replaces it with a new one in use, as a first save would.
  return reply({
    profile: visibleTo(gate.person, profile) ?? null,
    restricted: isRestricted(profile),
    consent: latestDecision(history) ?? null,
  });
}

/**
 * Saves the profile and records agreement to the notice with it. Every save asks for the
 * box to be ticked again, so every stored profile records agreement to the notice that
 * was on screen when it was last changed.
 */
export async function PUT(request: Request) {
  if (!profilesEnabled()) return notFound();
  const gate = await checkUser();
  if (!gate.ok) return signedOut(gate.response);
  if (!profilesEnabledFor(gate.person)) return notFound();

  const parsed = parseSubmission(await request.json().catch(() => null), {
    profileRequired: true,
  });
  if (!parsed.ok) return reply({ error: parsed.error }, 400);

  const before = await findProfile(gate.person);
  const profile = await saveProfile(gate.person, parsed.value.details ?? {});
  const consent = await recordConsent(gate.person, 'given', true);
  await recordAudit(gate.person, {
    action: before ? 'updated' : 'created',
    subjectType: 'profile',
    subjectId: gate.person.id,
    detail: `${before ? 'Changed' : 'Gave'} their own profile, agreeing to notice ${consent.noticeVersion}`,
  });
  return reply({ profile });
}

/**
 * Withdraws consent (AI-27). The profile is deleted at once, including a copy their
 * organisation uploaded, and the withdrawal is recorded. Their training carries on: the
 * agreement that let them attend stands, and the trainer simply has no profile to read.
 */
export async function DELETE() {
  if (!profilesEnabled()) return notFound();
  const gate = await checkUser();
  if (!gate.ok) return signedOut(gate.response);
  if (!profilesEnabledFor(gate.person)) return notFound();

  await deleteProfile(gate.person);
  await recordConsent(gate.person, 'withdrawn', false);
  await recordAudit(gate.person, {
    action: 'withdrawn',
    subjectType: 'profile',
    subjectId: gate.person.id,
    detail: 'Withdrew consent, which deleted their profile',
  });
  return reply({ ok: true });
}
