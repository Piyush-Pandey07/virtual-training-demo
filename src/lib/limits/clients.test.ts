import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * How the browser behaves when the server says it is going too fast.
 *
 * The routes answer 429 with a Retry-After header and a message once somebody passes a
 * limit. Two clients call them in loops, and both used to treat that answer like any
 * other failure. The deck analysis abandoned its run, so "Analyse again" started from
 * the first step. The speech player sent every sentence still queued into the same
 * limit and raised the same message for each; it now holds on the refused sentence.
 *
 * Read from source, like the tests in src/hooks, because what matters is which step is
 * asked for again and which requests are never made, and a rendering test would need
 * a fake fetch and a fake audio stack that are more likely to be wrong than the code.
 */

const REVIEW = readFileSync('src/app/decks/[id]/DeckReview.tsx', 'utf8');
const PLAYER = readFileSync('src/hooks/useTtsPlayer.ts', 'utf8').replace(/\r\n/g, '\n');

/** One hook-level function, from its declaration to the next. See inaudible.test.ts. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `could not find ${name}`);
  const end = source.indexOf('\n  const ', start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

/** A top-level function in a module, from its declaration to the closing brace. */
function functionOf(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `could not find ${name}`);
  const end = source.indexOf('\n}\n', start);
  assert.ok(end >= 0, `could not find the end of ${name}`);
  return source.slice(start, end + 2);
}

/** The value a module-level numeric constant is declared with. */
function constant(source: string, name: string): number {
  const found = new RegExp(`const ${name} = (\\d+);`).exec(source);
  assert.ok(found, `could not find ${name}`);
  return Number(found[1]);
}

describe('analysing a deck when rate limited', () => {
  const analyse = bodyOf(REVIEW.replace(/\r\n/g, '\n'), 'analyse');
  const limited = analyse.slice(analyse.indexOf('response.status === 429'));

  it('asks for the same step again rather than abandoning the run', () => {
    // The server keeps the steps already done, so the only thing a 429 should cost is
    // the wait. Moving on would skip a step; throwing would restart from step 0.
    assert.ok(analyse.includes('response.status === 429'), 'a 429 is not handled');
    const branch = limited.slice(0, limited.indexOf('continue;'));
    assert.ok(limited.includes('continue;'), 'a 429 does not go round again');
    assert.doesNotMatch(branch, /step \+= 1/, 'a 429 moves on to the next step');

    // And it is handled before the success path reads the body as a step's result.
    const handled = analyse.indexOf('response.status === 429');
    assert.ok(handled < analyse.indexOf('if (!response.ok) throw'));
    assert.ok(handled < analyse.indexOf('step += 1'));
  });

  it('waits as long as Retry-After says, with a default and a cap', () => {
    assert.match(limited, /retryAfterSeconds\(response\)/);
    assert.match(limited, /await sleep\(/);

    const wait = functionOf(REVIEW.replace(/\r\n/g, '\n'), 'retryAfterSeconds');
    assert.match(wait, /headers\.get\('Retry-After'\)/);
    assert.match(wait, /return RATE_LIMIT_DEFAULT_WAIT_SECONDS;/);
    assert.match(wait, /Math\.min\([^)]*\), RATE_LIMIT_MAX_WAIT_SECONDS\)/);

    assert.equal(constant(REVIEW, 'RATE_LIMIT_DEFAULT_WAIT_SECONDS'), 5);
    assert.equal(constant(REVIEW, 'RATE_LIMIT_MAX_WAIT_SECONDS'), 120);
  });

  it('says it is waiting on the progress bar it already has', () => {
    assert.match(limited, /setProgress\(/);
    assert.match(limited, /Waiting \$\{left\}/);
  });

  it('gives up after five refusals in a row, with the server message', () => {
    assert.equal(constant(REVIEW, 'RATE_LIMIT_GIVE_UP_AFTER'), 5);
    assert.match(limited, /limitedInARow \+= 1;/);
    assert.match(
      limited,
      /if \(limitedInARow >= RATE_LIMIT_GIVE_UP_AFTER\) \{\s*throw new Error\(limited\.error/,
    );
    // In a row: a step that succeeds starts the count again, or a long deck meeting
    // the limit now and then would eventually give up on a run that was working.
    const after = analyse.slice(analyse.indexOf('continue;'));
    assert.match(after, /limitedInARow = 0;/);
  });
});

describe('speaking a turn when rate limited', () => {
  // The player used to drop the rest of a refused turn, which left a slide marked taught
  // with half its narration unheard. A refusal now holds the trainer on that sentence
  // until the limit has passed, like any other failure that waiting can clear.
  const speak = bodyOf(PLAYER, 'speakChunk');
  const fetcher = readFileSync('src/lib/voice/fetch-speech.ts', 'utf8').replace(/\r\n/g, '\n');

  it('holds on the refused sentence rather than skipping it', () => {
    assert.match(speak, /const retry = await holdOn\(loaded\.failure, generation, stalls\);/);
    assert.match(speak, /item\.audio = null;/);
    assert.doesNotMatch(PLAYER, /limitedGenerationRef/, 'the turn is still dropped on a 429');
  });

  it('waits as long as the server asked before trying again', () => {
    assert.match(fetcher, /if \(failure\.retryAfter\) return failure\.retryAfter \* 1000;/);
  });

  it('reads the Retry-After header into the failure', () => {
    const codes = readFileSync('src/lib/failures/codes.ts', 'utf8');
    assert.match(codes, /response\.headers\.get\('Retry-After'\)/);
  });

  it('lets the next turn speak, since every turn releases the hold', () => {
    const interrupt = bodyOf(PLAYER, 'interrupt');
    assert.match(interrupt, /generationRef\.current \+= 1;/);
    assert.match(interrupt, /releaseStallRef\.current\?\.\(false\);/);

    const session = readFileSync('src/hooks/useTrainingSession.ts', 'utf8');
    assert.match(bodyOf(session.replace(/\r\n/g, '\n'), 'runTurn'), /player\.interrupt\(\);/);
  });
});
