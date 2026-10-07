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
import {
  deepgramLanguageFor,
  listeningChoice,
  MAX_TEST_CHARS,
  OPENAI_VOICES,
  openAiLanguageFor,
  parseSpeakRequest,
  TEST_SENTENCES,
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

  it('has the same sentence in all three languages, technical terms in English', () => {
    for (const sentence of Object.values(TEST_SENTENCES)) {
      for (const term of ['CDFA', 'HV/MV', 'UPS', 'N+1'])
        assert.ok(sentence.includes(term), `${term} missing`);
    }
    assert.match(TEST_SENTENCES.hi, /[ऀ-ॿ]/);
    assert.match(TEST_SENTENCES.id, /^Selamat datang/);
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
