import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { shortOfCompletion, type ShortOfCompletion } from './session-end';

/**
 * The end of an AI-led session stopped part way through (UAT issue 13).
 *
 * It read "Session complete. You covered 4 of 12 slides", with the post-session assessment
 * offered. The heading, and the steps waiting for completion, are UAT issue 12's and pinned
 * in assessments/after-session.test.ts. What is pinned here is what somebody who stopped is
 * told beneath "Session ended": that they stopped, how far through they are, that their
 * progress is saved and where to resume.
 */

function facts(overrides: Partial<ShortOfCompletion> = {}): ShortOfCompletion {
  return { endedBy: 'stopped', step: null, percent: 38, completeAt: 90, taught: 4, ...overrides };
}

const RESUME =
  'Your progress is saved. Resume from the home page, or from this page, and Nova picks up at the first slide you have not heard.';

describe('the end of a session stopped short of completion', () => {
  it('says they stopped, how far through they are, that progress is saved, and where to resume', () => {
    assert.deepEqual(shortOfCompletion(facts()), [
      'You stopped the session part way through.',
      'You are 38% through the session. It counts as completed once 90% of it has been taught.',
      RESUME,
    ]);
  });

  it('says which step waits for completion, in the words every other screen uses', () => {
    assert.deepEqual(shortOfCompletion(facts({ step: 'post' })), [
      'You stopped the session part way through.',
      'The post-session assessment opens once you have completed the session.',
      'You are 38% through the session. It counts as completed once 90% of it has been taught.',
      RESUME,
    ]);
    assert.equal(
      shortOfCompletion(facts({ step: 'feedback' }))[1],
      'Feedback opens once you have completed the session.',
    );
  });

  it('names the deck’s own completion point', () => {
    assert.match(shortOfCompletion(facts({ completeAt: 75 }))[1]!, /once 75% of it/);
  });

  it('promises nothing saved when nothing has been taught', () => {
    assert.deepEqual(shortOfCompletion(facts({ percent: 0, taught: 0 })), [
      'You stopped the session part way through.',
      'You are 0% through the session. It counts as completed once 90% of it has been taught.',
      'Start again from the home page, or from this page, whenever you are ready.',
    ]);
  });
});

describe('the end of a session wrapped up short of completion', () => {
  it('does not say they stopped, and still says how far through and how to carry on', () => {
    // Slides skipped with Next count nothing (AI-34), so the trainer can wrap up a deck
    // that is not complete.
    assert.deepEqual(shortOfCompletion(facts({ endedBy: 'wrapped-up', percent: 61, taught: 7 })), [
      'You are 61% through the session. It counts as completed once 90% of it has been taught.',
      RESUME,
    ]);
  });
});

/**
 * Where it is used, read from source as pause.test.ts reads the session hook: the property
 * is which path sets what, and a rendering test would need a fake audio stack.
 */
describe('the session screen', () => {
  const SESSION = readFileSync('src/hooks/useTrainingSession.ts', 'utf8');
  const SCREEN = readFileSync('src/app/session/SessionScreen.tsx', 'utf8');

  function bodyOf(source: string, name: string): string {
    const start = source.indexOf(`const ${name} = useCallback(`);
    assert.ok(start >= 0, `could not find ${name}`);
    const end = source.indexOf('\n  const ', start + 1);
    return source.slice(start, end === -1 ? undefined : end);
  }

  it('marks Stop as stopped, and the wrap-up after the last slide as wrapped up', () => {
    // Set just before the microphone closes, which audio-privacy.test.ts keeps right
    // beside the ended phase.
    const closes = /\s*sttRef\.current\.stop\(\);\s*setPhase\('ended'\);/.source;
    assert.match(bodyOf(SESSION, 'endSession'), new RegExp(`setEndedBy\\('stopped'\\);${closes}`));
    assert.match(
      bodyOf(SESSION, 'runTurn'),
      new RegExp(`if \\(kind === 'recap'\\) \\{[\\s\\S]*?setEndedBy\\('wrapped-up'\\);${closes}`),
    );
  });

  it('says it on the card whenever the session is not complete, and offers to resume', () => {
    assert.match(
      SCREEN,
      /\{!session\.standing\.complete && \(\s*<p[^>]*>\s*\{shortOfCompletion\(\{\s*endedBy: session\.endedBy/,
    );
    assert.match(SCREEN, /onClick=\{\(\) => window\.location\.reload\(\)\}/);
  });

  it('still offers the step after the session only once it is complete', () => {
    assert.match(
      SCREEN,
      /const stepWaits = afterSession !== null && !session\.standing\.complete;/,
    );
    assert.match(SCREEN, /href=\{stepWaits \? '\/' : \(afterSession\?\.href \?\? '\/'\)\}/);
  });
});
