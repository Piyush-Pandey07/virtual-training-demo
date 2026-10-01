import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { MAX_STREAM_REPORT_SECONDS, streamedSeconds } from './streamed';

/**
 * Live speech-to-text minutes in usage metering.
 *
 * The live transport sends audio from the browser straight to Deepgram, so until now
 * none of it was recorded and `sttSeconds` counted only the batch fallback. The browser
 * now counts what it sent and reports it. These check the number the server will accept
 * and that every way the socket closes reports what it owed.
 */

const SPEECH = readFileSync('src/hooks/useSpeechInput.ts', 'utf8');
const ROUTE = readFileSync('src/app/api/usage/stt/route.ts', 'utf8');

/** One hook-level function, from its declaration to the next. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `could not find ${name}`);
  const end = source.indexOf('\n  const ', start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

describe('what one report may record', () => {
  it('records an ordinary report as sent', () => {
    assert.equal(streamedSeconds(60), 60);
    assert.equal(streamedSeconds(12.5), 12.5);
  });

  it('keeps millisecond precision and drops float noise', () => {
    // 1,000 chunks of 1,024 samples at 16 kHz.
    assert.equal(streamedSeconds((1000 * 1024) / 16000), 64);
    assert.equal(streamedSeconds(0.1 + 0.2), 0.3);
  });

  it('records nothing for anything that is not a positive number', () => {
    for (const raw of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, '60', null, undefined, {}]) {
      assert.equal(streamedSeconds(raw), 0, `${String(raw)} was recorded`);
    }
  });

  it('holds a wild claim to the ceiling rather than refusing it', () => {
    // A late report still counts; a runaway one cannot claim an hour in one request.
    assert.equal(streamedSeconds(10_000), MAX_STREAM_REPORT_SECONDS);
    assert.equal(streamedSeconds(MAX_STREAM_REPORT_SECONDS + 0.4), MAX_STREAM_REPORT_SECONDS);
  });
});

describe('the browser reporting what it sent', () => {
  it('counts samples only once they have actually gone to Deepgram', () => {
    const chunk = bodyOf(SPEECH, 'handleStreamChunk');
    const sent = chunk.indexOf('socketRef.current.send(');
    const counted = chunk.indexOf('unreportedSamplesRef.current += chunk.pcm.length;');
    assert.ok(sent >= 0 && counted >= 0, 'the live path no longer counts what it sends');
    assert.ok(sent < counted, 'samples are counted before the send, including ones never sent');
    // Inside the open-socket branch, so a chunk dropped on a closed socket is not billed.
    const branch = chunk.slice(chunk.indexOf('readyState === WebSocket.OPEN'));
    assert.ok(branch.indexOf('unreportedSamplesRef') >= 0);
  });

  it('reports whenever the socket closes, which covers pause, stop and fallback', () => {
    assert.match(bodyOf(SPEECH, 'teardownSocket'), /reportStreamedAudio\(\);/);
  });

  it('reports every minute while open, and stops when it closes', () => {
    assert.match(SPEECH, /reportTimerRef\.current = setInterval\(reportStreamedAudio, STREAM_REPORT_MS\);/);
    assert.match(bodyOf(SPEECH, 'teardownSocket'), /clearInterval\(reportTimerRef\.current\)/);
  });

  it('reports on the way out of a closed tab, where nothing unmounts', () => {
    assert.match(SPEECH, /addEventListener\('pagehide', reportStreamedAudio\)/);
    // keepalive is what lets that last request finish after the page has gone.
    assert.match(bodyOf(SPEECH, 'reportStreamedAudio'), /keepalive: true/);
  });

  it('reports seconds, converted at the rate the audio was captured', () => {
    assert.match(bodyOf(SPEECH, 'reportStreamedAudio'), /seconds: samples \/ CAPTURE_SAMPLE_RATE/);
  });
});

describe('the server recording it', () => {
  it('only for somebody signed in', () => {
    assert.match(ROUTE, /const gate = await checkUser\(\);/);
  });

  it('through the bounded reading, never the raw number', () => {
    assert.match(ROUTE, /streamedSeconds\(body\?\.seconds\)/);
  });

  it('awaiting the write, so Vercel cannot freeze it half done', () => {
    assert.match(ROUTE, /await record\(gate\.person\.orgId, \{ sttSeconds: seconds \}\)/);
    assert.doesNotMatch(ROUTE, /recordQuietly\(/);
  });
});
