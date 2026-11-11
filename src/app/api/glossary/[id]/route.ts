/**
 * PATCH  /api/glossary/{id}   changes an entry, or holds or releases it (AI-21)
 * DELETE /api/glossary/{id}   deletes it
 *
 * The administrator only; anybody else gets a 404. PATCH says what it is doing:
 *
 *   { "action": "edit", "entry": { term, acronym, expansion, aliases, definition, section } }
 *   { "action": "hold", "reason": "..." }      held entries are not given to the trainer
 *   { "action": "release", "reason": "..." }
 *
 * A hold and a release each need a reason, kept on the entry, so whoever looks next can
 * see why a definition is or is not in use.
 */

import { checkUser } from '@/lib/auth/guard';
import { isAdministrator } from '@/lib/auth/permissions';
import { glossaryRefusal, readBody } from '@/lib/glossary/responses';
import {
  deleteGlossaryEntry,
  editGlossaryEntry,
  holdGlossaryEntry,
  releaseGlossaryEntry,
} from '@/lib/glossary/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const notFound = () => Response.json({ error: 'Not found.' }, { status: 404 });

/** An entry id as `idFor` makes them, or as the imported file has them. Nothing else. */
function usableId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(id);
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;
  if (!isAdministrator(gate.person)) return notFound();

  const { id } = await params;
  if (!usableId(id)) return notFound();
  const body = await readBody(request);
  if (!body) return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });

  try {
    switch (body.action) {
      case 'edit':
        return Response.json({ entry: await editGlossaryEntry(gate.person, id, body.entry) });
      case 'hold':
        return Response.json({ entry: await holdGlossaryEntry(gate.person, id, body.reason) });
      case 'release':
        return Response.json({ entry: await releaseGlossaryEntry(gate.person, id, body.reason) });
      default:
        return Response.json(
          { error: 'action must be "edit", "hold" or "release".' },
          { status: 400 },
        );
    }
  } catch (error) {
    const refused = glossaryRefusal(error);
    if (refused) return refused;
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;
  if (!isAdministrator(gate.person)) return notFound();

  const { id } = await params;
  if (!usableId(id)) return notFound();

  try {
    await deleteGlossaryEntry(gate.person, id);
    return Response.json({ ok: true });
  } catch (error) {
    const refused = glossaryRefusal(error);
    if (refused) return refused;
    throw error;
  }
}
