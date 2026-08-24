/**
 * POST /api/decks/{id}/analyse
 *
 * Runs one step of the outline pass and saves the result. The browser calls it
 * repeatedly until it reports done.
 *
 * One step per request, rather than one request for the whole deck, because a
 * sixty-page deck is one whole-deck call plus six batch calls and that does not fit
 * inside a function timeout. Vercel also cannot run work after a response has been
 * sent, so a "background job with polling" would need a queue this does not have
 * yet. Letting the browser drive keeps every request small, gives honest progress,
 * and means a deck that fails on batch four keeps the three batches that worked.
 *
 * Step 0 is the whole-deck pass. Every step after it is a batch of pages, and each
 * batch is given step 0's answer, so a page in the middle is described as part of
 * this deck rather than in isolation.
 */

import {
  analyseDeckMeta,
  analyseSlideBatch,
  mergeDeckMeta,
  mergeSlideOutlines,
  outlineBatches,
} from '@/lib/analysis/outline';
import { deckStore } from '@/lib/decks/registry';
import { DeckInvalidError, DeckStoreError } from '@/lib/decks/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * A whole-deck call on a long deck is the slow one. The Hobby ceiling is 60, and a
 * step that cannot finish inside it is a step that needs to be smaller.
 */
export const maxDuration = 60;

interface AnalyseBody {
  step?: unknown;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  const store = deckStore();
  if (!store.writable) {
    return Response.json(
      { error: 'This deployment has no deck storage configured, so analysis cannot be saved.' },
      { status: 503 },
    );
  }

  let stored;
  try {
    stored = await store.get(id);
  } catch (error) {
    if (error instanceof DeckInvalidError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof DeckStoreError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  if (!stored) return Response.json({ error: 'No such deck.' }, { status: 404 });

  /**
   * A hand-authored deck is never analysed.
   *
   * Not the same question as whether it is writable. The built-in deck is seeded
   * into real storage on first use, which makes it editable, and pointing this
   * endpoint at it once was enough to replace a carefully written title with the
   * literal text off the cover page. Editing it by hand is still allowed; having a
   * model rewrite it is not.
   */
  if (stored.record.meta.origin === 'authored') {
    return Response.json(
      {
        error:
          'This deck was written by hand and its references have been checked. Analysing it would replace that with generated text. Upload a copy if you want to analyse one.',
      },
      { status: 409 },
    );
  }

  if (stored.readOnly) {
    return Response.json(
      { error: 'This deck lives in the build and cannot be changed.' },
      { status: 409 },
    );
  }

  let body: AnalyseBody;
  try {
    body = (await request.json()) as AnalyseBody;
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const deck = stored.record;
  const batches = outlineBatches(deck);
  // Step 0 is the whole-deck pass; the rest are page batches.
  const totalSteps = 1 + batches.length;

  const step = Number(body.step);
  if (!Number.isInteger(step) || step < 0 || step >= totalSteps) {
    return Response.json(
      { error: `step must be an integer from 0 to ${totalSteps - 1}.` },
      { status: 400 },
    );
  }

  try {
    if (step === 0) {
      const analysis = await analyseDeckMeta(deck);
      const meta = mergeDeckMeta(deck.meta, analysis, new Date().toISOString());
      await store.save({ ...deck, meta }, stored.status);

      return Response.json({
        step,
        totalSteps,
        done: totalSteps === 1,
        label: 'Read the deck as a whole',
        // Useful to show, and the field most worth a trainer's attention.
        ownerNamedInDeck: analysis.ownerNamedInDeck,
        title: meta.title,
      });
    }

    const pageNumbers = batches[step - 1];
    const outlines = await analyseSlideBatch(deck, deck.meta, pageNumbers);
    const updated = mergeSlideOutlines(deck, outlines);
    await store.save(updated, stored.status);

    return Response.json({
      step,
      totalSteps,
      done: step === totalSteps - 1,
      label: `Described pages ${pageNumbers[0]} to ${pageNumbers[pageNumbers.length - 1]}`,
      described: outlines.length,
      expected: pageNumbers.length,
    });
  } catch (error) {
    // The model's own failures are the common case here: a rate limit, a safety
    // block, or malformed JSON despite the schema. Reporting the message rather
    // than a generic failure is what makes a retry an informed decision.
    const message = error instanceof Error ? error.message : 'The analysis step failed.';
    return Response.json({ error: message, step }, { status: 502 });
  }
}
