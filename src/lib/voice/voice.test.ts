import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { pcmToFloat } from '../pcm';
import {
  canSpeak,
  sampleTextFor,
  speaksAsFor,
  voiceCatalogue,
  voiceFor,
  HINDI_SAMPLE_TEXT,
  VOICE_SAMPLE_TEXT,
} from './catalogue';

/**
 * Choosing the trainer's voice, and since 6 October its language.
 *
 * Three properties, from the to-do of 29 September and the conversation that followed:
 * the delegate chooses from voices the provider really has and can hear each first;
 * once the session starts nobody can change the voice until it ends; and the screen is
 * built so the list can later come from another provider without reworking it.
 *
 * Then a fourth, asked for on 6 October: Hindi through Sarvam, and every other
 * language exactly as it was on Deepgram.
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

/** A deployment with the Sarvam key, and one without. Never a real key. */
const withHindi = (run: () => void) => withEnv('SARVAM_API_KEY', 'test-key', run);
const withoutHindi = (run: () => void) => withEnv('SARVAM_API_KEY', undefined, run);

function english() {
  const option = voiceCatalogue().languages.find((language) => language.code === 'en');
  assert.ok(option, 'English is missing');
  return option;
}

function hindi() {
  return voiceCatalogue().languages.find((language) => language.code === 'hi');
}

describe('the English voices on offer, exactly as before Hindi', () => {
  it('is a short list a delegate can actually choose from', () => {
    const { voices } = english();
    assert.ok(voices.length >= 4 && voices.length <= 12, `${voices.length} voices`);
    assert.equal(new Set(voices.map((v) => v.id)).size, voices.length, 'a voice is listed twice');
    assert.equal(new Set(voices.map((v) => v.name)).size, voices.length, 'two voices share a name');
  });

  it('names only real Aura-2 English voices', () => {
    // A typo here is a voice that 400s on its first sentence. Checked against the live
    // account when the list was made; this keeps the shape honest between checks.
    for (const voice of english().voices) assert.match(voice.id, /^aura-2-[a-z]+-en$/, voice.id);
  });

  it('offers more than one accent, and keeps the voice every session had before', () => {
    const { voices } = english();
    assert.ok(new Set(voices.map((v) => v.accent)).size >= 2);
    assert.equal(voices[0]!.id, 'aura-2-thalia-en');
  });

  it('preselects a voice that is actually on the list', () => {
    const { voices, defaultVoiceId } = english();
    assert.ok(voices.some((v) => v.id === defaultVoiceId));
  });

  it('is the same list whether or not Hindi is offered beside it', () => {
    let without: unknown;
    let alongside: unknown;
    withoutHindi(() => (without = english()));
    withHindi(() => (alongside = english()));
    assert.deepEqual(alongside, without);
  });

  it('comes first, so a deployment that offers both still opens on English', () => {
    withHindi(() => assert.equal(voiceCatalogue().languages[0]!.code, 'en'));
  });
});

describe('Hindi', () => {
  it('is offered only where the Sarvam key is set', () => {
    withoutHindi(() => assert.equal(hindi(), undefined));
    withHindi(() => assert.ok(hindi()));
  });

  it("offers Sarvam's own recommended Hindi speakers, two of each", () => {
    withHindi(() => {
      const option = hindi()!;
      assert.deepEqual(
        option.voices.map((v) => v.name),
        ['Priya', 'Shubh', 'Suhani', 'Ashutosh'],
      );
      assert.ok(option.voices.some((v) => v.id === option.defaultVoiceId));
      assert.equal(option.name, 'हिन्दी');
      assert.equal(option.englishName, 'Hindi');
    });
  });

  it('is spoken by Sarvam in Hindi, and English is still spoken by Deepgram', () => {
    withHindi(() => {
      assert.deepEqual(voiceFor('sarvam-hi-priya'), {
        provider: 'sarvam',
        model: 'priya',
        languageCode: 'hi-IN',
      });
      assert.deepEqual(voiceFor('aura-2-pandora-en'), {
        provider: 'deepgram',
        model: 'aura-2-pandora-en',
      });
    });
  });

  it('gives the screen nothing about the provider', () => {
    // The screen sends an id back and never parses it. The provider, its speaker names
    // and the grammar setting stay on the server.
    withHindi(() => {
      for (const language of voiceCatalogue().languages) {
        for (const voice of language.voices) {
          assert.deepEqual(Object.keys(voice).sort(), ['accent', 'description', 'id', 'name']);
        }
      }
    });
  });

  it('refuses a Hindi voice on a deployment that cannot speak it', () => {
    withoutHindi(() => assert.equal(voiceFor('sarvam-hi-priya'), null));
  });

  it('knows which voices speak as a woman and which as a man', () => {
    withHindi(() => {
      assert.equal(speaksAsFor('sarvam-hi-priya'), 'feminine');
      assert.equal(speaksAsFor('sarvam-hi-suhani'), 'feminine');
      assert.equal(speaksAsFor('sarvam-hi-shubh'), 'masculine');
      assert.equal(speaksAsFor('sarvam-hi-ashutosh'), 'masculine');
      // Nothing for English, where nothing turns on it, or for anything not offered.
      assert.equal(speaksAsFor('aura-2-thalia-en'), undefined);
      assert.equal(speaksAsFor('sarvam-hi-varun'), undefined);
      assert.equal(speaksAsFor(42), undefined);
    });
  });

  it('plays a Hindi sample for a Hindi voice, and the English one for English', () => {
    withHindi(() => {
      assert.equal(sampleTextFor(voiceFor('sarvam-hi-shubh')!), HINDI_SAMPLE_TEXT);
      assert.equal(sampleTextFor(voiceFor('aura-2-thalia-en')!), VOICE_SAMPLE_TEXT);
    });
  });

  it('has a sample that suits a male voice and a female one alike', () => {
    // Hindi verbs agree with the speaker. A first-person verb in the sample would be
    // right for half the voices and wrong for the other half.
    assert.doesNotMatch(HINDI_SAMPLE_TEXT, /मैं/);
    // Written as Sarvam asks: Hindi in Devanagari, the English word in English letters,
    // and each sentence closed with a danda.
    assert.match(HINDI_SAMPLE_TEXT, /training session/);
    assert.ok(HINDI_SAMPLE_TEXT.endsWith('।'));
  });
});

