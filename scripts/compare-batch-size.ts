/**
 * Does a slide get better expertise when it is the only page in the call?
 *
 * The batch size was chosen to keep the cost of reading a deck down: three slides per
 * call rather than one is a third of the calls. If the quota is not the constraint,
 * the question becomes whether the model writes more about a page when nothing else
 * is competing for its attention — and that is measurable rather than arguable.
 *
 *   npx tsx --conditions react-server --env-file=.env.local \
 *     scripts/compare-batch-size.ts <deckId>
 *
 * Runs the same page twice: once alone, once in a batch of three. Reports what that
 * one page got each time.
 */

import { analyseTopics } from '../src/lib/analysis/topics';
import { loadDeck } from '../src/lib/decks/registry';
import type { GeneratedTopic } from '../src/lib/analysis/topics';
import { HOME_ORG_ID } from '../src/lib/orgs/types';

function report(label: string, topics: GeneratedTopic[], pageId: number, seconds: string) {
  const mine = topics.filter((topic) => topic.slideIds?.includes(pageId));
  const words = mine
    .flatMap((topic) => topic.explanation ?? [])
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;

  console.log(`${label}  (${seconds}s)`);
  console.log(`  topics for page ${pageId}   ${mine.length}`);
  console.log(`  words of explanation  ${words}`);
  console.log(
    `  misconceptions        ${mine.reduce((t, x) => t + (x.misconceptions?.length ?? 0), 0)}`,
  );
  console.log(`  questions             ${mine.reduce((t, x) => t + (x.faqs?.length ?? 0), 0)}`);
  console.log(`  triggers              ${mine.reduce((t, x) => t + (x.triggers?.length ?? 0), 0)}`);
  console.log(`  titles                ${mine.map((topic) => topic.title).join(' | ')}`);
  console.log();
}

async function main() {
  const deckId = process.argv[2];
  const deck = deckId ? await loadDeck(deckId) : undefined;
  if (!deck) {
    console.error('Usage: compare-batch-size.ts <deckId>');
    process.exit(1);
  }

  const teaching = deck.slides.filter((slide) => slide.teaches).map((slide) => slide.id);
  const batch = teaching.slice(0, 3);
  const alone = batch[1] ?? batch[0];
  if (alone === undefined) {
    console.error('This deck has no teaching slides.');
    process.exit(1);
  }

  console.log(`${deck.meta.title} — measuring page ${alone}\n`);

  let started = Date.now();
  const batched = await analyseTopics(HOME_ORG_ID, deck, deck.meta, batch);
  report(
    `in a batch of ${batch.length}`,
    batched,
    alone,
    ((Date.now() - started) / 1000).toFixed(1),
  );

  started = Date.now();
  const solo = await analyseTopics(HOME_ORG_ID, deck, deck.meta, [alone]);
  report('on its own', solo, alone, ((Date.now() - started) / 1000).toFixed(1));
}

void main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
