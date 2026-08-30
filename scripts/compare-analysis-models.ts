/**
 * Which model should read a deck.
 *
 * The narration model was chosen by measurement and the README records that
 * gemini-3.7-flash lost that comparison by narrating in stubs. Analysis is a
 * different job — structured output, read once per deck, and every session afterwards
 * inherits whatever it produced — so it deserves its own measurement rather than the
 * assumption that the answer is the same.
 *
 *   npx tsx --conditions react-server --env-file=.env.local \
 *     scripts/compare-analysis-models.ts <deckId> [model...]
 *
 * Reports what came back per model. It does not pick a winner: richer is not always
 * better, and a topic that is longer because it invented a control number is worse.
 * The counts are here to be read, and the sample topic is there to be judged.
 */

import { analyseTopics } from '../src/lib/analysis/topics';
import { loadDeck } from '../src/lib/decks/registry';

const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro'];

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

async function main() {
  const [deckId, ...models] = process.argv.slice(2);
  if (!deckId) {
    console.error('Usage: compare-analysis-models.ts <deckId> [model...]');
    process.exit(1);
  }

  const deck = await loadDeck(deckId);
  if (!deck) {
    console.error(`No such deck: ${deckId}`);
    process.exit(1);
  }

  // The teaching slides only, and at most three, so each model reads the same pages
  // and the comparison is about the model rather than about which pages it got.
  const pages = deck.slides
    .filter((slide) => slide.teaches)
    .slice(0, 3)
    .map((slide) => slide.id);

  console.log(`${deck.meta.title} — pages ${pages.join(', ')}\n`);

  for (const model of models.length > 0 ? models : DEFAULT_MODELS) {
    process.env.GEMINI_MODEL = model;
    const started = Date.now();

    try {
      const topics = await analyseTopics(deck, deck.meta, pages);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);

      const explanation = topics.map((topic) => topic.explanation?.length ?? 0);
      const words = topics.flatMap((topic) => topic.explanation ?? []).join(' ').split(/\s+/).length;

      // The one thing that is unambiguously wrong rather than merely different. A
      // generated clause number is the failure this pass is built to avoid.
      const invented = topics.filter(
        (topic) => (topic as { standardRefs?: string[] }).standardRefs?.length,
      ).length;

      console.log(`${model}  (${seconds}s)`);
      console.log(`  topics            ${topics.length}`);
      console.log(`  explanation lines ${mean(explanation).toFixed(1)} mean`);
      console.log(`  words of it       ${words}`);
      console.log(
        `  misconceptions    ${topics.reduce((t, x) => t + (x.misconceptions?.length ?? 0), 0)}`,
      );
      console.log(`  questions         ${topics.reduce((t, x) => t + (x.faqs?.length ?? 0), 0)}`);
      console.log(`  examples          ${topics.reduce((t, x) => t + (x.examples?.length ?? 0), 0)}`);
      console.log(`  invented refs     ${invented}${invented > 0 ? '  <-- disqualifying' : ''}`);

      const sample = topics[0];
      if (sample) {
        console.log(`  first topic       ${sample.title}`);
        console.log(`    ${(sample.explanation?.[0] ?? '').slice(0, 180)}`);
      }
      console.log();
    } catch (error) {
      console.log(`${model}  FAILED: ${(error as Error).message.slice(0, 160)}\n`);
    }
  }
}

void main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
