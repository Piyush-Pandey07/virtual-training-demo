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
import { analyseSlideDetail, detailBatches, mergeSlideDetail } from '@/lib/analysis/slide-detail';
import { analyseTopics, backfillSlideIds, mergeTopics, topicBatches } from '@/lib/analysis/topics';
import { deckStore } from '@/lib/decks/registry';
import { checkReadyToPublish } from '@/lib/decks/serialise';
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

  /**
   * The whole run, as a list of steps the browser walks.
   *
   * Built here rather than tracked in storage so a run is resumable and
   * interruptible for free: every step reads the deck as it currently stands, does
   * one thing, and saves. A run that dies on step four keeps the three that worked,
   * and starting again repeats only what is cheap.
   *
   * Order matters. The whole-deck pass first, because both later passes are given
   * its answer as context. The outline before the teaching pass, because the
   * teaching pass needs each page's targetSeconds to know how much it can ask for,
   * and the outline is what sets it.
   */
  type Step =
    | { kind: 'meta' }
    | { kind: 'outline' | 'detail' | 'topics'; pages: number[] }
    | { kind: 'backfill' };

  const plan: Step[] = [
    { kind: 'meta' },
    ...outlineBatches(deck).map((pages) => ({ kind: 'outline' as const, pages })),
    ...detailBatches(deck).map((pages) => ({ kind: 'detail' as const, pages })),
    ...topicBatches(deck).map((pages) => ({ kind: 'topics' as const, pages })),
    // Last, and once. It needs every topic in place before it can tell which slides
    // still have nothing to be taught from, and it makes no model call.
    { kind: 'backfill' },
  ];

  const step = Number(body.step);
  if (!Number.isInteger(step) || step < 0 || step >= plan.length) {
    return Response.json(
      { error: `step must be an integer from 0 to ${plan.length - 1}.` },
      { status: 400 },
    );
  }

  const totalSteps = plan.length;
  const current = plan[step];
  const done = step === totalSteps - 1;

  try {
    if (current.kind === 'meta') {
      const analysis = await analyseDeckMeta(deck);
      const meta = mergeDeckMeta(deck.meta, analysis, new Date().toISOString());
      await store.save({ ...deck, meta }, stored.status);

      return Response.json({
        step,
        totalSteps,
        done,
        label: 'Read the deck as a whole',
        // Useful to show, and the field most worth a trainer's attention.
        ownerNamedInDeck: analysis.ownerNamedInDeck,
        title: meta.title,
      });
    }

    if (current.kind === 'backfill') {
      const filled = backfillSlideIds(deck);
      await store.save(filled, stored.status);

      // What a trainer most wants at the end of a run: whether the deck can be
      // published now, and if not, what is still missing.
      return Response.json({
        step,
        totalSteps,
        done,
        label: 'Matched the expertise to the slides it can teach',
        topics: filled.topics.length,
        blocking: checkReadyToPublish(filled),
      });
    }

    const { pages } = current;
    const span =
      pages.length === 1 ? `page ${pages[0]}` : `pages ${pages[0]} to ${pages[pages.length - 1]}`;

    if (current.kind === 'outline') {
      const outlines = await analyseSlideBatch(deck, deck.meta, pages);
      await store.save(mergeSlideOutlines(deck, outlines), stored.status);

      return Response.json({
        step,
        totalSteps,
        done,
        label: `Described ${span}`,
        described: outlines.length,
        expected: pages.length,
      });
    }

    if (current.kind === 'detail') {
      const details = await analyseSlideDetail(deck, deck.meta, pages);
      await store.save(mergeSlideDetail(deck, details), stored.status);

      return Response.json({
        step,
        totalSteps,
        done,
        label: `Worked out how to teach ${span}`,
        described: details.length,
        expected: pages.length,
      });
    }

    const generated = await analyseTopics(deck, deck.meta, pages);
    await store.save(mergeTopics(deck, pages, generated), stored.status);

    return Response.json({
      step,
      totalSteps,
      done,
      label: `Wrote the expertise behind ${span}`,
      described: generated.length,
      expected: pages.length,
    });
  } catch (error) {
    // The model's own failures are the common case here: a rate limit, a safety
    // block, or malformed JSON despite the schema. Reporting the message rather
    // than a generic failure is what makes a retry an informed decision.
    const message = error instanceof Error ? error.message : 'The analysis step failed.';
    return Response.json({ error: message, step }, { status: 502 });
  }
}
