import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { AUDIO_SAMPLE_RATE } from './config';
import { getSlide } from './deck';
import { ISMS_DECK } from './decks/isms';
import { codeFor } from './failures/classify';
import { FAILURE_MESSAGES } from './failures/codes';
import { listeningLanguage } from './language';
import { LANGUAGES, languageInfo, pacedToPlayback, spokenBySarvam } from './languages';
import { OPENAI_VOICES, SUGGESTED_INSTRUCTIONS } from './openai-test/samples';
import { nextSpeechCut } from './speech';
import { closingSentence } from './trainee-read';
import { buildSystemInstruction, buildTurnPrompt } from './trainer-prompt';
import type { SessionLanguage } from './types';
import {
  canSpeak,
  languagesFor,
  sampleTextFor,
  speaksAsFor,
  voiceCatalogue,
  voiceFor,
} from './voice/catalogue';
import { synthesise } from './voice/synthesise';

/**
 * Arabic for the UAE, Malay, Indonesian, Filipino and Vietnamese in live sessions, spoken
 * by OpenAI's gpt-4o-mini-tts and offered to Technavious staff only until Shafi signs each
 * off (AI-15, BRD v2.3).
 *
 * Nothing here reaches OpenAI. Every request goes to a stand-in, and the tests check what
 * would have been sent and what is made of the reply.
 */

const NEW: readonly SessionLanguage[] = ['ar', 'ms', 'id', 'tl', 'vi'];

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const before = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    run();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** A deployment with the OpenAI key and without Sarvam's. Never a real key. */
const withOpenAi = (run: () => void, everyone?: string) =>
  withEnv(
    { OPENAI_API_KEY: 'test-key', SARVAM_API_KEY: undefined, LANGUAGES_FOR_EVERYONE: everyone },
    run,
  );

const staff = { platform: false, homeOrgId: 'technavious' };
const customer = { platform: false, homeOrgId: 'acme' };
const codes = (list: readonly { code: string }[]) => list.map((language) => language.code);

