/**
 * POST /api/decks/{id}/questions/{kind}/sample
 *
 * Generates a sample bank of about ten questions from the deck, with Gemini, so the
 * assessments can be tried before the user team's own banks arrive. Saved as a sample
 * and labelled "Sample, not reviewed" everywhere it appears.
 *
 * The Benchmark administrator only, rate limited because it costs a model call over the
 * whole deck, and refused before spending anything when the deck already has an uploaded
 * bank, which a sample must never replace.
 */

import { checkUser } from '@/lib/auth/guard';
import { mayManageBanks } from '@/lib/assessments/access';
import { refusalResponse } from '@/lib/assessments/responses';
import { generateSampleQuestions, SampleUnusable } from '@/lib/assessments/sample';
import { bankForAdministrator, saveBank } from '@/lib/assessments/service';
import { isBankKind } from '@/lib/assessments/types';
import { loadDeck } from '@/lib/decks/registry';
import { classifyThrown, type ProviderFailure } from '@/lib/failures/classify';
import { failureResponse } from '@/lib/failures/respond';
import { rateLimited } from '@/lib/limits/rate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** One model call over the whole deck. The Hobby ceiling is 60. */
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string; kind: string }>;
}

export async function POST(_request: Request, { params }: RouteContext) {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;
  if (!mayManageBanks(gate.person)) {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }

  const limited = await rateLimited(gate.person, 'questionSample');
  if (limited) return limited;

  const { id, kind } = await params;
  if (!isBankKind(kind)) return Response.json({ error: 'Not found.' }, { status: 404 });

  const deck = await loadDeck(gate.person.orgId, id).catch(() => undefined);
  if (!deck) return Response.json({ error: 'No such deck.' }, { status: 404 });

  const existing = await bankForAdministrator(gate.person, id, kind);
  if (existing?.source === 'upload') {
    return Response.json(
      {
        error:
          'This deck already has an uploaded bank. Remove it first if you really want a sample in its place.',
      },
      { status: 409 },
    );
  }

  let questions;
  try {
    questions = await generateSampleQuestions(deck, kind);
  } catch (error) {
    // The administrator gets the standard message and a reference; what the model said
    // goes to the developer log, as for every other provider failure.
    const failure: ProviderFailure =
      error instanceof SampleUnusable
        ? { provider: 'gemini', kind: 'bad_output', detail: error.message.slice(0, 1000) }
        : classifyThrown('gemini', error);
    return failureResponse(failure, {
      route: '/api/decks/questions/sample',
      person: gate.person,
      deckId: id,
    });
  }

  try {
    const bank = await saveBank(gate.person, id, kind, questions, 'sample');
    return Response.json({ questions: bank.questions.length, savedAt: bank.savedAt });
  } catch (error) {
    const refused = refusalResponse(error);
    if (refused) return refused;
    throw error;
  }
}
