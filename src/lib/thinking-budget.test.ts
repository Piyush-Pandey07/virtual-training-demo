import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { ANSWER_THINKING_BUDGET, NARRATE_THINKING_BUDGET } from './config';

/**
 * How long the trainer may think before it says anything.
 *
 * Thinking tokens produce no speech, so on a live turn they are a trainee watching a
 * silent slide. Measured on the real prompt: about ten seconds a slide with thinking
 * left to the model, about one without.
 *
 * The thing this file actually guards is subtler than the number. Omitting
 * `thinkingConfig` is not the same as setting it to -1, and it is a difference no type
 * check can see: both compile, both run, and one of them costs nine seconds. An earlier
 * attempt to measure this compared -1 against 0 and reported a difference of 136ms,
 * concluding there was nothing here. Both arms had in fact run with 0, because the
 * environment variable was set on the measuring process and read by the server process,
 * so the experiment never varied the thing it named. The production baseline, which is
 * neither of those, was never measured at all.
 */

const ROUTE = readFileSync('src/app/api/chat/route.ts', 'utf8');

describe('the trainer thinking before it speaks', () => {
  it('is set explicitly, because omitting it is a different setting', () => {
    // The whole defect in one line. `thinkingConfig` absent means the model decides,
    // which measured at ten seconds to the first spoken word.
    assert.match(
      ROUTE,
      /thinkingConfig:\s*\{/,
      'the chat route no longer sets thinkingConfig, so the model decides again and the ' +
        'trainee waits about ten seconds before hearing anything',
    );
  });

  it('takes its budget from configuration rather than a literal', () => {
    // So the trade between speed and narration length can be revisited on a deployment
    // without a release, which is the only reason a measured number should be a variable.
    assert.match(ROUTE, /ANSWER_THINKING_BUDGET\(\)/);
    assert.match(ROUTE, /NARRATE_THINKING_BUDGET\(\)/);
  });

  it('defaults both turn kinds to no thinking', () => {
    assert.equal(NARRATE_THINKING_BUDGET(), 0);
    assert.equal(ANSWER_THINKING_BUDGET(), 0);
  });

  it('reads a budget from the environment when one is set', () => {
    // The middle of the road, if narration length ever matters more than the wait.
    // Exercised because the last attempt to tune this by environment variable silently
    // did nothing, and a setting nothing reads is worse than no setting.
    const before = process.env.NARRATE_THINKING_BUDGET;
    try {
      process.env.NARRATE_THINKING_BUDGET = '512';
      assert.equal(NARRATE_THINKING_BUDGET(), 512, 'the variable is not being read');

      process.env.NARRATE_THINKING_BUDGET = '-1';
      assert.equal(NARRATE_THINKING_BUDGET(), -1, 'a negative budget hands the choice back');

      process.env.NARRATE_THINKING_BUDGET = 'not a number';
      assert.equal(NARRATE_THINKING_BUDGET(), 0, 'nonsense should fall back, not become NaN');
    } finally {
      if (before === undefined) delete process.env.NARRATE_THINKING_BUDGET;
      else process.env.NARRATE_THINKING_BUDGET = before;
    }
  });

  it('leaves the analysis passes alone', () => {
    // They run once per deck, in the background, behind a progress bar nobody listens
    // to, and reasoning about a slide is the entire job. Speeding them up by making
    // them think less would be trading the thing for the measurement of the thing.
    for (const path of [
      'src/lib/analysis/outline.ts',
      'src/lib/analysis/slide-detail.ts',
      'src/lib/analysis/topics.ts',
    ]) {
      assert.doesNotMatch(
        readFileSync(path, 'utf8'),
        /thinkingBudget/,
        `${path} now limits thinking, which is the one place it is worth paying for`,
      );
    }
  });
});
