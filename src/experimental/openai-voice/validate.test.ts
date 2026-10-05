import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { MAX_TEXT_CHARS, MAX_UPLOAD_BYTES, SPEECH_MODELS, TRANSCRIBE_MODELS } from './catalogue';
import {
  parseSpeechRequest,
  parseTranscribeRequest,
  uploadNameFor,
  wordAccuracy,
} from './validate';

/** EXPERIMENTAL -- OpenAI voice trial. Deleted with the trial. */

describe('the trial speech request', () => {
  const valid = { text: 'Hello there.', voice: 'marin', model: 'gpt-4o-mini-tts', style: 'Warm.' };

  it('accepts something the trial offers', () => {
    const parsed = parseSpeechRequest(valid);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, valid);
  });

  it('refuses empty or overlong text, because the key is billed', () => {
    assert.equal(parseSpeechRequest({ ...valid, text: '   ' }).ok, false);
    assert.equal(parseSpeechRequest({ ...valid, text: 'a'.repeat(MAX_TEXT_CHARS + 1) }).ok, false);
    assert.equal(parseSpeechRequest({ ...valid, text: 'a'.repeat(MAX_TEXT_CHARS) }).ok, true);
  });

  it('refuses a model or voice it does not offer', () => {
    assert.equal(parseSpeechRequest({ ...valid, model: 'gpt-5-tts' }).ok, false);
    assert.equal(parseSpeechRequest({ ...valid, voice: 'aura-2-thalia-en' }).ok, false);
    // The older models predate the newer voices.
    assert.equal(parseSpeechRequest({ ...valid, model: 'tts-1' }).ok, false);
    assert.equal(parseSpeechRequest({ ...valid, model: 'tts-1', voice: 'nova' }).ok, true);
  });

  it('drops the speaking style for a model that ignores it', () => {
    const parsed = parseSpeechRequest({ ...valid, model: 'tts-1-hd', voice: 'nova' });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.style, null);
  });

  it('refuses anything that is not an object', () => {
    for (const body of [null, 'text', 42, undefined]) {
      assert.equal(parseSpeechRequest(body).ok, false);
    }
  });

  it('offers the two voices OpenAI recommends on its current model', () => {
    const current = SPEECH_MODELS.find((model) => model.id === 'gpt-4o-mini-tts')!;
    assert.ok(current.voices.includes('marin') && current.voices.includes('cedar'));
  });
});

describe('the trial transcription request', () => {
  const valid = {
    model: 'gpt-4o-transcribe',
    hint: '1',
    audioType: 'audio/webm;codecs=opus',
    audioSize: 2048,
  };

  it('names the upload so OpenAI can tell the format', () => {
    assert.equal(uploadNameFor('audio/webm;codecs=opus'), 'speech.webm');
    assert.equal(uploadNameFor('audio/mp4'), 'speech.mp4');
    assert.equal(uploadNameFor('audio/ogg; codecs=opus'), 'speech.ogg');
    assert.equal(uploadNameFor('video/webm'), null);
    assert.equal(uploadNameFor(''), null);
  });

  it('accepts a recording from Chrome or Safari', () => {
    const chrome = parseTranscribeRequest(valid);
    assert.ok(chrome.ok);
    assert.equal(chrome.value.fileName, 'speech.webm');
    assert.equal(chrome.value.hint, true);

    const safari = parseTranscribeRequest({ ...valid, audioType: 'audio/mp4', hint: '0' });
    assert.ok(safari.ok);
    assert.equal(safari.value.hint, false);
  });

  it('refuses an unknown model, an empty recording, or one too large', () => {
    assert.equal(parseTranscribeRequest({ ...valid, model: 'nova-3' }).ok, false);
    assert.equal(parseTranscribeRequest({ ...valid, audioSize: 0 }).ok, false);
    assert.equal(parseTranscribeRequest({ ...valid, audioSize: MAX_UPLOAD_BYTES + 1 }).ok, false);
    assert.equal(parseTranscribeRequest({ ...valid, audioType: 'text/plain' }).ok, false);
  });

  it('preselects at least one model, so recording straight away does something', () => {
    assert.ok(TRANSCRIBE_MODELS.some((model) => model.preselected));
  });
});

describe('scoring what a model heard', () => {
  it('is 100 for an exact match, ignoring case and punctuation', () => {
    assert.equal(
      wordAccuracy('Is a TVRA report confidential?', 'is a tvra report, confidential'),
      100,
    );
    assert.equal(wordAccuracy('client’s team', "client's team"), 100);
  });

  it('counts substitutions, omissions and insertions', () => {
    // One word wrong out of five.
    assert.equal(
      wordAccuracy('is a tvra report confidential', 'is a tiara report confidential'),
      80,
    );
    // One missing out of five.
    assert.equal(wordAccuracy('is a tvra report confidential', 'is a report confidential'), 80);
    // One extra against five.
    assert.equal(
      wordAccuracy('is a tvra report confidential', 'is a tvra report very confidential'),
      80,
    );
  });

  it('never goes below zero', () => {
    assert.equal(wordAccuracy('two words', 'a much longer and entirely different sentence'), 0);
    assert.equal(wordAccuracy('two words', ''), 0);
  });
});

describe('the trial stays removable', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(entry) ? [path.replaceAll('\\', '/')] : [];
    });
  }

  it('is imported by nothing outside the experimental folders', () => {
    // The promise made to whoever deletes it: the app does not depend on it, so taking
    // the folders away cannot break a build.
    const offenders = sources('src').filter(
      (path) =>
        !path.includes('/experimental/') &&
        /from\s+['"][^'"]*experimental[^'"]*['"]/.test(readFileSync(path, 'utf8')),
    );
    assert.deepEqual(offenders, [], `these files depend on the trial: ${offenders.join(', ')}`);
  });
});
