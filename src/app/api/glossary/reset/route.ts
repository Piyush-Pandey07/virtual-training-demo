/**
 * POST /api/glossary/reset   puts the live glossary back to the imported file (AI-21)
 *
 * The administrator only; anybody else gets a 404. Every term an administrator added is
 * removed, every change is undone, and the holds are those of the imported file. The
 * body must say `{ "confirm": "reset" }`, so a stray request cannot do it by accident.
 */

import { checkUser } from '@/lib/auth/guard';
import { isAdministrator } from '@/lib/auth/permissions';
import { glossaryRefusal, readBody } from '@/lib/glossary/responses';
import { resetGlossary } from '@/lib/glossary/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** About three hundred writes, in batches. */
export const maxDuration = 60;

export async function POST(request: Request) {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;
  if (!isAdministrator(gate.person)) {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }

  const body = await readBody(request);
  if (body?.confirm !== 'reset') {
    return Response.json({ error: 'Confirm the reset by sending "reset".' }, { status: 400 });
  }

  try {
    const entries = await resetGlossary(gate.person);
    return Response.json({ entries });
  } catch (error) {
    const refused = glossaryRefusal(error);
    if (refused) return refused;
    throw error;
  }
}