describe('the five OpenAI languages in the registry', () => {
  it('follow the Indian languages, in the order the BRD lists them', () => {
    assert.deepEqual(codes(LANGUAGES).slice(-5), NEW);
  });

  it('are named in their own script, with Filipino as tl, as the test page has it', () => {
    assert.deepEqual(
      NEW.map((code) => languageInfo(code).name),
      ['العربية', 'Bahasa Melayu', 'Bahasa Indonesia', 'Filipino', 'Tiếng Việt'],
    );
    assert.equal(languageInfo('tl').englishName, 'Filipino');
  });

  it("listen in Nova-3's own model for each, by the code the test page uses", () => {
    for (const code of NEW) assert.equal(listeningLanguage(code), code, code);
  });

  it('are spoken by OpenAI, with the accent the test page suggests, and never by Sarvam', () => {
    for (const code of NEW) {
      const info = languageInfo(code);
      assert.ok(info.openai, code);
      assert.equal(info.sarvam, undefined, code);
      assert.equal(info.openai.instructions, SUGGESTED_INSTRUCTIONS[code as 'ar'], code);
      assert.equal(spokenBySarvam(code), false, code);
    }
    assert.match(languageInfo('ar').openai!.instructions, /Gulf accent, as spoken in the UAE/);
    assert.match(languageInfo('ms').openai!.instructions, /Malaysian Malay.*not Indonesian/);
    assert.match(languageInfo('vi').openai!.instructions, /Northern accent/);
  });

  it("offer two or three of OpenAI's own voices, a woman's and a man's among them", () => {
    for (const code of NEW) {
      const voices = languageInfo(code).openai!.voices;
      assert.ok(voices.length >= 2 && voices.length <= 3, code);
      for (const { voice } of voices) assert.ok(OPENAI_VOICES.includes(voice), voice);
      const sounds = new Set(voices.map((voice) => voice.speaksAs));
      assert.deepEqual([...sounds].sort(), ['feminine', 'masculine'], code);
    }
  });

  it('fetch ahead as English does, because OpenAI is billed as used, not prepaid', () => {
    for (const code of NEW) assert.equal(pacedToPlayback(code), false, code);
    // And Sarvam's languages are still paced, every one of them.
    assert.equal(pacedToPlayback('hi'), true);
    assert.equal(pacedToPlayback('ta'), true);
  });

  it('keep the technical terms in English in every register example and sample', () => {
    for (const code of NEW) {
      const info = languageInfo(code);
      const register = info.register!;
      for (const term of ['slide', 'data centre', 'HV/MV', 'UPS']) {
        assert.ok(register.good.includes(term), `${code} register lacks ${term}`);
      }
      assert.ok(info.openai!.sample.includes('training session'), code);
      assert.ok(register.outsideIndia, code);
      assert.ok(info.note, code);
      // Written as a code, so the house rule against the character holds in this file too.
      const dash = String.fromCharCode(0x2014);
      assert.ok(!JSON.stringify(info).includes(dash), `${code} has a long dash`);
    }
  });

  it('write Arabic in Arabic script, and the rest in Latin letters', () => {
    assert.equal(languageInfo('ar').register!.outsideIndia!.script, 'arabic');
    assert.match(languageInfo('ar').register!.good, /\p{Script=Arabic}/u);
    for (const code of ['ms', 'id', 'tl', 'vi'] as const) {
      assert.equal(languageInfo(code).register!.outsideIndia!.script, 'latin', code);
      assert.doesNotMatch(languageInfo(code).register!.good, /\p{Script=Arabic}/u, code);
    }
  });

  it('mark the speaker in Arabic only, and give Vietnamese a neutral "I"', () => {
    assert.equal(languageInfo('ar').register!.gendered, true);
    assert.ok(languageInfo('ar').register!.outsideIndia!.self);
    for (const code of ['ms', 'id', 'tl', 'vi'] as const) {
      assert.equal(languageInfo(code).register!.gendered, false, code);
    }
    assert.equal(languageInfo('vi').register!.outsideIndia!.me, 'tôi');
  });
});

describe('who is offered the OpenAI languages', () => {
  it('nobody without the OpenAI key, not even Technavious', () => {
    withEnv({ OPENAI_API_KEY: undefined, SARVAM_API_KEY: undefined }, () => {
      assert.deepEqual(codes(languagesFor(staff)), ['en']);
    });
  });

  it('Technavious staff with it, and no customer while they are in testing', () => {
    withOpenAi(() => {
      assert.deepEqual(codes(languagesFor(staff)), ['en', ...NEW]);
      assert.deepEqual(codes(languagesFor({ platform: true, homeOrgId: 'acme' })), ['en', ...NEW]);
      assert.deepEqual(codes(languagesFor(customer)), ['en']);
    });
  });

  it('everyone, once a language is listed as signed off', () => {
    withOpenAi(() => {
      assert.deepEqual(codes(languagesFor(customer)), ['en', 'ar']);
    }, 'en,hi,ar');
  });

  it('marked in testing in the catalogue, with the accent beside each voice', () => {
    withOpenAi(() => {
      const arabic = voiceCatalogue(staff).languages.find((option) => option.code === 'ar')!;
      assert.equal(arabic.testing, true);
      assert.deepEqual(
        arabic.voices.map((voice) => [voice.name, voice.accent]),
        [
          ['Marin', 'Gulf Arabic'],
          ['Cedar', 'Gulf Arabic'],
          ['Coral', 'Gulf Arabic'],
        ],
      );
      assert.ok(arabic.voices.some((voice) => voice.id === arabic.defaultVoiceId));
      // The screen still learns nothing about the provider or its instructions.
      for (const voice of arabic.voices) {
        assert.deepEqual(Object.keys(voice).sort(), ['accent', 'description', 'id', 'name']);
      }
    });
  });

  it("refuses an OpenAI language's voice to a customer, on the server", () => {
    withOpenAi(() => {
      assert.equal(voiceFor('openai-ar-marin', customer), null);
      assert.equal(speaksAsFor('openai-ar-marin', customer), undefined);
      assert.deepEqual(voiceFor('openai-ar-marin', staff), {
        provider: 'openai',
        model: 'marin',
        instructions: SUGGESTED_INSTRUCTIONS.ar,
        language: 'ar',
      });
    });
  });

  it('refuses it everywhere once the key is gone', () => {
    withEnv({ OPENAI_API_KEY: undefined }, () => {
      assert.equal(voiceFor('openai-vi-cedar', staff), null);
    });
  });

  it('refuses a voice OpenAI has but this language does not offer', () => {
    withOpenAi(() => {
      assert.equal(voiceFor('openai-ar-onyx', staff), null);
      assert.equal(voiceFor('openai-xx-marin', staff), null);
    });
  });

  it('knows which voices speak as a woman and which as a man', () => {
    withOpenAi(() => {
      assert.equal(speaksAsFor('openai-ar-marin', staff), 'feminine');
      assert.equal(speaksAsFor('openai-ar-cedar', staff), 'masculine');
    });
  });

  it("plays each language's own sample, and never refuses its script", () => {
    withOpenAi(() => {
      for (const code of NEW) {
        const voice = voiceFor(`openai-${code}-marin`, staff)!;
        assert.equal(sampleTextFor(voice), languageInfo(code).openai!.sample, code);
        assert.equal(canSpeak(voice, languageInfo(code).openai!.sample), true, code);
      }
    });
  });
});