describe('which voice a request is spoken in', () => {
  it('uses the deployment default when none is asked for, as before there was a choice', () => {
    withEnv('DEEPGRAM_TTS_MODEL', undefined, () => {
      assert.deepEqual(voiceFor(undefined), { provider: 'deepgram', model: 'aura-2-thalia-en' });
      assert.deepEqual(voiceFor(null), { provider: 'deepgram', model: 'aura-2-thalia-en' });
    });
  });

  it('speaks in an offered voice when that one is asked for', () => {
    assert.equal(voiceFor('aura-2-draco-en')?.model, 'aura-2-draco-en');
  });

  it('refuses a voice it does not offer, even a real one, rather than swapping it', () => {
    withHindi(() => {
      assert.equal(voiceFor('aura-2-zeus-en'), null, 'a real voice that is not offered');
      assert.equal(voiceFor('sarvam-hi-varun'), null, 'a real Sarvam speaker that is not offered');
      for (const bad of [
        '',
        'thalia',
        'priya',
        'aura-2-thalia-en; DROP',
        42,
        {},
        ['aura-2-thalia-en'],
      ]) {
        assert.equal(voiceFor(bad), null, `${JSON.stringify(bad)} was accepted`);
      }
    });
  });

  it('keeps a configured default working even if it is not on the picker', () => {
    withEnv('DEEPGRAM_TTS_MODEL', 'aura-2-zeus-en', () => {
      assert.equal(voiceFor(undefined)?.model, 'aura-2-zeus-en', 'old clients lost their voice');
      // The picker still preselects something it can show.
      assert.equal(english().defaultVoiceId, 'aura-2-thalia-en');
    });
    withEnv('DEEPGRAM_TTS_MODEL', 'aura-2-orpheus-en', () => {
      assert.equal(english().defaultVoiceId, 'aura-2-orpheus-en');
    });
  });
});

