/**
 * DELETE /api/invites/{id}
 *
 * Withdraws an invitation. The link stops working immediately, which is the only
 * defence available once a link has been sent somewhere it should not have gone.
 */

import { checkAdmin } from '@/lib/auth/guard';
import { rosterStore } from '@/lib/roster/registry';
import { RosterStoreError } from '@/lib/roster/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await checkAdmin();
  if (!gate.ok) return gate.response;

  try {
    const { id } = await params;
    await rosterStore().revokeInvite(id);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof RosterStoreError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
