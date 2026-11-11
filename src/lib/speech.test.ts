import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { nextOpeningCut, sanitiseForSpeech } from './speech';

/**
 * Everything the trainer says is spoken aloud, so anything that reads badly in a
 * voice has to be stripped before it reaches the speech engine. The prompt asks
 * the model to avoid all of this, and mostly it does, but a demo should not
 * depend on that holding every single turn.
 */
describe('sanitiseForSpeech', () => {
  it('turns a spaced dash into a comma, which is how it should be read', () => {
    // An en dash used as punctuation reached a live session and survived the
    // original sanitiser, which only handled em dashes.
    assert.equal(
      sanitiseForSpeech('the strange requests – those are usually obvious'),
      'the strange requests, those are usually obvious',
    );
    assert.equal(sanitiseForSpeech('one thing — then another'), 'one thing, then another');
  });

  it('keeps an en dash in a numeric range, which the brand guidelines allow', () => {
    assert.equal(sanitiseForSpeech('within 30–45 days'), 'within 30–45 days');
    assert.equal(sanitiseForSpeech('an 8–10 month programme'), 'an 8–10 month programme');
  });

  it('removes markdown that a voice would read out as symbols', () => {
    assert.equal(sanitiseForSpeech('**bold** and _italic_'), 'bold and italic');
    assert.equal(sanitiseForSpeech('## A heading'), 'A heading');
  });

  it('strips list markers, since a spoken answer is not a list', () => {
    assert.equal(sanitiseForSpeech('- first point'), 'first point');
    assert.equal(sanitiseForSpeech('1. first point'), 'first point');
    assert.equal(sanitiseForSpeech('• first point'), 'first point');
  });

  it('drops code fences entirely', () => {
    assert.equal(
      sanitiseForSpeech('before ```const x = 1;``` after').replace(/\s+/g, ' '),
      'before after',
    );
  });

  it('collapses the double punctuation its own substitutions can create', () => {
    assert.equal(sanitiseForSpeech('a — , b'), 'a, b');
  });

  it('leaves ordinary prose untouched', () => {
    const prose =
      "Welcome to the session. I'm Nova, and we'll look at the four classification tiers together.";
    assert.equal(sanitiseForSpeech(prose), prose);
  });

  it('preserves hyphens inside words, which are not dashes', () => {
    assert.equal(sanitiseForSpeech('multi-factor authentication'), 'multi-factor authentication');
    assert.equal(sanitiseForSpeech('a well-known risk'), 'a well-known risk');
  });
});

/**
 * The sanitiser being correct is not the same as the sanitiser being connected.
 *
 * For its whole life it was applied only on the server, into a `done` server-sent
 * event that the client never handled, while the text to speech player was fed the
 * raw streamed deltas. Every test above passed throughout. These assert the wiring,
 * which is the part that was actually broken.
 */
describe('the sanitiser is on the path to the speaker', () => {
  it('runs inside the player, at the point text becomes audio', () => {
    const player = readFileSync('src/hooks/useTtsPlayer.ts', 'utf8');
    assert.match(
      player,
      /import \{[^}]*\bsanitiseForSpeech\b[^}]*\} from '@\/lib\/speech';/,
      'the player does not import it',
    );
    assert.match(
      player,
      /const trimmed = sanitiseForSpeech\(text\)/,
      'enqueue no longer sanitises, so raw model output reaches the speaker again',
    );
  });

  it('runs before a reply becomes model history', () => {
    const session = readFileSync('src/hooks/useTrainingSession.ts', 'utf8');
    assert.match(
      session,
      /const finalText = sanitiseForSpeech\(spoken\)/,
      'the transcript keeps raw markdown, which the model then reads back as its own style',
    );
  });

  it('lives in a module the browser can import', () => {
    // It used to sit in trainer-prompt.ts, which is server-side and holds every
    // prompt string. That is why it was never applied on the client.
    const own = readFileSync('src/lib/speech.ts', 'utf8');
    assert.match(own, /export function sanitiseForSpeech/);
    assert.doesNotMatch(own, /from '\.\/deck'/, 'importing the deck would drag it server-side');
    assert.doesNotMatch(own, /from '\.\/knowledge'/);
  });
});

describe('the first chunk of a turn (AI-44)', () => {
  it('is cut at the first sentence end after 20 characters', () => {
    const text = 'Welcome to the session. Today we will look at how power reaches the racks.';
    assert.equal(nextOpeningCut(text), text.indexOf('.') + 1);
  });

  it('falls back to the first clause break after 25 characters', () => {
    const text = 'Welcome to this session on data centres, where we will look at power and cooling';
    assert.equal(nextOpeningCut(text), text.indexOf(',') + 1);
  });

  it('failing punctuation, cuts before a joining word after 30 characters', () => {
    // As measured on the live site: the only comma comes after two words.
    const text = 'So, we have just covered what a data centre is and why it matters to every';
    assert.equal(nextOpeningCut(text), text.indexOf(' and '));
    assert.equal(nextOpeningCut('So, we have covered what and why'), -1);
  });

  it('cuts Hindi before a joining word too', () => {
    const text = 'डेटा सेंटर हमारे डिजिटल जीवन का आधार हैं और इनके बिना कुछ नहीं';
    assert.equal(nextOpeningCut(text), text.indexOf(' और '));
  });

  it('waits while there is too little to say', () => {
    assert.equal(nextOpeningCut('Welcome.'), -1);
    assert.equal(nextOpeningCut('Welcome to the sessi'), -1);
  });

  it('is only used for the opening chunk of a turn', () => {
    const player = readFileSync('src/hooks/useTtsPlayer.ts', 'utf8');
    assert.match(player, /opening \? nextOpeningCut\(buffer\) : nextSpeechCut\(buffer\)/);
    assert.match(player, /openingRef\.current = true;/);
  });
});
