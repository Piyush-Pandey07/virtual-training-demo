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
 * limit and raised the same message for each.
 *
 * Read from source, like the tests in src/hooks, because what matters is which step is
 * asked for again and which requests are never made, and a rendering test would need
 * a fake fetch and a fake audio stack that are more likely to be wrong than the code.
 */

const REVIEW = readFileSync('src/app/decks/[id]/DeckReview.tsx', 'utf8');
const PLAYER = readFileSync('src/hooks/useTtsPlayer.ts', 'utf8');

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
  const speak = bodyOf(PLAYER.replace(/\r\n/g, '\n'), 'speakChunk');

  it('marks the turn as refused when a sentence is answered 429', () => {
    assert.match(
      speak,
      /if \(response\.status === 429\) limitedGenerationRef\.current = generation;/,
    );
    // Before the throw that raises the message, so the mark is in place before any
    // later sentence of the turn is looked at.
    assert.ok(
      speak.indexOf('limitedGenerationRef.current = generation') < speak.indexOf('throw new Error'),
    );
  });

  it('asks for nothing more in a turn that has been refused', () => {
    // Before the Hindi lookahead wait as well as before the request, so a refused
    // Hindi turn does not sit polling the clock for sentences it will never fetch.
    const skip = speak.indexOf('if (generation === limitedGenerationRef.current) return;');
    assert.ok(skip >= 0, 'a refused turn still sends its other sentences');
    assert.ok(skip < speak.indexOf("fetch('/api/tts'"));
    assert.ok(skip < speak.indexOf('waitForRoom(generation)'));
  });

  it('raises the message once, because only the refused request reaches it', () => {
    // The message is raised in the one catch. Every later sentence of the turn
    // returns before the request, so it never gets there.
    assert.equal(speak.match(/setError\(/g)?.length, 1);
    assert.equal(speak.match(/onError\?\.\(/g)?.length, 1);
  });

  it('lets the next turn speak, since every turn moves the generation on', () => {
    // The mark is only ever compared with, never cleared. That is safe because
    // interrupt, which starts every turn, makes a generation no refused turn had.
    const interrupt = bodyOf(PLAYER.replace(/\r\n/g, '\n'), 'interrupt');
    assert.match(interrupt, /generationRef\.current \+= 1;/);
    assert.match(PLAYER, /const limitedGenerationRef = useRef\(-1\);/);
    const writes = PLAYER.match(/limitedGenerationRef\.current = /g) ?? [];
    assert.equal(writes.length, 1, 'the refused turn is set from somewhere else too');

    const session = readFileSync('src/hooks/useTrainingSession.ts', 'utf8');
    assert.match(bodyOf(session.replace(/\r\n/g, '\n'), 'runTurn'), /player\.interrupt\(\);/);
  });
});
