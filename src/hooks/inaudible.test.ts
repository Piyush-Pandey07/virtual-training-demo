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

/**
 * One hook-level function, from its declaration to the next one.
 *
 * Hook members are declared two spaces in, so the next `\n  const ` is where this one
 * ends. Reading a specific body matters: the earlier version of the scheduling check
 * sliced from the first `getContext()` in the file, which is in ensureAudible, and so
 * found unlock's call before speakChunk's and would have passed with speakChunk's
 * removed.
 */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `could not find ${name}`);
  const end = source.indexOf('\n  const ', start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

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
    const scheduling = bodyOf(PLAYER, 'speakChunk');
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

describe('a deliberate pause is not mistaken for silence', () => {
  /**
   * A paused context and a context the browser is holding back are the same thing from
   * inside: both report `suspended`. The player has to know which it is, because it
   * checks before every sentence, and that check must neither undo a pause by resuming
   * nor raise "You will not hear the trainer" over a session that is quiet on purpose.
   */

  it('steps aside while paused, before it can resume or warn', () => {
    const check = bodyOf(PLAYER, 'ensureAudible');
    const guard = check.indexOf('if (pausedRef.current) return false;');
    assert.ok(guard >= 0, 'ensureAudible no longer knows about a deliberate pause');
    assert.ok(
      guard < check.indexOf('context.resume()'),
      'a paused session would be resumed from inside the playback loop, undoing the pause',
    );
    assert.ok(
      guard < check.indexOf('setInaudible(!running)'),
      'a paused session would raise the inaudible warning',
    );
  });

  it('takes the warning down when pausing, rather than leaving it up', () => {
    const pause = bodyOf(PLAYER, 'pause');
    assert.match(pause, /pausedRef\.current = true;/);
    assert.match(pause, /setInaudible\(false\)/);
    assert.match(pause, /context\.suspend\(\)/);
  });

  it('checks honestly on resume, through the same path as any other silence', () => {
    // If the browser will not come back, the trainee should hear about it exactly as
    // they would at the start of a session. Going round ensureAudible would hide that.
    const resume = bodyOf(PLAYER, 'resume');
    const cleared = resume.indexOf('pausedRef.current = false;');
    const checked = resume.indexOf('return ensureAudible();');
    assert.ok(cleared >= 0 && checked >= 0, 'resume no longer clears the pause and checks');
    assert.ok(cleared < checked, 'resume checks audibility while still marked paused, so it always skips');
  });

  it('does not end a stopped session on the warning', () => {
    // Stop runs through interrupt. It discards what the pause held and restarts the
    // empty timeline quietly; going through ensureAudible could raise the warning on
    // the "Session complete" screen.
    const interrupt = bodyOf(PLAYER, 'interrupt');
    const branch = interrupt.slice(interrupt.indexOf('if (pausedRef.current)'));
    assert.ok(branch.length > 0, 'interrupt no longer ends a pause');
    assert.match(branch.slice(0, 200), /pausedRef\.current = false;/);
    assert.match(branch.slice(0, 200), /context\?\.resume\(\)/);
    // A call, not the word: the comment beside the branch names it to explain why not.
    assert.doesNotMatch(interrupt, /ensureAudible\(/, 'interrupt can raise the inaudible warning');
  });

  it('runs pause and resume one at a time', () => {
    // suspend() is asynchronous. Pause then Play pressed quickly used to let the
    // suspend land after the resume and freeze a session that thought it was playing.
    assert.match(bodyOf(PLAYER, 'pause'), /transitionRef\.current\.then\(/);
    assert.match(bodyOf(PLAYER, 'resume'), /transitionRef\.current\.then\(/);
    // And a pause overtaken by a Stop before it ran must not suspend anything.
    assert.match(bodyOf(PLAYER, 'pause'), /if \(pausedRef\.current && context && context\.state === 'running'\)/);
  });
});
