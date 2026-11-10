/**
 * POST /api/glossary   adds a term to the live glossary (AI-21)
 *
 * The administrator only, which is Technavious. Anybody else gets a 404, as for every
 * administrator's tool they have no use for. The entry is checked by the same rules the
 * form ran, in `glossary/validate.ts`, and the store refuses a term or an acronym the
 * glossary already has, so a term keeps one definition.
 */

import { checkUser } from '@/lib/auth/guard';
import { isAdministrator } from '@/lib/auth/permissions';
import { glossaryRefusal, readBody } from '@/lib/glossary/responses';
import { addGlossaryEntry } from '@/lib/glossary/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A read of the glossary and one write. */
export const maxDuration = 15;

export async function POST(request: Request) {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;
  if (!isAdministrator(gate.person)) {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }

  const body = await readBody(request);
  if (!body) return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });

  try {
    const entry = await addGlossaryEntry(gate.person, body.entry);
    return Response.json({ entry }, { status: 201 });
  } catch (error) {
    const refused = glossaryRefusal(error);
    if (refused) return refused;
    throw error;
  }
}
