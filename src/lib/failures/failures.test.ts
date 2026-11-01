import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';

import { InMemoryDocumentStore } from '../roster/documents';
import { classifyHttp, classifyThrown, codeFor, type FailureKind } from './classify';
import {
  CONNECTION_LOST_MID_TURN,
  FAILURE_MESSAGES,
  LISTENING_LOST,
  describeFailure,
  readFailure,
} from './codes';
import {
  DEVLOG,
  entriesFor,
  forgetRecentFailures,
  recordFailure,
  type DevLogEntry,
} from './devlog';

/**
 * Standard messages for trainees, and the developer log behind them (AI-11).
 *
 * The bodies below are what each provider actually sends, or as close as their docs and
 * our own production failures show. The classifier reads words as well as statuses,
 * because an empty account arrives as a 429 from two of the four providers, and a
 * test that only checked statuses would pass while trainees were told "busy" for ever.
 */

describe('classifying a provider failure', () => {
  const cases: Array<[string, ReturnType<typeof classifyHttp>, FailureKind]> = [
    [
      'Deepgram, empty account',
      classifyHttp('deepgram', 402, '{"err_code":"INSUFFICIENT_CREDITS"}'),
      'out_of_credit',
    ],
    [
      'Sarvam, empty account on a 429',
      classifyHttp(
        'sarvam',
        429,
        '{"error":{"code":"insufficient_quota_error","message":"No credits available."}}',
      ),
      'out_of_credit',
    ],
    [
      'Sarvam, empty account on a 402',
      classifyHttp('sarvam', 402, '{"error":{"message":"No credits available."}}'),
      'out_of_credit',
    ],
    [
      'OpenAI, empty account with no code at all',
      classifyHttp(
        'openai',
        429,
        '{"error":{"message":"You have no credits remaining. Add credits to continue."}}',
      ),
      'out_of_credit',
    ],
    [
      'Gemini, depleted prepay since September 2026',
      classifyHttp('gemini', 402, 'Payment required'),
      'out_of_credit',
    ],
    [
      'Deepgram, wrong key',
      classifyHttp('deepgram', 401, '{"err_code":"INVALID_AUTH"}'),
      'bad_key',
    ],
    [
      'Sarvam, wrong key on a 400',
      classifyHttp(
        'sarvam',
        400,
        '{"error":{"code":"invalid_api_key_error","message":"Invalid key"}}',
      ),
      'bad_key',
    ],
    [
      'Sarvam, busy',
      classifyHttp(
        'sarvam',
        429,
        '{"error":{"code":"rate_limit_exceeded_error","message":"slow down"}}',
      ),
      'rate_limited',
    ],
    [
      'Gemini, per-minute quota',
      classifyHttp('gemini', 429, 'RESOURCE_EXHAUSTED: Quota exceeded for requests per minute'),
      'rate_limited',
    ],
    [
      'Deepgram, its own outage',
      classifyHttp('deepgram', 503, 'Service Unavailable'),
      'upstream_error',
    ],
    [
      'Deepgram, a bad request',
      classifyHttp('deepgram', 400, '{"err_msg":"Invalid model"}'),
      'other',
    ],
  ];
  for (const [name, failure, kind] of cases) {
    it(name, () => assert.equal(failure.kind, kind));
  }

  it('reads the status the Gemini SDK puts on what it throws', () => {
    const error = Object.assign(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'), {
      status: 429,
    });
    assert.equal(classifyThrown('gemini', error).kind, 'rate_limited');
    const empty = Object.assign(new Error('prepayment credits are depleted'), { status: 402 });
    assert.equal(classifyThrown('gemini', empty).kind, 'out_of_credit');
  });

  it('tells a network failure from a missing key', () => {
    assert.equal(classifyThrown('deepgram', new TypeError('fetch failed')).kind, 'unreachable');
    assert.equal(
      classifyThrown('gemini', new Error('GEMINI_API_KEY is not set.')).kind,
      'not_configured',
    );
  });

  it('keeps what the provider said, capped, for the log', () => {
    const failure = classifyHttp('sarvam', 500, 'x'.repeat(5000));
    assert.equal(failure.detail.length, 1000);
    assert.equal(failure.status, 500);
    assert.equal(failure.provider, 'sarvam');
  });
});

describe('what the trainee is told', () => {
  it('is busy only for a provider asking for fewer requests', () => {
    assert.deepEqual(codeFor('rate_limited'), { code: 'busy', retry: true });
  });

  it('never retries an empty account or a refused key', () => {
    for (const kind of ['out_of_credit', 'bad_key', 'not_configured'] as const) {
      assert.deepEqual(codeFor(kind), { code: 'unavailable', retry: false }, kind);
    }
  });

  it('retries the failures that clear on their own', () => {
    for (const kind of ['unreachable', 'upstream_error', 'bad_output'] as const) {
      assert.equal(codeFor(kind).retry, true, kind);
    }
  });

  it('names no provider, and no setting a trainee cannot change', () => {
    const words = [
      ...Object.values(FAILURE_MESSAGES),
      CONNECTION_LOST_MID_TURN,
      LISTENING_LOST,
    ].join(' ');
    assert.doesNotMatch(
      words,
      /deepgram|sarvam|gemini|openai|google|api[_ ]?key|credit|HTTP|\d{3}/i,
    );
    assert.doesNotMatch(words, /—/, 'an em dash crept into the wording');
  });

  it('carries the reference so support can find the log entry', () => {
    assert.equal(
      describeFailure({
        code: 'busy',
        message: FAILURE_MESSAGES.busy,
        retry: true,
        ref: 'ABCD2345',
      }),
      `${FAILURE_MESSAGES.busy} (Reference ABCD2345)`,
    );
  });
});

