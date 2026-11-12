import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { streamedSeconds } from './usage/streamed';

/**
 * Facilitator-only audio, and no audio kept anywhere (BRD v2.3 AI-45).
 *
 * Read from the source rather than run, because what matters is where the code can send
 * a recording at all, and a browser microphone cannot be exercised here. Each check names
 * the one place a change would have to be made to break the rule, so a failure here is a
 * question for whoever made it rather than a test to update.
 */

// Line endings normalised, because a Windows checkout has CRLF and the patterns below
// anchor on the end of a line.
const read = (path: string) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');

/** The source with comments removed, so prose about audio does not count as code. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name).replaceAll('\\', '/');
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

const SOURCES = sourceFiles('src');

/** Files that use a module at run time; a type-only import cannot open anything. */
function usersOf(module: RegExp): string[] {
  return SOURCES.filter((path) =>
    code(path)
      .split('\n')
      .some((line) => /^import\s+(?!type\b)/.test(line) && module.test(line)),
  ).sort();
}

describe('only the facilitator device records in a trainer-led session (AI-45)', () => {
  it('asks for the microphone in two places only, and one is a staff-only test page', () => {
    const asking = SOURCES.filter((path) => /getUserMedia/.test(code(path))).sort();
    assert.deepEqual(asking, ['src/app/openai-test/OpenAiTest.tsx', 'src/hooks/useMicCapture.ts']);
    assert.match(
      read('src/app/openai-test/page.tsx'),
      /if \(!mayUseOpenAiTest\(person\)\) notFound/,
    );
  });

  it('reaches the microphone only from the one-to-one session and the facilitator screen', () => {
    assert.deepEqual(usersOf(/useMicCapture/), ['src/hooks/useSpeechInput.ts']);
    assert.deepEqual(usersOf(/useSpeechInput/), [
      'src/app/sessions/[id]/run/FacilitatorScreen.tsx',
      'src/hooks/useTrainingSession.ts',
    ]);
    assert.deepEqual(usersOf(/useTrainingSession/), ['src/app/session/SessionScreen.tsx']);
    assert.deepEqual(usersOf(/\/SessionScreen'/), ['src/app/session/page.tsx']);
    assert.deepEqual(usersOf(/\/FacilitatorScreen'/), ['src/app/sessions/[id]/run/page.tsx']);
  });

  it("keeps a participant's own pages away from the microphone", () => {
    // Home, the assessments and feedback are where a participant goes on their own device.
    for (const dir of ['src/app/assessment', 'src/app/feedback', 'src/app/profile']) {
      for (const path of sourceFiles(dir)) {
        assert.doesNotMatch(code(path), /useSpeechInput|useMicCapture|getUserMedia/, path);
      }
    }
    for (const path of ['src/app/page.tsx', 'src/app/HomeForTrainee.tsx']) {
      assert.doesNotMatch(code(path), /useSpeechInput|useMicCapture|getUserMedia/, path);
    }
  });

  it('opens the facilitator screen to its facilitator and administrators only', () => {
    const page = code('src/app/sessions/[id]/run/page.tsx');
    assert.match(page, /if \(!mayRunSessions\(me\)\) notFound\(\);/);
    assert.match(page, /!mayManageSession\(me, session\)/);
  });

  it('sends a trainer-led participant home from the one-to-one session for that deck', () => {
    const page = code('src/app/session/page.tsx');
    assert.match(page, /sessionsListing\(person\)/);
    assert.match(page, /session\.deckId === deckId/);
    assert.match(page, /if \(inTheRoom\) redirect\('\/'\);/);
    // Before the screen that opens the microphone is rendered.
    assert.ok(page.indexOf("redirect('/')") < page.indexOf('<SessionScreen'));
  });

  it('closes the microphone when the question is heard and when control is taken back', () => {
    const screen = code('src/app/sessions/[id]/run/FacilitatorScreen.tsx');
    const takeBack = screen.slice(
      screen.indexOf('const takeBack'),
      screen.indexOf('const handOver'),
    );
    assert.match(takeBack, /sttRef\.current\?\.stop\(\)/);
    const heard = screen.slice(screen.indexOf('onUtterance'), screen.indexOf('onError'));
    assert.match(heard, /sttRef\.current\?\.stop\(\)/);
    assert.match(screen, /useEffect\(\(\) => \(\) => takeBack\(\), \[takeBack\]\)/);
    // Stopping the hook stops the capture, and stopping the capture stops every track.
    assert.match(code('src/hooks/useSpeechInput.ts'), /micRef\.current\.stop\(\)/);
    assert.match(
      code('src/hooks/useMicCapture.ts'),
      /streamRef\.current\?\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/,
    );
  });

  it('shows whether the microphone is open, in words and announced', () => {
    const indicator = code('src/components/MicIndicator.tsx');
    assert.match(indicator, /role="status"/);
    assert.match(indicator, /aria-live="polite"/);
    assert.match(indicator, /Microphone on: \$\{TRAINER_NAME\} is listening/);
    assert.match(indicator, /'Microphone off'/);
    assert.match(indicator, /const on = state === 'live'/);
    assert.match(
      code('src/app/sessions/[id]/run/FacilitatorScreen.tsx'),
      /<MicIndicator state=\{stt\.state\}/,
    );
    assert.match(code('src/components/TrainerPanel.tsx'), /<MicIndicator state=\{micState\}/);
  });
});

describe('no audio is stored anywhere (AI-45)', () => {
  it('uses the uploaded utterance only to size it and pass it to Deepgram', () => {
    const route = code('src/app/api/stt/route.ts');
    const uses = route.split('\n').filter((line) => /\baudio\b/.test(line));
    assert.ok(uses.length >= 4, 'the route should still be reading the audio as audio');
    const allowed = [
      /const audio = await request\.arrayBuffer\(\)/,
      /if \(!audio\)/,
      /audio\.byteLength/,
      /^\s*body: audio,$/,
    ];
    for (const line of uses) {
      assert.ok(
        allowed.some((pattern) => pattern.test(line)),
        `/api/stt uses the audio somewhere new: ${line.trim()}`,
      );
    }
    // The one place the bytes go is Deepgram.
    assert.match(route, /new URL\('https:\/\/api\.deepgram\.com\/v1\/listen'\)/);
  });

  it('gives the speech routes nothing that could write the bytes down', () => {
    for (const path of [
      'src/app/api/stt/route.ts',
      'src/app/api/deepgram/token/route.ts',
      'src/app/api/usage/stt/route.ts',
      'src/app/api/openai-test/transcribe/route.ts',
      'src/lib/openai-test/providers.ts',
    ]) {
      const source = code(path);
      assert.doesNotMatch(
        source,
        /@vercel\/blob|node:fs|firebase|\/documents'|devlog|writeFile|console\.(log|info|warn|error)/,
        path,
      );
    }
  });

  it('records seconds of audio for usage, never the audio', () => {
    const route = code('src/app/api/stt/route.ts');
    const metered = route.slice(
      route.indexOf('recordQuietly('),
      route.indexOf('});', route.indexOf('recordQuietly(')),
    );
    assert.match(metered, /sttSeconds: audio\.byteLength \/ 2 \/ CAPTURE_SAMPLE_RATE,/);
    // The live transport reports a number of seconds, and anything else counts as none.
    assert.equal(streamedSeconds(new ArrayBuffer(3200)), 0);
    assert.equal(streamedSeconds(new Int16Array(1600)), 0);
    assert.equal(streamedSeconds([1, 2, 3]), 0);
    assert.equal(streamedSeconds('UklGRg=='), 0);
    assert.equal(streamedSeconds(1.5), 1.5);
  });

  it('mints a token without being sent any audio', () => {
    assert.match(code('src/app/api/deepgram/token/route.ts'), /export async function POST\(\)/);
  });

  it('keeps no audio in the browser, and sends it only to transcription', () => {
    for (const path of ['src/hooks/useMicCapture.ts', 'src/hooks/useSpeechInput.ts']) {
      assert.doesNotMatch(
        code(path),
        /localStorage|sessionStorage|indexedDB|caches\.|MediaRecorder|createObjectURL/,
        path,
      );
    }
    const speech = code('src/hooks/useSpeechInput.ts');
    const fetched = [...speech.matchAll(/fetch\(\s*`?'?([^`',?]+)/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(fetched)].sort(), [
      '/api/deepgram/token',
      '/api/stt',
      '/api/usage/stt',
    ]);
    // The developer log is told how long an utterance was, not what it contained.
    const reports = speech.split('reportFailure(').slice(1);
    assert.ok(reports.length >= 2);
    for (const report of reports) {
      const call = report.slice(0, report.indexOf('});'));
      assert.doesNotMatch(call, /merged|chunks|pcm|buffer/, call);
    }
  });

  it('keeps nothing but counts in a usage record', () => {
    const types = code('src/lib/usage/types.ts');
    const delta = types.slice(types.indexOf('export type UsageDelta'), types.indexOf('>;'));
    const fields = [...delta.matchAll(/'(\w+)'/g)].map((match) => match[1]);
    assert.ok(fields.length > 0);
    for (const field of fields) {
      assert.match(types, new RegExp(`\\b${field}\\??: number;`), field);
    }
  });
});

describe("Deepgram's own retention (AI-45)", () => {
  it('opts every transcription out of model training unless switched off', () => {
    assert.match(
      read('src/app/api/stt/route.ts'),
      /if \(deepgramMipOptOut\(\)\) url\.searchParams\.set\('mip_opt_out', 'true'\);/,
    );
    assert.match(read('src/app/api/deepgram/token/route.ts'), /mipOptOut: deepgramMipOptOut\(\),/);
    assert.match(
      read('src/hooks/useSpeechInput.ts'),
      /if \(credentials\.mipOptOut !== false\) url\.searchParams\.set\('mip_opt_out', 'true'\);/,
    );
  });
});

describe('the microphone at the end of a session (AI-45)', () => {
  it('closes when the session ends by wrapping up, as it does on Stop', () => {
    const session = read('src/hooks/useTrainingSession.ts');
    assert.match(
      session,
      /if \(kind === 'recap'\) \{[\s\S]{0,400}?sttRef\.current\.stop\(\);\s*setPhase\('ended'\);/,
    );
    assert.match(
      session,
      /sttRef\.current\.stop\(\);\s*setPhase\('ended'\);[\s\S]*sttRef\.current\.stop\(\);\s*setPhase\('ended'\);/,
    );
  });
});
