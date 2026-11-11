/**
 * PUT    /api/decks/{id}/questions/{kind}   saves a bank from a CSV
 * PATCH  /api/decks/{id}/questions/{kind}   changes the pre-session level bands
 * DELETE /api/decks/{id}/questions/{kind}   removes a bank
 *
 * The Benchmark administrator only (BRD v2.3). Not a company administrator, and not a
 * facilitator, who get a 404 as for any administrator's tool they do not need to know of.
 *
 * The CSV is sent as text and parsed here with the same parser the screen used for its
 * preview, so what is saved is exactly what was previewed, and a file with any bad row
 * is refused whole with every problem listed.
 */

import { checkUser } from '@/lib/auth/guard';
import { mayManageBanks } from '@/lib/assessments/access';
import { bankFromCsv } from '@/lib/assessments/csv';
import { refusalResponse } from '@/lib/assessments/responses';
import { checkBands } from '@/lib/assessments/scoring';
import { removeBank, saveBank, setLevelBands } from '@/lib/assessments/service';
import { isBankKind, type BankKind } from '@/lib/assessments/types';
import { loadStoredDeck } from '@/lib/decks/registry';
import type { SignedInPerson } from '@/lib/roster/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/** Long enough for fifty long questions with six long options each, and no more. */
const MAX_CSV_LENGTH = 200_000;

interface RouteContext {
  params: Promise<{ id: string; kind: string }>;
}

type Resolved =
  | { ok: true; person: SignedInPerson; deckId: string; kind: BankKind }
  | { ok: false; response: Response };

/** Who is asking, and whether the deck and kind exist, before anything is read or changed. */
async function resolve(params: RouteContext['params']): Promise<Resolved> {
  const gate = await checkUser();
  if (!gate.ok) return gate;
  if (!mayManageBanks(gate.person)) {
    return { ok: false, response: Response.json({ error: 'Not found.' }, { status: 404 }) };
  }

  const { id, kind } = await params;
  if (!isBankKind(kind)) {
    return { ok: false, response: Response.json({ error: 'Not found.' }, { status: 404 }) };
  }
  const deck = await loadStoredDeck(gate.person.orgId, id).catch(() => undefined);
  if (!deck) {
    return { ok: false, response: Response.json({ error: 'No such deck.' }, { status: 404 }) };
  }
  return { ok: true, person: gate.person, deckId: id, kind };
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  const resolved = await resolve(params);
  if (!resolved.ok) return resolved.response;

  const body = await readJson(request);
  const csv = body?.csv;
  if (typeof csv !== 'string' || !csv.trim()) {
    return Response.json({ error: 'Choose a CSV file with the questions in it.' }, { status: 400 });
  }
  if (csv.length > MAX_CSV_LENGTH) {
    return Response.json(
      { error: 'That file is too large to be a question bank.' },
      { status: 413 },
    );
  }

  const parsed = bankFromCsv(csv);
  if (!parsed.ok) {
    return Response.json(
      { error: 'The file has problems, so nothing was saved.', problems: parsed.problems },
      { status: 422 },
    );
  }

  try {
    const bank = await saveBank(
      resolved.person,
      resolved.deckId,
      resolved.kind,
      parsed.questions,
      'upload',
    );
    return Response.json({ questions: bank.questions.length, savedAt: bank.savedAt });
  } catch (error) {
    const refused = refusalResponse(error);
    if (refused) return refused;
    throw error;
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const resolved = await resolve(params);
  if (!resolved.ok) return resolved.response;
  if (resolved.kind !== 'pre') {
    return Response.json(
      { error: 'Only the pre-session assessment has level bands.' },
      { status: 400 },
    );
  }

  const body = await readJson(request);
  const checked = checkBands(body?.bands);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });

  try {
    const bank = await setLevelBands(resolved.person, resolved.deckId, checked.bands);
    return Response.json({ bands: bank.bands });
  } catch (error) {
    const refused = refusalResponse(error);
    if (refused) return refused;
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const resolved = await resolve(params);
  if (!resolved.ok) return resolved.response;

  try {
    await removeBank(resolved.person, resolved.deckId, resolved.kind);
    return Response.json({ ok: true });
  } catch (error) {
    const refused = refusalResponse(error);
    if (refused) return refused;
    throw error;
  }
}
