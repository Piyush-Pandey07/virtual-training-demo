/**
 * GET /api/people/{id}/profile
 *
 * One person's learner profile, read-only, for the people allowed to see it (BRD v2.3,
 * AI-06): the participant themselves, the facilitator of a session or batch they are in,
 * and the administrator. A company administrator and other participants get a 404, the
 * same as for somebody who does not exist, so the answer confirms nothing.
 *
 * With PROFILES_ENABLED off, or off for the viewer or their organisation, a 404 too.
 */

import { checkUser } from '@/lib/auth/guard';
import { profilesEnabled, profilesEnabledFor, profilesEnabledInOrg } from '@/lib/config';
import { notFound, reply, signedOut } from '@/lib/profiles/responses';
import { viewProfile } from '@/lib/profiles/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  if (!profilesEnabled()) return notFound();
  const gate = await checkUser();
  if (!gate.ok) return signedOut(gate.response);
  const viewer = gate.person;
  if (!profilesEnabledFor(viewer) || !profilesEnabledInOrg(viewer.orgId)) return notFound();

  const { id } = await params;
  const view = await viewProfile(viewer, id);
  if (!view) return notFound();
  return reply(view);
}
