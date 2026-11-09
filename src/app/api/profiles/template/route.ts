/**
 * GET /api/profiles/template
 *
 * The CSV template for the bulk participant upload (BRD v2.3, AI-28): an email column and
 * one column for each profile field, header row only.
 *
 * For the administrator, a company administrator and a facilitator, and a 404 for
 * anybody else, as for anybody PROFILES_ENABLED leaves out.
 */

import { checkUser } from '@/lib/auth/guard';
import { profilesEnabled, profilesEnabledFor, profilesEnabledInOrg } from '@/lib/config';
import { mayUploadParticipants } from '@/lib/profiles/access';
import { templateCsv } from '@/lib/profiles/csv';
import { notFound, signedOut } from '@/lib/profiles/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!profilesEnabled()) return notFound();
  const gate = await checkUser();
  if (!gate.ok) return signedOut(gate.response);
  const person = gate.person;
  if (
    !profilesEnabledFor(person) ||
    !profilesEnabledInOrg(person.orgId) ||
    !mayUploadParticipants(person)
  ) {
    return notFound();
  }

  return new Response(templateCsv(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="participants-template.csv"',
      'Cache-Control': 'private, no-store',
    },
  });
}