describe('an English voice is never handed Hindi', () => {
  // Deepgram does not refuse Devanagari. It returns audio of the letters read as English,
  // which plays, sounds like nonsense, and looks from every log like a success.
  const deepgram = { provider: 'deepgram' as const, model: 'aura-2-thalia-en' };
  const sarvam = { provider: 'sarvam' as const, model: 'priya', languageCode: 'hi-IN' as const };

  it('refuses text that is mostly Hindi', () => {
    assert.equal(canSpeak(deepgram, 'आज हम UPS और chiller के बारे में बात करेंगे।'), false);
  });

  it('still greets a trainee who typed their name in Hindi', () => {
    assert.equal(
      canSpeak(deepgram, 'Welcome, राहुल. Today we look at power in the data hall.'),
      true,
    );
  });

  it('lets English and anything else through, and lets a Hindi voice say anything', () => {
    assert.equal(canSpeak(deepgram, 'Welcome to the session.'), true);
    assert.equal(canSpeak(deepgram, '15, 20, 25.'), true);
    assert.equal(canSpeak(sarvam, 'आज हम UPS के बारे में बात करेंगे।'), true);
    assert.equal(canSpeak(sarvam, 'Plain English is fine too.'), true);
  });

  it('is checked by the speech route before anything is synthesised', () => {
    const route = TTS_ROUTE.slice(TTS_ROUTE.indexOf('export async function POST'));
    assert.ok(route.indexOf('canSpeak(') > 0, 'the route does not check');
    assert.ok(route.indexOf('canSpeak(') < route.indexOf('synthesise('), 'checked too late');
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

describe('the voice and language cannot change once the session has started', () => {
  // Asked for directly: "if the voice is locked at starting no one can change in
  // between the session". Each way it could change is closed off separately, and the
  // language goes with the voice, since each voice speaks only one.

  it('is set in exactly one place, as the session starts', () => {
    const calls = SESSION.match(/\.setVoice\(/g) ?? [];
    assert.equal(calls.length, 1, `setVoice is called ${calls.length} times in the session`);
    const start = bodyOf(SESSION, 'startSession');
    assert.match(start, /ttsRef\.current\.setVoice\(voice\);/);

    // The language, in each of the three places that need it, also only here.
    for (const setter of [
      /ttsRef\.current\.setLanguage\(language\);/,
      /sttRef\.current\.setLanguage\(language\);/,
      /languageRef\.current = language;/,
      /chosenVoiceRef\.current = voice;/,
    ]) {
      assert.match(start, setter);
      const everywhere = SESSION.match(new RegExp(setter.source, 'g')) ?? [];
      assert.equal(everywhere.length, 1, `${setter} appears ${everywhere.length} times`);
    }
  });

  it('is carried by every sentence the trainer speaks, and every turn it writes', () => {
    assert.match(
      bodyOf(PLAYER, 'speakChunk'),
      /JSON\.stringify\(voice \? \{ text, voice \} : \{ text \}\)/,
    );
    assert.match(
      bodyOf(SESSION, 'runTurn'),
      /language: languageRef\.current,\s*voice: chosenVoiceRef\.current,/,
    );
  });

  it('is not changed by pausing or playing', () => {
    for (const name of ['pauseSession', 'resumeSession']) {
      assert.doesNotMatch(bodyOf(SESSION, name), /voice|language/i, name);
    }
  });

  it('cannot be reached from the running session: nothing hands out a way to change it', () => {
    const result = SESSION.slice(
      SESSION.indexOf('export interface UseTrainingSessionResult'),
      SESSION.indexOf('export interface ResumeState'),
    );
    assert.doesNotMatch(
      result,
      /setVoice|changeVoice|voice:\s*\(|setLanguage|changeLanguage|language:\s*\(/,
      'the session exposes a setter',
    );
  });

  it('is chosen only on the lobby, which a running session never returns to', () => {
    assert.match(SCREEN, /const showLobby = session\.phase === 'idle';/);
    const lobby = SCREEN.slice(
      SCREEN.indexOf('function Lobby('),
      SCREEN.indexOf('export function SessionScreen('),
    );
    assert.match(lobby, /<VoicePicker\s/, 'the picker moved out of the lobby');
    assert.equal((SCREEN.match(/<VoicePicker\s/g) ?? []).length, 1, 'a second picker appeared');
    // And no phase goes back to idle once started, anywhere in the app.
    for (const file of filesUnder('src')) {
      assert.doesNotMatch(
        readFileSync(file, 'utf8'),
        /setPhase\('idle'\)/,
        `${file} reopens the lobby`,
      );
    }
  });

  it('offers only a language the list has, so Hindi never starts with an English voice', () => {
    // The picker falls back to the first language when the chosen one is not offered,
    // and moves the voice to that language's default whenever the voice is not on it.
    assert.match(PICKER, /if \(current\.code !== language\) onLanguageChange\(current\.code\);/);
    assert.match(
      PICKER,
      /if \(!current\.voices\.some\(\(voice\) => voice\.id === value\)\) onChange\(current\.defaultVoiceId\);/,
    );
  });
});

describe('another provider, without reworking the screen', () => {
  it('the picker and its sample player name no provider and no voice', () => {
    for (const [name, source] of [
      ['VoicePicker', PICKER],
      ['useVoiceSample', SAMPLE],
    ] as const) {
      assert.doesNotMatch(
        source,
        /aura|deepgram|sarvam|bulbul|priya|shubh/i,
        `${name} knows which provider it is`,
      );
    }
  });

  it('the picker takes the catalogue as a type only, and the list from the API', () => {
    assert.match(PICKER, /import type \{ VoiceCatalogue \} from '@\/lib\/voice\/catalogue';/);
    assert.match(PICKER, /fetch\('\/api\/voices'\)/);
    assert.match(SAMPLE, /\/api\/voices\/sample\?voice=/);
  });

  it('only synthesise.ts calls a provider, so that is the one place to change', () => {
    for (const endpoint of ['/v1/speak', 'api.sarvam.ai']) {
      const callers = filesUnder('src').filter((f) => readFileSync(f, 'utf8').includes(endpoint));
      assert.deepEqual(
        callers.map((f) => f.replaceAll('\\', '/')),
        ['src/lib/voice/synthesise.ts'],
        endpoint,
      );
    }
    for (const route of [TTS_ROUTE, SAMPLE_ROUTE]) {
      assert.match(route, /voiceFor\(/);
      assert.match(route, /synthesise\(/);
    }
  });

  it('the sample says a fixed line, not whatever the browser sends', () => {
    // So it is not a second way to synthesise anything at all, and every voice is
    // heard saying the same thing.
    assert.match(SAMPLE_ROUTE, /synthesise\(sampleTextFor\(voice\), voice, request\.signal\)/);
    assert.doesNotMatch(SAMPLE_ROUTE, /searchParams\.get\('text'\)|request\.json\(\)/);
  });
});
