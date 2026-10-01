import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * Play, pause and stop in a live session.
 *
 * A pause touches four things at once: the audio timeline, the microphone and its
 * billed socket to Deepgram, the turn machinery, and the controls. Getting any one of
 * them wrong produces a session that looks paused and is not: audio that carries on,
 * a microphone still listening and billing, or a new turn talking over the hold.
 *
 * Read from source, like inaudible.test.ts, because the properties here are about the
 * order things happen in and which path guards which, and a rendering test would need
 * a fake audio stack that is more likely to be wrong than the code it checks.
 */

const SESSION = readFileSync('src/hooks/useTrainingSession.ts', 'utf8');
const CONTROLS = readFileSync('src/components/SessionControls.tsx', 'utf8');
const SCREEN = readFileSync('src/app/session/SessionScreen.tsx', 'utf8');
const TYPES = readFileSync('src/lib/types.ts', 'utf8');

/** One hook-level function, from its declaration to the next. See inaudible.test.ts. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `could not find ${name}`);
  const end = source.indexOf('\n  const ', start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

describe('pausing a session', () => {
  it('holds the audio rather than cancelling the turn', () => {
    // Suspending carries on from the same word. Cancelling would lose the slide and
    // pay to generate and synthesise it all again on Play.
    const pause = bodyOf(SESSION, 'pauseSession');
    assert.match(pause, /ttsRef\.current\.pause\(\)/);
    assert.doesNotMatch(pause, /cancelCurrentTurn\(\)/, 'pausing throws the turn away');
  });

  it('closes the microphone and its socket', () => {
    // A held session should not listen, keep the recording light on, or keep sending
    // Deepgram audio it bills for.
    assert.match(bodyOf(SESSION, 'pauseSession'), /sttRef\.current\.stop\(\)/);
  });

  it('is not offered before the session is up, or once it is over', () => {
    const pause = bodyOf(SESSION, 'pauseSession');
    assert.match(pause, /phase === 'idle' \|\| phase === 'connecting' \|\| phase === 'ended'/);
    assert.match(CONTROLS, /const canPause = !ended && phase !== 'connecting' && phase !== 'idle';/);
  });

  it('is its own flag, not a phase', () => {
    // A turn in flight sets the phase as it goes, so a 'paused' phase pressed during
    // 'thinking' would be overwritten by 'speaking' when the first words arrived.
    const phases = TYPES.slice(TYPES.indexOf('export type SessionPhase'));
    assert.doesNotMatch(phases.slice(0, phases.indexOf(';')), /'paused'/);
    assert.match(SESSION, /const \[paused, setPaused\] = useState\(false\);/);
  });
});

describe('playing again', () => {
  it('brings the sound back before the microphone', () => {
    // From the click, which is the gesture the browser wants before it plays. The
    // microphone needs permission, already granted, not a gesture.
    const resume = bodyOf(SESSION, 'resumeSession');
    const sound = resume.indexOf('ttsRef.current.resume()');
    const mic = resume.indexOf('sttRef.current.start()');
    assert.ok(sound >= 0 && mic >= 0, 'resume no longer restores both');
    assert.ok(sound < mic, 'the microphone reopens first, and the sound may miss the gesture');
  });
});

describe('nothing moves while paused', () => {
  it('refuses a new turn, and refuses it before the turn can end the pause', () => {
    // runTurn calls player.interrupt(), and interrupt ends a pause. The guard has to
    // come first or a stray turn unfreezes the audio under a screen saying Paused.
    const turn = bodyOf(SESSION, 'runTurn');
    const guard = turn.indexOf('if (pausedRef.current) return;');
    // The statement, with its semicolon. The comment above the guard names the call
    // without one to explain the ordering, and a bare search finds that first.
    const interrupt = turn.indexOf('player.interrupt();');
    assert.ok(guard >= 0, 'runTurn no longer refuses to start while paused');
    assert.ok(guard < interrupt, 'runTurn ends the pause before checking for it');
  });

  it('ignores anything heard, though nothing should be', () => {
    assert.match(bodyOf(SESSION, 'handleUtterance'), /if \(pausedRef\.current\) return;/);
    assert.match(bodyOf(SESSION, 'handleSpeechStart'), /if \(pausedRef\.current\) return;/);
  });

  it('locks every control that would start a turn', () => {
    assert.match(CONTROLS, /const locked = phase === 'connecting' \|\| ended \|\| paused;/);
    assert.match(SCREEN, /session\.phase === 'ended' \|\| session\.paused;/, 'the slide rail stays live while paused');
  });

  it('hides Stop talking, since nobody is talking', () => {
    assert.match(CONTROLS, /trainerSpeaking && !paused && \(/);
  });
});

describe('stopping', () => {
  it('works from a pause, and leaves nothing paused behind', () => {
    const end = bodyOf(SESSION, 'endSession');
    assert.match(end, /pausedRef\.current = false;/);
    assert.match(end, /setPaused\(false\);/);
    assert.match(end, /cancelCurrentTurn\(\)/);
  });

  it('is never disabled by the pause itself', () => {
    // The one control a paused trainee must always have. Disabled only once ended.
    const stop = CONTROLS.slice(CONTROLS.indexOf('onClick={onEnd}'));
    assert.match(stop.slice(0, 120), /disabled=\{ended\}/);
  });

  it('replaces End session rather than sitting beside it', () => {
    assert.doesNotMatch(CONTROLS, />\s*End session\s*</, 'two buttons now end the session');
    assert.equal((CONTROLS.match(/onClick=\{onEnd\}/g) ?? []).length, 1);
  });
});
