/**
 * POST /api/invites
 *
 * Mints an invitation link. The token is returned exactly once, in this response,
 * and is never recoverable afterwards — only its hash is stored. If the person who
 * created it loses it, they issue another and revoke the first, which is the right
 * trade: a link that can be read back out of storage is a credential lying around.
 */

import { checkAdmin } from '@/lib/auth/guard';
import { listDecks } from '@/lib/decks/registry';
import {
  DEFAULT_INVITE_DAYS,
  expiryFrom,
  hashToken,
  inviteUrl,
  MAX_INVITE_USES,
  mintToken,
} from '@/lib/roster/invites';
import { rosterStore } from '@/lib/roster/registry';
import { RosterStoreError } from '@/lib/roster/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  email?: string | null;
  deckIds?: string[];
  days?: number;
  maxUses?: number;
}

export async function POST(request: Request) {
  const gate = await checkAdmin();
  if (!gate.ok) return gate.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const email = body.email?.trim() || null;
  if (email && !email.includes('@')) {
    return Response.json({ error: 'That does not look like an email address.' }, { status: 400 });
  }

  const wanted = Array.isArray(body.deckIds) ? body.deckIds : [];
  const decks = await listDecks();
  const publishable = new Set(
    decks.filter((deck) => deck.status === 'published').map((deck) => deck.id),
  );

  // A draft has not been checked by anybody. Attaching one to an invitation would be
  // a slower way of doing what assigning a draft already refuses.
  const bad = wanted.filter((id) => !publishable.has(id));
  if (bad.length > 0) {
    return Response.json(
      { error: `Only published decks can be attached to an invitation: ${bad.join(', ')}` },
      { status: 409 },
    );
  }

  // A personal invitation is single-use whatever was asked for: it names one person,
  // so a second use is somebody it was not issued to.
  const maxUses = email ? 1 : Math.min(Math.max(Math.round(body.maxUses ?? 1), 1), MAX_INVITE_USES);

  const token = mintToken();

  try {
    const invite = await rosterStore().createInvite({
      tokenHash: hashToken(token),
      email,
      deckIds: wanted,
      createdBy: gate.person.id,
      expiresAt: expiryFrom(new Date(), body.days ?? DEFAULT_INVITE_DAYS),
      maxUses,
    });

    // Built from the request rather than from configuration, so the link works on
    // whichever host this is actually being used from.
    const origin = new URL(request.url).origin;

    return Response.json({ invite, url: inviteUrl(origin, token) }, { status: 201 });
  } catch (error) {
    if (error instanceof RosterStoreError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
