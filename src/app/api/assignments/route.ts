/**
 * POST, DELETE /api/assignments
 *
 * Who has been asked to attend what. This is the gate: a trainee can open a session
 * only for a deck they have a row here for, checked in the session page and again in
 * `/api/chat`, because the chat route narrates whatever deck id its body names.
 */

import { requireAdmin, unauthorisedResponse } from '@/lib/auth/guard';
import { loadStoredDeck } from '@/lib/decks/registry';
import { rosterStore } from '@/lib/roster/registry';
import { RosterStoreError } from '@/lib/roster/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  personId?: string;
  deckId?: string;
  dueAt?: string | null;
}

async function readBody(request: Request): Promise<Body | null> {
  try {
    return (await request.json()) as Body;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();

    const body = await readBody(request);
    if (!body) return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });

    const { personId, deckId } = body;
    if (!personId || !deckId) {
      return Response.json({ error: 'personId and deckId are required.' }, { status: 400 });
    }

    const store = rosterStore(admin.orgId);
    const [person, stored] = await Promise.all([
      store.getPerson(personId),
      loadStoredDeck(admin.orgId, deckId).catch(() => undefined),
    ]);

    if (!person) return Response.json({ error: 'No such person.' }, { status: 404 });
    if (!stored) return Response.json({ error: 'No such deck.' }, { status: 404 });

    // A draft has not been checked by anybody. Assigning one would put unreviewed,
    // model-generated material in front of a trainee as though it were approved,
    // which is the single thing the review step exists to prevent.
    if (stored.status !== 'published') {
      return Response.json(
        { error: 'This deck is still a draft. Publish it before assigning it to anyone.' },
        { status: 409 },
      );
    }

    const dueAt = typeof body.dueAt === 'string' && body.dueAt.trim() ? body.dueAt : null;

    return Response.json(await store.assign({ personId, deckId, assignedBy: admin.id, dueAt }), {
      status: 201,
    });
  } catch (error) {
    const refused = unauthorisedResponse(error);
    if (refused) return refused;
    if (error instanceof RosterStoreError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin();

    const body = await readBody(request);
    if (!body?.personId || !body.deckId) {
      return Response.json({ error: 'personId and deckId are required.' }, { status: 400 });
    }

    // The attempt is deliberately left alone. Somebody who did the training and then
    // had it unassigned still did the training.
    await rosterStore(admin.orgId).unassign(body.personId, body.deckId);
    return Response.json({ ok: true });
  } catch (error) {
    const refused = unauthorisedResponse(error);
    if (refused) return refused;
    if (error instanceof RosterStoreError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
