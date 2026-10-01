import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { pcmToFloat } from '../pcm';
import { voiceCatalogue, voiceModelFor } from './catalogue';

/**
 * Choosing the trainer's voice.
 *
 * Three properties, from the to-do of 29 September and the conversation that followed:
 * the delegate chooses from voices the provider really has and can hear each first;
 * once the session starts nobody can change the voice until it ends; and the screen is
 * built so the list can later come from another provider without reworking it.
 */

const SESSION = readFileSync('src/hooks/useTrainingSession.ts', 'utf8');
const PLAYER = readFileSync('src/hooks/useTtsPlayer.ts', 'utf8');
const SCREEN = readFileSync('src/app/session/SessionScreen.tsx', 'utf8');
const PICKER = readFileSync('src/components/VoicePicker.tsx', 'utf8');
const SAMPLE = readFileSync('src/hooks/useVoiceSample.ts', 'utf8');
const TTS_ROUTE = readFileSync('src/app/api/tts/route.ts', 'utf8');
const SAMPLE_ROUTE = readFileSync('src/app/api/voices/sample/route.ts', 'utf8');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

/** One hook-level function, from its declaration to the next. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `could not find ${name}`);
  const end = source.indexOf('\n  const ', start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

function withEnv(name: string, value: string | undefined, run: () => void) {
  const before = process.env[name];
  try {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    run();
  } finally {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  }
}

describe('the voices on offer', () => {
  const { voices, defaultVoiceId } = voiceCatalogue();

  it('is a short list a delegate can actually choose from', () => {
    assert.ok(voices.length >= 4 && voices.length <= 12, `${voices.length} voices`);
    assert.equal(new Set(voices.map((v) => v.id)).size, voices.length, 'a voice is listed twice');
    assert.equal(new Set(voices.map((v) => v.name)).size, voices.length, 'two voices share a name');
  });

  it('names only real Aura-2 English voices', () => {
    // A typo here is a voice that 400s on its first sentence. Checked against the live
    // account when the list was made; this keeps the shape honest between checks.
    for (const voice of voices) assert.match(voice.id, /^aura-2-[a-z]+-en$/, voice.id);
  });

  it('offers more than one accent, and keeps the voice every session had before', () => {
    assert.ok(new Set(voices.map((v) => v.accent)).size >= 2);
    assert.equal(voices[0]!.id, 'aura-2-thalia-en');
  });

  it('preselects a voice that is actually on the list', () => {
    assert.ok(voices.some((v) => v.id === defaultVoiceId));
  });
});

describe('which voice a request is spoken in', () => {
  it('uses the deployment default when none is asked for, as before there was a choice', () => {
    withEnv('DEEPGRAM_TTS_MODEL', undefined, () => {
      assert.equal(voiceModelFor(undefined), 'aura-2-thalia-en');
      assert.equal(voiceModelFor(null), 'aura-2-thalia-en');
    });
  });

  it('speaks in an offered voice when that one is asked for', () => {
    assert.equal(voiceModelFor('aura-2-draco-en'), 'aura-2-draco-en');
  });

  it('refuses a voice it does not offer, even a real one, rather than swapping it', () => {
    assert.equal(voiceModelFor('aura-2-zeus-en'), null, 'a real voice that is not offered');
    for (const bad of ['', 'thalia', 'aura-2-thalia-en; DROP', 42, {}, ['aura-2-thalia-en']]) {
      assert.equal(voiceModelFor(bad), null, `${JSON.stringify(bad)} was accepted`);
    }
  });

  it('keeps a configured default working even if it is not on the picker', () => {
    withEnv('DEEPGRAM_TTS_MODEL', 'aura-2-zeus-en', () => {
      assert.equal(voiceModelFor(undefined), 'aura-2-zeus-en', 'old clients lost their voice');
      // The picker still preselects something it can show.
      assert.equal(voiceCatalogue().defaultVoiceId, 'aura-2-thalia-en');
    });
    withEnv('DEEPGRAM_TTS_MODEL', 'aura-2-orpheus-en', () => {
      assert.equal(voiceCatalogue().defaultVoiceId, 'aura-2-orpheus-en');
    });
  });
});

describe('turning speech into sound', () => {
  it('maps 16-bit samples onto the range Web Audio plays', () => {
    const pcm = new Int16Array([0, 0x4000, -0x8000, 0x7fff]).buffer;
    const out = pcmToFloat(pcm);
    assert.equal(out.length, 4);
    assert.equal(out[0], 0);
    assert.equal(out[1], 0.5);
    assert.equal(out[2], -1);
    assert.ok(out[3]! > 0.9999 && out[3]! < 1);
  });

  it('drops a trailing half sample rather than reading past the end', () => {
    const bytes = new Uint8Array([0x00, 0x40, 0x7f]);
    assert.equal(pcmToFloat(bytes.buffer).length, 1);
    assert.equal(pcmToFloat(new ArrayBuffer(0)).length, 0);
  });
});

describe('the voice cannot change once the session has started', () => {
  // Asked for directly: "if the voice is locked at starting no one can change in
  // between the session". Each way it could change is closed off separately.

  it('is set in exactly one place, as the session starts', () => {
    const calls = SESSION.match(/\.setVoice\(/g) ?? [];
    assert.equal(calls.length, 1, `setVoice is called ${calls.length} times in the session`);
    assert.match(bodyOf(SESSION, 'startSession'), /ttsRef\.current\.setVoice\(voice\);/);
  });

  it('is carried by every sentence the trainer speaks', () => {
    assert.match(bodyOf(PLAYER, 'speakChunk'), /JSON\.stringify\(voice \? \{ text, voice \} : \{ text \}\)/);
  });

  it('is not changed by pausing or playing', () => {
    assert.doesNotMatch(bodyOf(SESSION, 'pauseSession'), /voice/i);
    assert.doesNotMatch(bodyOf(SESSION, 'resumeSession'), /voice/i);
  });

  it('cannot be reached from the running session: nothing hands out a way to change it', () => {
    const result = SESSION.slice(
      SESSION.indexOf('export interface UseTrainingSessionResult'),
      SESSION.indexOf('export interface ResumeState'),
    );
    assert.doesNotMatch(result, /setVoice|changeVoice|voice:\s*\(/, 'the session exposes a voice setter');
  });

  it('is chosen only on the lobby, which a running session never returns to', () => {
    assert.match(SCREEN, /const showLobby = session\.phase === 'idle';/);
    const lobby = SCREEN.slice(SCREEN.indexOf('function Lobby('), SCREEN.indexOf('export function SessionScreen('));
    assert.match(lobby, /<VoicePicker /, 'the picker moved out of the lobby');
    assert.equal((SCREEN.match(/<VoicePicker /g) ?? []).length, 1, 'a second picker appeared');
    // And no phase goes back to idle once started, anywhere in the app.
    for (const file of filesUnder('src')) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /setPhase\('idle'\)/, `${file} reopens the lobby`);
    }
  });
});

describe('another provider later, without reworking the screen', () => {
  it('the picker and its sample player name no provider and no voice', () => {
    for (const [name, source] of [['VoicePicker', PICKER], ['useVoiceSample', SAMPLE]] as const) {
      assert.doesNotMatch(source, /aura|deepgram/i, `${name} knows which provider it is`);
    }
  });

  it('the picker takes the catalogue as a type only, and the list from the API', () => {
    assert.match(PICKER, /import type \{ VoiceCatalogue \} from '@\/lib\/voice\/catalogue';/);
    assert.match(PICKER, /fetch\('\/api\/voices'\)/);
    assert.match(SAMPLE, /\/api\/voices\/sample\?voice=/);
  });

  it('only synthesise.ts calls the provider, so that is the one place to change', () => {
    const callers = filesUnder('src').filter((f) => readFileSync(f, 'utf8').includes('/v1/speak'));
    assert.deepEqual(callers.map((f) => f.replaceAll('\\', '/')), ['src/lib/voice/synthesise.ts']);
    for (const route of [TTS_ROUTE, SAMPLE_ROUTE]) {
      assert.match(route, /voiceModelFor\(/);
      assert.match(route, /synthesise\(/);
    }
  });

  it('the sample says a fixed line, not whatever the browser sends', () => {
    // So it is not a second way to synthesise anything at all, and every voice is
    // heard saying the same thing.
    assert.match(SAMPLE_ROUTE, /synthesise\(VOICE_SAMPLE_TEXT, model, request\.signal\)/);
    assert.doesNotMatch(SAMPLE_ROUTE, /searchParams\.get\('text'\)|request\.json\(\)/);
  });
});
