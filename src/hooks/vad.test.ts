import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { CAPTURE_SAMPLE_RATE } from '../lib/config';
import { CHUNK_MS, CHUNK_SAMPLES } from './useMicCapture';

/**
 * The voice activity detector's constants have to agree with each other.
 *
 * Declaring speech is what cuts the trainer off mid-sentence, and the buffered
 * audio is only transcribed if it clears a minimum length. Those two thresholds
 * were set independently at 3 chunks (192 ms) and 250 ms, which left a 58 ms
 * window where a throat clear was loud enough to stop the narration and then too
 * short to be sent, so the trainee lost the rest of the slide and got nothing
 * back for it.
 *
 * The values live in a hook that cannot be imported outside a browser, so these
 * read the source. That is deliberate: the point is to fail if someone edits one
 * number without the other, and a source read catches that where a runtime
 * import could not.
 */
const SOURCE = readFileSync('src/hooks/useSpeechInput.ts', 'utf8');

function numeric(name: string): number {
  const match = SOURCE.match(new RegExp(`const ${name} = ([0-9_]+)`));
  assert.ok(match, `${name} not found, or no longer a plain number`);
  return Number(match[1].replace(/_/g, ''));
}

describe('microphone chunk geometry', () => {
  it('reports a chunk duration consistent with the capture rate', () => {
    assert.equal(CHUNK_MS, (CHUNK_SAMPLES / CAPTURE_SAMPLE_RATE) * 1000);
    assert.equal(CHUNK_MS, 64);
  });

  it('matches the worklet, which does its own batching', () => {
    const worklet = readFileSync('public/worklets/pcm-processor.js', 'utf8');
    const match = worklet.match(/const CHUNK_SAMPLES = (\d+)/);
    assert.ok(match, 'the worklet no longer declares CHUNK_SAMPLES');
    assert.equal(
      Number(match[1]),
      CHUNK_SAMPLES,
      'the hook and the worklet disagree on chunk size, so every duration derived from it is wrong',
    );
  });
});

describe('voice activity thresholds', () => {
  it('derives the onset from the transcription floor rather than hard-coding it', () => {
    assert.match(
      SOURCE,
      /const VAD_ONSET_CHUNKS = Math\.ceil\(VAD_MIN_SPEECH_MS \/ CHUNK_MS\)/,
      'VAD_ONSET_CHUNKS must be derived, or it can drift below the floor again',
    );
  });

  it('never interrupts on an onset too short to be transcribed', () => {
    const minSpeechMs = numeric('VAD_MIN_SPEECH_MS');
    const onsetChunks = Math.ceil(minSpeechMs / CHUNK_MS);
    const onsetMs = onsetChunks * CHUNK_MS;

    assert.ok(
      onsetMs >= minSpeechMs,
      `an onset of ${onsetMs} ms would cut the trainer off, then be discarded by the ${minSpeechMs} ms floor`,
    );
  });

  it('keeps a pre-roll long enough to cover the onset it took to notice speech', () => {
    const minSpeechMs = numeric('VAD_MIN_SPEECH_MS');
    const onsetChunks = Math.ceil(minSpeechMs / CHUNK_MS);
    assert.ok(
      numeric('VAD_PREROLL_CHUNKS') >= onsetChunks,
      'the pre-roll is shorter than the onset, so the start of every utterance is clipped',
    );
  });

  it('waits longer for the end of speech than it takes to declare the start', () => {
    const minSpeechMs = numeric('VAD_MIN_SPEECH_MS');
    const onsetMs = Math.ceil(minSpeechMs / CHUNK_MS) * CHUNK_MS;
    assert.ok(
      numeric('VAD_HANGOVER_MS') > onsetMs,
      'the hangover is shorter than the onset, so a normal pause between words ends the utterance',
    );
  });

  it('caps an utterance well inside the request body limit of the batch route', () => {
    const maxMs = numeric('VAD_MAX_UTTERANCE_MS');
    const bytes = (maxMs / 1000) * CAPTURE_SAMPLE_RATE * 2;
    // Vercel rejects a non-streaming request body over 4.5 MB.
    assert.ok(
      bytes < 4.5 * 1024 * 1024,
      `a full ${maxMs} ms utterance is ${(bytes / 1024 / 1024).toFixed(2)} MB and would be rejected`,
    );
  });
});

describe('cancellation safety', () => {
  it('guards the microphone start against being superseded mid-await', () => {
    const mic = readFileSync('src/hooks/useMicCapture.ts', 'utf8');
    assert.match(mic, /runIdRef/, 'no cancellation token, so a stale start can leak a live stream');
    // Both awaits need a check after them, not just the first.
    const checks = mic.match(/if \(superseded\(\)\)/g) ?? [];
    assert.ok(
      checks.length >= 2,
      `expected a check after getUserMedia and after addModule, found ${checks.length}`,
    );
    assert.match(
      mic,
      /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/,
      'a superseded start must release the device, not merely return',
    );
  });

  it('releases the microphone when the speech hook unmounts, not just the socket', () => {
    assert.match(
      SOURCE,
      /micRef\.current\.stop\(\)/,
      'unmount tears down the socket but leaves the microphone recording',
    );
  });

  it('falls back to the batch transport when the socket drops', () => {
    assert.match(SOURCE, /fallBackToBatch/, 'an unexpected socket close is still terminal');
    assert.match(
      SOURCE,
      /transportRef\.current = 'batch'/,
      'the fallback does not actually switch transport',
    );
  });
});

describe('turn cancellation in the session hook', () => {
  const session = readFileSync('src/hooks/useTrainingSession.ts', 'utf8');

  it('invalidates the turn token when taking the floor', () => {
    assert.match(
      session,
      /const cancelCurrentTurn = useCallback\(\(\) => \{\s*turnSeqRef\.current \+= 1;/,
    );
  });

  it('routes every cancel site through the helper, so none can forget the token', () => {
    // The old inline preamble was four lines repeated seven times, and End
    // session omitting the token bump is what made it need pressing twice.
    const inline =
      session.match(/turnAbortRef\.current\?\.abort\(\);\s*\n\s*busyRef\.current = false;/g) ?? [];
    assert.equal(
      inline.length,
      1,
      `the cancel preamble is inlined in ${inline.length} places; it should only appear inside cancelCurrentTurn`,
    );
  });

  it('takes the floor for a spoken utterance, not only a typed one', () => {
    const spoken = session.slice(session.indexOf('const handleUtterance'));
    assert.ok(
      spoken.indexOf('cancelCurrentTurn()') < spoken.indexOf('appendEntry'),
      'a spoken utterance still hits the busyRef guard and is discarded in silence',
    );
  });

  it('refuses to restart an ended session', () => {
    assert.match(session, /phaseRef\.current === 'ended' && kind !== 'recap'/);
  });
});
