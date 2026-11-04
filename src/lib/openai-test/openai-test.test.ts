import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { mayUseOpenAiTest } from './access';
import {
  openAiFailure,
  speakWithOpenAi,
  transcribeWithDeepgram,
  transcribeWithOpenAi,
} from './providers';
import { voiceFor } from '../voice/catalogue';
import {
  deepgramLanguageFor,
  languageName,
  listeningChoice,
  MAX_INSTRUCTION_CHARS,
  MAX_TEST_CHARS,
  OPENAI_VOICES,
  openAiLanguageFor,
  parseSpeakRequest,
  resultsAsTable,
  SUGGESTED_INSTRUCTIONS,
  TEST_LANGUAGES,
  TEST_SENTENCES,
  todaysVoiceFor,
  type TestLanguage,
} from './samples';

/**
 * The OpenAI test, asked for on 7 October: available only to administrators, behind a
 * button of its own. "Administrators" is read as Technavious's own, never a customer's.
 *
 * Nothing here reaches OpenAI. Requests go to a stand-in, and the tests check what would
 * have been sent and what is made of the reply.
 */

const read = (path: string) => readFileSync(path, 'utf8');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe('who may use it', () => {
  it("is Technavious's own administrators and platform staff, and nobody at a customer", () => {
    assert.equal(
      mayUseOpenAiTest({ role: 'admin', platform: false, homeOrgId: 'technavious' }),
      true,
    );
    assert.equal(
      mayUseOpenAiTest({ role: 'admin', platform: true, homeOrgId: 'technavious' }),
      true,
    );
    // Platform staff looking inside a customer are still staff.
    assert.equal(mayUseOpenAiTest({ role: 'admin', platform: true, homeOrgId: 'acme' }), true);
    assert.equal(mayUseOpenAiTest({ role: 'admin', platform: false, homeOrgId: 'acme' }), false);
    assert.equal(
      mayUseOpenAiTest({ role: 'employee', platform: false, homeOrgId: 'technavious' }),
      false,
    );
    assert.equal(mayUseOpenAiTest({ role: 'admin', platform: false }), false);
  });

  it('refuses everybody else in both routes, before the body is read', () => {
    for (const route of [
      'src/app/api/openai-test/speak/route.ts',
      'src/app/api/openai-test/transcribe/route.ts',
    ]) {
      const source = read(route);
      const handler = source.slice(source.indexOf('export async function POST'));
      const refuse = handler.indexOf('if (!mayUseOpenAiTest(gate.person))');
      assert.ok(handler.indexOf('await checkUser()') >= 0 && refuse > 0, `${route} does not check`);
      for (const later of [
        'request.json()',
        'request.formData()',
        'speakWithOpenAi(',
        'transcribeWithOpenAi(',
      ]) {
        const at = handler.indexOf(later);
        if (at >= 0) assert.ok(at > refuse, `${route} reaches ${later} before refusing`);
      }
      assert.match(handler, /\{ error: 'Not found\.' \}, \{ status: 404 \}/);
    }
  });

  it('is refused on the page the same way, with a 404', () => {
    const page = read('src/app/openai-test/page.tsx');
    assert.match(page, /await requireAdminPage\('\/openai-test'\)/);
    assert.match(page, /if \(!mayUseOpenAiTest\(person\)\) notFound\(\);/);
  });

  it('has a button of its own, shown only to those who may use it', () => {
    const nav = read('src/components/MainNav.tsx');
    assert.match(
      nav,
      /if \(mayUseOpenAiTest\(person\)\) links\.push\(\{ href: '\/openai-test', label: 'OpenAI test' \}\);/,
    );
    const home = read('src/app/HomeForAdmin.tsx');
    assert.match(home, /\{mayUseOpenAiTest\(person\) && \(\s*<Link\s*href="\/openai-test"/);
    assert.match(home, />\s*OpenAI test\s*</);
  });

  it('is never reached from a training session', () => {
    for (const file of [
      ...filesUnder('src/hooks'),
      ...filesUnder('src/app/session'),
      'src/app/api/chat/route.ts',
      'src/app/api/tts/route.ts',
    ]) {
      assert.doesNotMatch(read(file), /openai-test|api\.openai\.com/, `${file} reaches OpenAI`);
    }
  });
});

describe('what it accepts', () => {
  it('offers the voices OpenAI lists for its speech model, recommended ones first', () => {
    assert.equal(OPENAI_VOICES.length, 13);
    assert.deepEqual(OPENAI_VOICES.slice(0, 2), ['marin', 'cedar']);
  });

  it('takes a sentence, a listed voice and an optional description', () => {
    assert.deepEqual(parseSpeakRequest({ text: '  Hello.  ', voice: 'coral' }), {
      text: 'Hello.',
      voice: 'coral',
    });
    assert.deepEqual(
      parseSpeakRequest({ text: 'Hello.', voice: 'cedar', instructions: ' Calm. ' }),
      {
        text: 'Hello.',
        voice: 'cedar',
        instructions: 'Calm.',
      },
    );
  });

  it('refuses anything else with a reason', () => {
    for (const bad of [
      null,
      'text',
      {},
      { text: '', voice: 'coral' },
      { text: 'Hi', voice: 'zeus' },
      { text: 'Hi' },
    ]) {
      assert.equal(typeof parseSpeakRequest(bad), 'string', JSON.stringify(bad));
    }
    assert.match(
      String(parseSpeakRequest({ text: 'x'.repeat(MAX_TEST_CHARS + 1), voice: 'coral' })),
      /under 1000/,
    );
    assert.match(
      String(parseSpeakRequest({ text: 'Hi', voice: 'coral', instructions: 'x'.repeat(401) })),
      /description/,
    );
  });

  it('has the same sentence in every language, technical terms in English', () => {
    for (const [code, sentence] of Object.entries(TEST_SENTENCES)) {
      for (const term of ['CDFA', 'HV/MV', 'UPS', 'data hall', 'chiller', 'N+1'])
        assert.ok(sentence.includes(term), `${term} missing from ${code}`);
    }
    assert.match(TEST_SENTENCES.hi, /[ऀ-ॿ]/);
    assert.match(TEST_SENTENCES.id, /^Selamat datang/);
  });

  it('offers the seven languages wanted next, each written in its own script', () => {
    assert.deepEqual(
      TEST_LANGUAGES.map((entry) => entry.code),
      ['en', 'hi', 'id', 'ar', 'ms', 'tl', 'vi', 'ta', 'te', 'mr'],
    );
    assert.equal(languageName('tl'), 'Filipino');
    assert.match(TEST_SENTENCES.ar, /\p{Script=Arabic}/u);
    assert.match(TEST_SENTENCES.ta, /\p{Script=Tamil}/u);
    assert.match(TEST_SENTENCES.te, /\p{Script=Telugu}/u);
    assert.match(TEST_SENTENCES.mr, /\p{Script=Devanagari}/u);
    // Malaysian words, so a voice that drifts into Indonesian can be heard doing it.
    assert.match(TEST_SENTENCES.ms, /^Selamat datang ke .*\bpencawang\b.*\brosak\b/);
    assert.match(TEST_SENTENCES.tl, /^Maligayang pagdating/);
    assert.match(TEST_SENTENCES.vi, /^Chào mừng/);
    // Marathi is not Hindi, though both are written in Devanagari.
    assert.notEqual(TEST_SENTENCES.mr, TEST_SENTENCES.hi);
  });

  it('suggests a local accent for every language, short enough to send', () => {
    for (const { code } of TEST_LANGUAGES) {
      const suggestion = SUGGESTED_INSTRUCTIONS[code];
      assert.ok(suggestion.length <= MAX_INSTRUCTION_CHARS, `${code} is too long`);
      assert.equal(
        typeof parseSpeakRequest({ text: 'Hi', voice: 'marin', instructions: suggestion }),
        'object',
        `${code} would be refused`,
      );
    }
    assert.match(SUGGESTED_INSTRUCTIONS.ar, /Gulf/);
    assert.match(SUGGESTED_INSTRUCTIONS.ms, /Malaysian.*not Indonesian/);
    assert.match(SUGGESTED_INSTRUCTIONS.tl, /Taglish/);
    assert.match(SUGGESTED_INSTRUCTIONS.vi, /Northern/);
  });

  it('listens the way a session does, naming Indonesian because the mixed mode lacks it', () => {
    assert.equal(listeningChoice('hi'), 'hi');
    assert.equal(listeningChoice('fr'), 'auto');
    assert.equal(listeningChoice(undefined), 'auto');
    assert.equal(openAiLanguageFor('auto'), undefined);
    assert.equal(openAiLanguageFor('id'), 'id');
    assert.equal(deepgramLanguageFor('auto'), 'multi');
    assert.equal(deepgramLanguageFor('hi'), 'multi');
    assert.equal(deepgramLanguageFor('en'), 'en');
    assert.equal(deepgramLanguageFor('id'), 'id');
  });

  it('accepts every new language, and nothing near one', () => {
    for (const code of ['ar', 'ms', 'tl', 'vi', 'ta', 'te', 'mr'] as const) {
      assert.equal(listeningChoice(code), code);
    }
    // Filipino is Tagalog to OpenAI, Whisper and Deepgram alike; nothing else is guessed.
    for (const near of ['fil', 'tg', 'AR', 'ar-AE', 'ms-MY', ' ta', 'auto', '', 7, null, {}]) {
      assert.equal(listeningChoice(near), 'auto', JSON.stringify(near));
    }
  });

  it('gives OpenAI the ISO 639-1 code for each, Tagalog for Filipino', () => {
    const expected: Record<TestLanguage, string> = {
      en: 'en',
      hi: 'hi',
      id: 'id',
      ar: 'ar',
      ms: 'ms',
      tl: 'tl',
      vi: 'vi',
      ta: 'ta',
      te: 'te',
      mr: 'mr',
    };
    for (const [code, iso] of Object.entries(expected)) {
      assert.equal(openAiLanguageFor(code as TestLanguage), iso);
    }
  });

  it("names every new language to Deepgram in Nova-3's own code, keeping Hindi mixed", () => {
    assert.equal(deepgramLanguageFor('ar'), 'ar');
    assert.equal(deepgramLanguageFor('ms'), 'ms');
    assert.equal(deepgramLanguageFor('tl'), 'tl');
    assert.equal(deepgramLanguageFor('vi'), 'vi');
    assert.equal(deepgramLanguageFor('ta'), 'ta');
    assert.equal(deepgramLanguageFor('te'), 'te');
    assert.equal(deepgramLanguageFor('mr'), 'mr');
    // Only Hindi and not knowing use the mixed mode, which covers none of the new ones.
    const mixed = TEST_LANGUAGES.filter(({ code }) => deepgramLanguageFor(code) === 'multi');
    assert.deepEqual(
      mixed.map(({ code }) => code),
      ['hi'],
    );
  });
});

describe("today's voice", () => {
  const sarvam = process.env.SARVAM_API_KEY;
  afterEach(() => {
    if (sarvam === undefined) delete process.env.SARVAM_API_KEY;
    else process.env.SARVAM_API_KEY = sarvam;
  });

  it('is Deepgram for English and Sarvam for Hindi, both voices the app really offers', () => {
    process.env.SARVAM_API_KEY = 'test-sarvam-key';
    const english = todaysVoiceFor('en', true);
    const hindi = todaysVoiceFor('hi', true);
    assert.ok(english.ok && hindi.ok);
    assert.equal(english.label, 'Deepgram Thalia');
    assert.equal(hindi.label, 'Sarvam Priya');
    assert.ok(voiceFor(english.voice), `${english.voice} is not offered`);
    assert.ok(voiceFor(hindi.voice), `${hindi.voice} is not offered`);
  });

  it('has no Hindi to compare against where Sarvam is switched off, and says so', () => {
    const hindi = todaysVoiceFor('hi', false);
    assert.ok(!hindi.ok);
    assert.match(hindi.reason, /not switched on/);
  });

  it('is unavailable for every other language, with a plain reason rather than an error', () => {
    for (const code of ['id', 'ar', 'ms', 'tl', 'vi'] as const) {
      for (const hindi of [true, false]) {
        const today = todaysVoiceFor(code, hindi);
        assert.ok(!today.ok, `${code} should have no voice today`);
        assert.ok(today.reason.includes(languageName(code)), `${code} reason does not name it`);
        // Written as a code, so the house rule against the character holds in this file too.
        const dash = String.fromCharCode(0x2014);
        assert.ok(!today.reason.includes(dash), `${code} reason has a long dash`);
      }
    }
    assert.match((todaysVoiceFor('ar', true) as { reason: string }).reason, /Indian languages/);
  });

  it('compares Tamil, Telugu and Marathi with the Sarvam voice the trainer now uses', () => {
    assert.deepEqual(todaysVoiceFor('ta', true), {
      ok: true,
      voice: 'sarvam-ta-ishita',
      label: 'Sarvam Ishita',
    });
    assert.equal((todaysVoiceFor('te', true) as { voice: string }).voice, 'sarvam-te-neha');
    assert.equal((todaysVoiceFor('mr', true) as { voice: string }).voice, 'sarvam-mr-priya');
    assert.equal(todaysVoiceFor('mr', false).ok, false);
  });
});

describe('the results log', () => {
  const at = new Date(2026, 10, 1, 9, 5, 7);

  it('pastes as one tab-separated row per test, under a header', () => {
    const table = resultsAsTable([
      {
        kind: 'speech',
        at,
        language: 'ar',
        voice: 'OpenAI marin',
        instructions: 'Gulf accent.',
        firstSoundMs: 640,
        seconds: 9.24,
      },
      {
        kind: 'listening',
        at,
        language: 'tl',
        openai: { text: 'Kumusta', ms: 900 },
        deepgram: { error: 'Deepgram failed (400).', ms: 300 },
      },
      { kind: 'speech', at, language: 'te', voice: 'OpenAI cedar', error: 'Failed with 502.' },
      {
        kind: 'listening',
        at,
        language: 'auto',
        openai: { text: '', ms: 800 },
        deepgram: { text: 'hello', ms: 400 },
      },
    ]);
    const rows = table.split('\n').map((row) => row.split('\t'));
    assert.equal(rows.length, 5);
    assert.ok(rows.every((row) => row.length === rows[0]!.length));
    assert.deepEqual(rows[0]!.slice(0, 3), ['Time', 'Test', 'Language']);
    assert.deepEqual(rows[1], [
      '09:05:07',
      'Speaking',
      'Arabic',
      'OpenAI marin',
      'Gulf accent.',
      '640',
      '9.2',
      '',
      '',
      '',
      '',
      '',
    ]);
    assert.deepEqual(rows[2]!.slice(1, 3), ['Listening', 'Filipino']);
    assert.deepEqual(rows[2]!.slice(7, 11), [
      'Kumusta',
      '900',
      '(failed: Deepgram failed (400).)',
      '300',
    ]);
    assert.equal(rows[3]!.at(-1), 'Failed with 502.');
    assert.equal(rows[4]![2], 'Not said');
    assert.equal(rows[4]![7], '(heard nothing)');
  });

  it('keeps a transcript with tabs or line breaks in one cell', () => {
    const table = resultsAsTable([
      {
        kind: 'listening',
        at,
        language: 'ar',
        openai: { text: 'سطر\tأول\nسطر ثانٍ', ms: 1 },
        deepgram: { text: 'x', ms: 1 },
      },
    ]);
    const lines = table.split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[1]!.split('\t')[7], 'سطر أول سطر ثانٍ');
  });

  it('is only a header before anything has been tried', () => {
    assert.equal(resultsAsTable([]).split('\n').length, 1);
  });
});

describe('what it sends', () => {
  const realFetch = globalThis.fetch;
  const keys = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
  };
  let calls: Array<{ url: string; init: RequestInit }> = [];
  let reply: () => Response = () => new Response(null);

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.DEEPGRAM_API_KEY = 'test-deepgram-key';
    calls = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return reply();
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const [name, value] of Object.entries(keys)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('asks OpenAI for raw 24 kHz samples, the format the session player plays', async () => {
    reply = () => new Response(new Uint8Array([0, 0, 1, 0]));
    const result = await speakWithOpenAi({
      text: 'Namaste.',
      voice: 'marin',
      instructions: 'Calm.',
    });
    assert.equal(result.ok, true);
    assert.equal(calls[0]!.url, 'https://api.openai.com/v1/audio/speech');
    assert.equal(
      (calls[0]!.init.headers as Record<string, string>).Authorization,
      'Bearer test-openai-key',
    );
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
      model: 'gpt-4o-mini-tts',
      voice: 'marin',
      input: 'Namaste.',
      instructions: 'Calm.',
      response_format: 'pcm',
    });
  });

  it('says plainly when OpenAI is not connected, and asks nothing', async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await speakWithOpenAi({ text: 'Hi.', voice: 'marin' });
    assert.ok(!result.ok);
    assert.match(result.error, /OPENAI_API_KEY is not set/);
    assert.equal(calls.length, 0);
  });

  it('sends one recording to both, each told the language its own way', async () => {
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm;codecs=opus' });
    reply = () =>
      Response.json({
        text: ' heard it ',
        results: { channels: [{ alternatives: [{ transcript: ' heard it ' }] }] },
      });

    const openai = await transcribeWithOpenAi(audio, 'hi');
    assert.deepEqual({ text: 'text' in openai ? openai.text : null }, { text: 'heard it' });
    const form = calls[0]!.init.body as FormData;
    assert.equal(calls[0]!.url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(form.get('model'), 'gpt-4o-transcribe');
    assert.equal(form.get('language'), 'hi');
    assert.equal((form.get('file') as File).name, 'speech.webm');

    await transcribeWithDeepgram(audio, 'hi');
    const deepgram = new URL(calls[1]!.url);
    assert.equal(deepgram.origin + deepgram.pathname, 'https://api.deepgram.com/v1/listen');
    assert.equal(deepgram.searchParams.get('language'), 'multi');
    assert.equal(
      (calls[1]!.init.headers as Record<string, string>)['Content-Type'],
      'audio/webm;codecs=opus',
    );

    await transcribeWithOpenAi(audio, 'auto');
    assert.equal(
      (calls[2]!.init.body as FormData).get('language'),
      null,
      'auto should let OpenAI detect it',
    );
  });

  it('names a new language to each service, Filipino as Tagalog', async () => {
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
    reply = () => Response.json({ text: 'ok' });

    for (const [code, expected] of [
      ['tl', 'tl'],
      ['ar', 'ar'],
      ['te', 'te'],
    ] as const) {
      calls = [];
      await transcribeWithOpenAi(audio, code);
      await transcribeWithDeepgram(audio, code);
      assert.equal((calls[0]!.init.body as FormData).get('language'), expected);
      assert.equal(new URL(calls[1]!.url).searchParams.get('language'), expected);
    }
  });
});

describe('what a failure says', () => {
  const body = (code: string, message = 'x') => JSON.stringify({ error: { code, message } });

  it('tells an empty account from a busy one, though both are 429', () => {
    assert.match(openAiFailure(429, body('insufficient_quota')), /no credit left/);
    assert.match(openAiFailure(429, body('rate_limit_exceeded')), /fewer requests/);
  });

  it('knows an empty account by its words too, as production first reported it', () => {
    // Exactly what came back on 7 October: a 429 with no code to go on.
    const reply = JSON.stringify({
      error: {
        message:
          'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.',
        type: null,
        code: null,
      },
    });
    const said = openAiFailure(429, reply);
    assert.match(said, /^The OpenAI account has no credit left\./);
    assert.doesNotMatch(said, /fewer requests/);
  });

  it('points at the key when OpenAI refuses it, and keeps its own words', () => {
    const said = openAiFailure(401, body('invalid_api_key', 'Incorrect API key provided'));
    assert.match(said, /OPENAI_API_KEY/);
    assert.match(said, /OpenAI said: "Incorrect API key provided" \(HTTP 401\)\.$/);
  });
});