type Call = { url: string; init: RequestInit };

describe('asking OpenAI for a session sentence', () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.OPENAI_API_KEY;
  let calls: Call[] = [];
  let reply: () => Response = () => new Response(null);

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    calls = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return reply();
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = realKey;
  });

  const arabic = () => ({
    provider: 'openai' as const,
    model: 'marin',
    instructions: SUGGESTED_INSTRUCTIONS.ar,
    language: 'ar' as const,
  });
  const error = (status: number, code: string | null, message: string) => () =>
    Response.json({ error: { code, type: 'requests', message } }, { status });

  it('sends the voice and its instructions, and asks for raw 24 kHz PCM', async () => {
    reply = () => new Response(new Uint8Array([0, 0, 1, 0]));
    const result = await synthesise('هل هذا واضح؟', arabic());
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, 'https://api.openai.com/v1/audio/speech');
    assert.equal(
      (calls[0]!.init.headers as Record<string, string>).Authorization,
      'Bearer test-key',
    );
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
      model: 'gpt-4o-mini-tts',
      voice: 'marin',
      input: 'هل هذا واضح؟',
      instructions: SUGGESTED_INSTRUCTIONS.ar,
      response_format: 'pcm',
    });
  });

  it('hands back the samples as PCM, at the rate the player runs at', async () => {
    reply = () => new Response(new Uint8Array([1, 2, 3, 4]));
    const result = await synthesise('Selamat datang.', { ...arabic(), language: 'ms' as const });
    assert.ok(result.ok);
    assert.equal(result.format, 'pcm');
    // OpenAI fixes its `pcm` at 24 kHz; the player must run at the same.
    assert.equal(AUDIO_SAMPLE_RATE, 24_000);
  });

  it('stays PCM even when MP3 is asked for', async () => {
    reply = () => new Response(new Uint8Array([1, 2]));
    const result = await synthesise('Xin chào.', arabic(), undefined, { compressed: true });
    assert.ok(result.ok);
    assert.equal(result.format, 'pcm');
    assert.equal(JSON.parse(String(calls[0]!.init.body)).response_format, 'pcm');
  });

  it('asks for nothing without a key, and calls it not configured', async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await synthesise('Halo.', arabic());
    assert.ok(!result.ok);
    assert.equal(result.failure?.kind, 'not_configured');
    assert.equal(result.failure?.provider, 'openai');
    assert.equal(calls.length, 0);
  });

  it('reads an empty account as out of credit, though OpenAI sends it as a 429', async () => {
    reply = error(429, 'insufficient_quota', 'You exceeded your current quota.');
    const result = await synthesise('Halo.', arabic());
    assert.ok(!result.ok);
    assert.equal(result.failure?.kind, 'out_of_credit');
    assert.match(result.error, /no credit left/);
    assert.equal(calls.length, 1, 'an empty account was asked twice');

    reply = error(429, null, 'You have no credits remaining.');
    const worded = await synthesise('Halo.', arabic());
    assert.equal(!worded.ok && worded.failure?.kind, 'out_of_credit');
  });

  it('tells busy, a refused key and a server error apart', async () => {
    reply = error(429, 'rate_limit_exceeded', 'Rate limit reached for requests.');
    const busy = await synthesise('Halo.', arabic());
    assert.equal(!busy.ok && busy.failure?.kind, 'rate_limited');

    reply = error(401, 'invalid_api_key', 'Incorrect API key provided.');
    const key = await synthesise('Halo.', arabic());
    assert.equal(!key.ok && key.failure?.kind, 'bad_key');
    assert.match(!key.ok ? key.error : '', /OPENAI_API_KEY/);

    reply = error(500, null, 'The server had an error.');
    const down = await synthesise('Halo.', arabic());
    assert.equal(!down.ok && down.failure?.kind, 'upstream_error');
  });

  it('calls a failed connection unreachable, and an interruption silent', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const unreachable = await synthesise('Halo.', arabic());
    assert.equal(!unreachable.ok && unreachable.failure?.kind, 'unreachable');

    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = (async () => {
      throw new DOMException('aborted', 'AbortError');
    }) as typeof fetch;
    const cancelled = await synthesise('Halo.', arabic(), controller.signal);
    assert.deepEqual(cancelled, { ok: false, status: 499, error: '' });
  });

  it("shows a trainee only the standard message, never OpenAI's words", async () => {
    reply = error(429, 'insufficient_quota', 'You exceeded your current quota.');
    const result = await synthesise('Halo.', arabic());
    assert.ok(!result.ok && result.failure);
    const { code } = codeFor(result.failure.kind);
    assert.doesNotMatch(FAILURE_MESSAGES[code], /openai|credit|quota/i);
  });
});