describe('reading a failed response in the browser', () => {
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });

  it('takes the code, retry and reference the server sent', async () => {
    const failure = await readFailure(
      json(502, {
        error: FAILURE_MESSAGES.unavailable,
        code: 'unavailable',
        retry: false,
        ref: 'R1',
      }),
    );
    assert.deepEqual(failure, {
      code: 'unavailable',
      message: FAILURE_MESSAGES.unavailable,
      retry: false,
      retryAfter: undefined,
      ref: 'R1',
    });
  });

  it('treats our own rate limit as limited, with its wait', async () => {
    const failure = await readFailure(
      json(429, { error: 'Try again in 30 seconds.' }, { 'Retry-After': '30' }),
    );
    assert.equal(failure.code, 'limited');
    assert.equal(failure.retryAfter, 30);
    assert.equal(failure.message, 'Try again in 30 seconds.');
  });

  it('treats a gateway timeout as the connection', async () => {
    const failure = await readFailure(new Response('<html>timeout</html>', { status: 504 }));
    assert.equal(failure.code, 'connection');
    assert.equal(failure.retry, true);
  });

  it('keeps our own wording for a refused request', async () => {
    const failure = await readFailure(json(400, { error: 'text is required.' }));
    assert.equal(failure.message, 'text is required.');
    assert.equal(failure.retry, false);
  });
});

describe('the developer log', () => {
  let store: InMemoryDocumentStore;
  beforeEach(() => {
    store = new InMemoryDocumentStore();
    forgetRecentFailures();
  });

  const input = {
    source: 'server' as const,
    provider: 'sarvam',
    kind: 'out_of_credit',
    code: 'unavailable' as const,
    status: 429,
    detail: 'No credits available.',
    route: '/api/tts',
    orgId: 'technavious',
    personId: 'p1',
    language: 'hi-IN',
  };

  it('keeps what happened, under the reference the trainee was shown', async () => {
    const now = Date.UTC(2026, 10, 1, 9, 30);
    const ref = await recordFailure(input, { store, now, immediate: true });
    assert.match(ref, /^[A-HJ-NP-Z2-9]{8}$/);

    const entry = await store.get<DevLogEntry>(DEVLOG, ref);
    assert.ok(entry);
    assert.equal(entry.detail, 'No credits available.');
    assert.equal(entry.day, '2026-11-01');
    assert.equal(entry.repeats, 1);
    assert.equal(entry.expireAt.getTime(), now + 90 * 86_400_000);
  });

  it('counts a repeat rather than writing it again', async () => {
    const now = Date.UTC(2026, 10, 1, 9, 30);
    const first = await recordFailure(input, { store, now, immediate: true });
    const second = await recordFailure(input, { store, now: now + 5000, immediate: true });
    assert.equal(second, first);
    assert.equal((await store.get<DevLogEntry>(DEVLOG, first))?.repeats, 2);

    const later = await recordFailure(input, { store, now: now + 61_000, immediate: true });
    assert.notEqual(later, first, 'a failure a minute later is a new entry');
  });

  it('writes no undefined fields, which Firestore refuses', async () => {
    const ref = await recordFailure(
      { ...input, deckId: undefined, client: { userAgent: undefined, network: 'online, 4g' } },
      { store, immediate: true },
    );
    const entry = await store.get<Record<string, unknown>>(DEVLOG, ref);
    assert.ok(entry);
    assert.ok(!('deckId' in entry));
    assert.deepEqual(entry.client, { network: 'online, 4g' });
  });

  it('reads one day, newest first, and nothing for a malformed day', async () => {
    const morning = Date.UTC(2026, 10, 1, 8);
    await recordFailure(input, { store, now: morning, immediate: true });
    await recordFailure(
      { ...input, personId: 'p2' },
      { store, now: morning + 3_600_000, immediate: true },
    );
    await recordFailure(
      { ...input, personId: 'p3' },
      { store, now: morning + 86_400_000, immediate: true },
    );

    const day = await entriesFor('2026-11-01', { store });
    assert.deepEqual(
      day.map((entry) => entry.personId),
      ['p2', 'p1'],
    );
    assert.deepEqual(await entriesFor('../../etc', { store }), []);
  });
});

describe('routes that call a provider', () => {
  // Each of these used to put the provider's own words, and in places the name of an
  // environment variable, in front of the trainee. They now fail through respond.ts.
  const routes = [
    'src/app/api/tts/route.ts',
    'src/app/api/voices/sample/route.ts',
    'src/app/api/stt/route.ts',
    'src/app/api/deepgram/token/route.ts',
    'src/app/api/chat/route.ts',
    'src/app/api/decks/[id]/analyse/route.ts',
  ];
  for (const route of routes) {
    it(`${route} sends no provider's words to the browser`, () => {
      const source = readFileSync(route, 'utf8');
      assert.doesNotMatch(source, /error: `(Could not reach|Deepgram|Sarvam)/);
      assert.doesNotMatch(source, /error: \(error as Error\)\.message/);
      assert.doesNotMatch(source, /Check that [A-Z_]+ is correct/);
    });
  }
});
