import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * Telling somebody the trainer is talking and they cannot hear it.
 *
 * A suspended AudioContext accepts everything it is given. `createBufferSource`,
 * `connect`, `start`, the whole timeline: none of it throws, and none of it plays. No
 * `onended` ever fires, and a slide is marked taught only once its narration finishes,
 * so the session records nothing either. The trainee sits watching slides in silence
 * while the deck bills for speech that was synthesised and never heard.
 *
 * That is not hypothetical. Two UAT sessions on 7 September reached slides 1 and 2,
 * spent six minutes, and recorded zero slides taught. Progress recording was tested
 * against production afterwards and works, so the pattern was consistent either with
 * clicking through or with silent playback, and nothing on screen could have told the
 * difference.
 *
 * These are source checks rather than a rendering test, because the interesting
 * property is a reading of the Web Audio contract rather than a component's output,
 * and getting it wrong is what produced the silence.
 */

const PLAYER = readFileSync('src/hooks/useTtsPlayer.ts', 'utf8');
const SESSION = readFileSync('src/hooks/useTrainingSession.ts', 'utf8');
const SCREEN = readFileSync('src/app/session/SessionScreen.tsx', 'utf8');

describe('detecting that nobody can hear the trainer', () => {
  it('reads the context state rather than trusting resume to have worked', () => {
    // The heart of it. `resume()` can resolve while the context stays suspended, so a
    // promise that settles is not evidence of anything. The old code awaited it, threw
    // the result away with a bare catch, and scheduled audio regardless.
    assert.match(
      PLAYER,
      /const running = context\.state === 'running';/,
      'the player no longer checks whether audio actually came up, only that resume settled',
    );
    assert.match(PLAYER, /setInaudible\(!running\)/);
  });

  it('checks before scheduling, not after', () => {
    // Raised at the moment the audio would have been heard and was not. Checking
    // afterwards would report it a buffer late, which on a forty-five second slide is
    // forty-five seconds of somebody wondering whether it is their headphones.
    const scheduling = PLAYER.slice(PLAYER.indexOf('const context = getContext();'));
    const check = scheduling.indexOf('await ensureAudible()');
    const create = scheduling.indexOf('createBufferSource');

    assert.ok(check >= 0, 'nothing checks audibility on the scheduling path');
    assert.ok(create >= 0, 'the scheduling path no longer creates a source');
    assert.ok(check < create, 'audibility is checked after the audio is scheduled, which is too late');
  });

  it('keeps it separate from a synthesis error', () => {
    // Two different failures that want two different sentences. `error` means there is
    // nothing to play; this means there is something to play and it will not come out,
    // which is worse because every other signal looks healthy.
    assert.match(PLAYER, /inaudible: boolean;/);
    assert.match(PLAYER, /error: string \| null;/);
  });

  it('reaches the screen through the session', () => {
    assert.match(SESSION, /audioInaudible: tts\.inaudible/);
    assert.match(SESSION, /retryAudio: tts\.ensureAudible/);
    assert.match(SCREEN, /session\.audioInaudible &&/);
  });

  it('offers the gesture that fixes it', () => {
    // A browser holding playback back wants a click it recognises. Telling somebody
    // their sound is off without giving them the one action that turns it on would be
    // an apology rather than a fix.
    const banner = SCREEN.slice(SCREEN.indexOf('session.audioInaudible &&'));
    assert.match(banner.slice(0, 1400), /onClick=\{\(\) => void session\.retryAudio\(\)\}/);
  });

  it('cannot be dismissed', () => {
    // The error banner above it can, and should: an error is over once it has been
    // read. This one is a live condition, and dismissing it would leave somebody in a
    // silent session that is also recording nothing.
    const banner = SCREEN.slice(SCREEN.indexOf('session.audioInaudible &&'));
    const toTheNextBlock = banner.slice(0, banner.indexOf('{session.error &&'));
    assert.doesNotMatch(toTheNextBlock, /Dismiss/, 'the inaudible warning became dismissible');
  });

  it('says what it costs, not just that it happened', () => {
    // "Audio unavailable" would be true and useless. The part a trainee needs is that
    // nothing counts until it plays, because otherwise they carry on and finish with
    // nothing recorded.
    const banner = SCREEN.slice(SCREEN.indexOf('session.audioInaudible &&'));
    assert.match(banner.slice(0, 1400), /marked as\s*\n?\s*completed until it plays/);
  });
});