describe('the trainer speaking each OpenAI language', () => {
  const deck = ISMS_DECK;
  let captured = '';
  const instruction = (language: SessionLanguage, voice?: string) => {
    withOpenAi(() => {
      captured = buildSystemInstruction(deck, 'Asha', {
        language,
        speaksAs: voice ? speaksAsFor(voice, staff) : undefined,
      });
    });
    return captured;
  };
  const reminder = (language: SessionLanguage) =>
    buildTurnPrompt({
      deck,
      kind: 'narrate',
      slide: getSlide(deck, 2)!,
      history: [],
      coveredSlideIds: [],
      language,
    });

  it('gives each its own block, with its register, its country and its "you"', () => {
    const where = { ar: 'the UAE', ms: 'Malaysia', id: 'Indonesia', tl: 'the Philippines' };
    for (const code of NEW) {
      const info = languageInfo(code);
      const text = instruction(code);
      assert.ok(text.includes(`SPEAK ${info.englishName.toUpperCase()}\n`), code);
      assert.ok(text.includes(info.register!.good), code);
      assert.ok(text.includes(info.register!.bad), code);
      assert.ok(text.includes(`Address them as ${info.register!.you},`), code);
      assert.ok(text.includes(info.register!.check), code);
      assert.doesNotMatch(text, /at work in India/, code);
      const country = where[code as keyof typeof where] ?? 'Vietnam';
      assert.ok(text.includes(`at work in ${country}:`), code);
    }
    assert.match(instruction('ar'), /in an Arabic voice/);
    assert.match(instruction('id'), /in an Indonesian voice/);
    assert.match(instruction('ms'), /in a Malay voice/);
  });

  it('keeps English terms spelled as English in the Latin-script languages', () => {
    const text = instruction('ms');
    assert.match(text, /Malay and English are both written in Latin letters/);
    assert.match(text, /as in slaid, pusat data, pelayan, sesi latihan\./);
    assert.doesNotMatch(text, /Malay script/);
    assert.match(reminder('tl'), /IN FILIPINO\nSay all of this in everyday spoken Filipino/);
    assert.match(reminder('tl'), /spelled as English spells it and never translated/);
  });

  it('writes Arabic in Arabic script, with its own comma and question mark', () => {
    const text = instruction('ar');
    assert.match(text, /Write Arabic words in Arabic script and English words in English letters/);
    assert.match(text, /، for a comma and ؟ to end a question/);
    assert.match(text, /Write figures as the digits 0 to 9/);
    assert.match(reminder('ar'), /IN ARABIC\n.*Arabic words in Arabic script/);
  });

  it('agrees Arabic with the voice, and avoids the question without one', () => {
    assert.match(
      instruction('ar', 'openai-ar-marin'),
      /Your voice in this session is a woman's\. Arabic marks your gender.*أنا سعيدة/,
    );
    assert.match(
      instruction('ar', 'openai-ar-cedar'),
      /Your voice in this session is a man's\. Arabic marks your gender.*أنا سعيد،/,
    );
    assert.match(instruction('ar'), /does not mark your gender/);
    // Nothing about the speaker in a language that does not mark it.
    assert.doesNotMatch(instruction('ms', 'openai-ms-marin'), /woman's|man's/);
  });

  it('has Vietnamese call itself tôi', () => {
    assert.match(instruction('vi'), /Call yourself tôi, which marks neither your gender nor/);
    assert.doesNotMatch(instruction('id'), /Call yourself/);
  });

  it('is told the voice by the chat route for Arabic, as for Hindi and Marathi', () => {
    const route = readFileSync('src/app/api/chat/route.ts', 'utf8');
    assert.match(route, /languageInfo\(language\)\.register\?\.gendered \|\| language === 'hi'/);
  });

  it("leaves every existing language's instruction and reminders exactly as they were", () => {
    // One hash over every earlier language's instruction, in each voice, and its turn
    // prompts, recorded before these five were added. A tripwire: if it fails, something
    // shared changed, and the new hash belongs here only once that change is meant.
    const earlier: SessionLanguage[] = [
      'en',
      'en-IN',
      'hi',
      'mr',
      'ta',
      'te',
      'kn',
      'ml',
      'bn',
      'gu',
    ];
    const parts: string[] = [];
    for (const language of earlier) {
      for (const speaksAs of [undefined, 'feminine', 'masculine'] as const) {
        parts.push(buildSystemInstruction(deck, 'Asha', { language, speaksAs }));
      }
      parts.push(reminder(language));
      parts.push(
        buildTurnPrompt({
          deck,
          kind: 'answer',
          slide: getSlide(deck, 2)!,
          history: [],
          question: 'What is a UPS?',
          coveredSlideIds: [1, 2],
          language,
        }),
      );
    }
    const sha = createHash('sha256').update(parts.join('\n\u0000\n')).digest('hex');
    assert.equal(sha, 'b1ca7f5cec9d4d8fd72dd1c91c21f2c835da1f83e057f99b7e31f4438c3fd33c');
  });
});

describe('cutting Arabic into sentences', () => {
  it('ends a sentence at an Arabic question mark', () => {
    const first = 'هل تعرفون ما هو الـ UPS وكيف يحمي الـ racks عندما تنقطع الـ power؟';
    const cut = nextSpeechCut(`${first} سنرى ذلك الآن.`);
    assert.equal(cut, first.length);
  });

  it('finds the last Arabic sentence as the closing', () => {
    assert.equal(closingSentence('هذا مهم جدًا؟ ما رأيكم؟'), 'ما رأيكم؟');
  });
});

describe('the lobby picker', () => {
  it('lets Arabic names and notes read right to left', () => {
    const picker = readFileSync('src/components/VoicePicker.tsx', 'utf8');
    assert.match(picker, /lang=\{option\.code\} dir="auto"/);
    assert.match(picker, /leading-relaxed" dir="auto">\s*\{current\.note/);
  });
});
