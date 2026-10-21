import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readFileSync } from 'node:fs';

import { orgsConfigured } from '../orgs/registry';
import { InMemoryDocumentStore, type DocumentStore, type UpdateOptions } from '../roster/documents';
import {
  decide,
  RATE_LIMITS,
  rateLimited,
  type RateState,
  type RateWindow,
  type StoredRate,
} from './rate';

/**
 * How fast one person may call the routes that cost money.
 *
 * The arithmetic is tested through `decide`, the step the store runs inside its
 * transaction, because every way of getting a limit wrong is in what that step computes:
 * which windows count, when a window starts again, and how long somebody is told to
 * wait. `rateLimited` is then driven end to end through the in-memory store, and through
 * stores built to hang, fail or count their calls, and the routes are read to check that
 * each one asks before it spends anything.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const T0 = Date.parse('2026-10-21T09:00:00.000Z');

/** Small enough to reach in a few calls, with the hour tighter than five minutes. */
const WINDOWS: RateWindow[] = [
  { seconds: 60, max: 3 },
  { seconds: 3600, max: 5 },
];

describe('deciding one call', () => {
  it('counts an allowed call in every window', () => {
    const first = decide(undefined, WINDOWS, T0);
    assert.equal(first.allowed, true);
    assert.equal(first.retryAfter, 0);
    assert.deepEqual(first.next, {
      '60': { start: T0, count: 1 },
      '3600': { start: T0, count: 1 },
    });

    const second = decide(first.next, WINDOWS, T0 + 1000);
    assert.equal(second.allowed, true);
    // Each window keeps the moment it opened, not the moment of the latest call, or
    // a steady caller would hold a window open for ever.
    assert.deepEqual(second.next, {
      '60': { start: T0, count: 2 },
      '3600': { start: T0, count: 2 },
    });
  });

  it('refuses at the most a window allows, and says when it opens again', () => {
    let state = decide(undefined, WINDOWS, T0).next;
    state = decide(state, WINDOWS, T0 + 1000).next;
    state = decide(state, WINDOWS, T0 + 2000).next;

    const refused = decide(state, WINDOWS, T0 + 15_000);
    assert.equal(refused.allowed, false);
    // The minute window opened at T0, so it opens again 45 seconds from now.
    assert.equal(refused.retryAfter, 45);
  });

  it('rounds the wait up, so a caller who waits exactly that long is let in', () => {
    let state = decide(undefined, WINDOWS, T0).next;
    state = decide(state, WINDOWS, T0).next;
    state = decide(state, WINDOWS, T0).next;

    const refused = decide(state, WINDOWS, T0 + 59_500);
    assert.equal(refused.retryAfter, 1);
    assert.equal(decide(state, WINDOWS, T0 + 59_500 + 1000).allowed, true);
  });

  it('does not count a refused call', () => {
    // Otherwise somebody retrying would keep pushing their own wait further away.
    let state = decide(undefined, WINDOWS, T0).next;
    state = decide(state, WINDOWS, T0).next;
    state = decide(state, WINDOWS, T0).next;

    const refused = decide(state, WINDOWS, T0 + 10_000);
    assert.equal(refused.allowed, false);
    assert.deepEqual(refused.next, state);
    assert.equal(refused.next['60']!.count, 3);
    assert.equal(refused.next['3600']!.count, 3);
  });

  it('starts a window afresh once it has passed', () => {
    let state = decide(undefined, WINDOWS, T0).next;
    state = decide(state, WINDOWS, T0).next;
    state = decide(state, WINDOWS, T0).next;
    assert.equal(decide(state, WINDOWS, T0 + MINUTE - 1).allowed, false);

    const later = decide(state, WINDOWS, T0 + MINUTE);
    assert.equal(later.allowed, true);
    assert.deepEqual(later.next['60'], { start: T0 + MINUTE, count: 1 });
    // The hour has not passed, so it carries on counting from where it was.
    assert.deepEqual(later.next['3600'], { start: T0, count: 4 });
  });

  it('refuses on the hour even when the minute has room', () => {
    // Three calls in the first minute, two in the second: the hour's five are used.
    let state = decide(undefined, WINDOWS, T0).next;
    state = decide(state, WINDOWS, T0).next;
    state = decide(state, WINDOWS, T0).next;
    state = decide(state, WINDOWS, T0 + MINUTE).next;
    state = decide(state, WINDOWS, T0 + MINUTE).next;
    assert.equal(state['60']!.count, 2);
    assert.equal(state['3600']!.count, 5);

    const refused = decide(state, WINDOWS, T0 + 2 * MINUTE + 30_000);
    assert.equal(refused.allowed, false);
    assert.equal(refused.retryAfter, (HOUR - 2 * MINUTE - 30_000) / 1000);
  });

  it('weighs a call, letting it take exactly the room that is left and no more', () => {
    // Two used of the minute's three: a call weighing one fits, one weighing two does not.
    const used = decide(undefined, WINDOWS, T0, 2).next;
    assert.deepEqual(used['60'], { start: T0, count: 2 });

    const tooHeavy = decide(used, WINDOWS, T0 + 1000, 2);
    assert.equal(tooHeavy.allowed, false);
    assert.equal(tooHeavy.retryAfter, 59);
    assert.deepEqual(tooHeavy.next, used, 'the refused weight is not counted');

    const fits = decide(used, WINDOWS, T0 + 1000, 1);
    assert.equal(fits.allowed, true);
    assert.deepEqual(fits.next['60'], { start: T0, count: 3 });
    assert.deepEqual(fits.next['3600'], { start: T0, count: 3 });
  });

  it('lets a call heavier than a whole window into an empty one, filling each window', () => {
    // Otherwise it could never be let in, however long its sender waited.
    const heavy = decide(undefined, WINDOWS, T0, 50);
    assert.equal(heavy.allowed, true);
    assert.deepEqual(heavy.next, {
      '60': { start: T0, count: 3 },
      '3600': { start: T0, count: 5 },
    });
  });

  it('counts from fresh when what was stored cannot be trusted', () => {
    // A count that is not a number, or a window that opens in the future, would
    // otherwise refuse somebody for a wait nobody could explain.
    for (const stored of [
      { '60': { start: Number.NaN, count: 3 }, '3600': { start: T0, count: Infinity } },
      { '60': { start: T0 + HOUR, count: 3 }, '3600': { start: T0 + HOUR, count: 5 } },
      { '60': { start: String(T0), count: '3' }, '3600': null },
      { '60': { start: T0, count: -10 }, '3600': 'nonsense' },
    ] as unknown as RateState[]) {
      const decision = decide(stored, WINDOWS, T0);
      assert.equal(decision.allowed, true, JSON.stringify(stored));
      assert.deepEqual(decision.next, {
        '60': { start: T0, count: 1 },
        '3600': { start: T0, count: 1 },
      });
    }
  });

  it('sets every limit above what a session does, with the hour above the minute', () => {
    for (const [kind, windows] of Object.entries(RATE_LIMITS)) {
      const [minute, hour] = windows;
      assert.equal(minute!.seconds, 60, kind);
      assert.equal(hour!.seconds, 3600, kind);
      assert.ok(hour!.max > minute!.max, kind);
    }
  });
});

describe('limiting a person', () => {
  it('runs on the in-memory store under the tests', () => {
    // Everything below counts in memory. If Firebase were configured here these tests
    // would write to a real database instead, which they must never do.
    assert.equal(orgsConfigured(), false);
  });

  it('lets exactly the limit through, then refuses with a wait and a reason', async () => {
    const person = { id: 'rate-test-limit', orgId: 'acme' };
    const allowed = RATE_LIMITS.token[0]!.max;

    for (let call = 1; call <= allowed; call += 1) {
      assert.equal(await rateLimited(person, 'token'), null, `call ${call}`);
    }

    const refused = await rateLimited(person, 'token');
    assert.ok(refused, 'the call after the limit is refused');
    assert.equal(refused.status, 429);

    const wait = Number(refused.headers.get('Retry-After'));
    assert.ok(Number.isInteger(wait) && wait >= 1 && wait <= 60, `Retry-After was ${wait}`);

    const body = (await refused.json()) as { error: string };
    assert.match(body.error, /more requests than this needs in a short time/);
    assert.match(body.error, new RegExp(`Try again in ${wait} seconds?\\.`));
  });

  it('gives a long wait in minutes, rounded up', async () => {
    // The hour used up a second after it opened: nearly an hour to wait, which reads
    // better as sixty minutes than as three thousand five hundred and ninety-nine seconds.
    const store = new InMemoryDocumentStore();
    const now = Date.now();
    await store.set<StoredRate>('orgs/acme/ratelimits', 'rate-test-minutes__sample', {
      personId: 'rate-test-minutes',
      kind: 'sample',
      windows: { '60': { start: now, count: 0 }, '3600': { start: now - 1000, count: 100 } },
      expireAt: new Date(now + HOUR),
    });

    const refused = await rateLimited({ id: 'rate-test-minutes', orgId: 'acme' }, 'sample', 1, {
      store,
    });
    assert.ok(refused);
    assert.ok(Number(refused.headers.get('Retry-After')) >= 3598);
    const body = (await refused.json()) as { error: string };
    assert.match(body.error, /Try again in 60 minutes\./);
  });

  it('keeps a separate count for each person', async () => {
    const busy = { id: 'rate-test-busy', orgId: 'acme' };
    const quiet = { id: 'rate-test-quiet', orgId: 'acme' };
    for (let call = 0; call < RATE_LIMITS.token[0]!.max; call += 1) {
      await rateLimited(busy, 'token');
    }

    assert.ok(await rateLimited(busy, 'token'));
    assert.equal(await rateLimited(quiet, 'token'), null);
  });

  it('keeps a separate count for each kind of call', async () => {
    const person = { id: 'rate-test-kinds', orgId: 'acme' };
    for (let call = 0; call < RATE_LIMITS.token[0]!.max; call += 1) {
      await rateLimited(person, 'token');
    }

    assert.ok(await rateLimited(person, 'token'));
    assert.equal(await rateLimited(person, 'speech'), null);
  });

  it('keeps a separate count in each organisation', async () => {
    // The same id in two customers is two people, and the count is stored under each
    // organisation's own prefix.
    const here = { id: 'rate-test-shared-id', orgId: 'acme' };
    const there = { id: 'rate-test-shared-id', orgId: 'globex' };
    for (let call = 0; call < RATE_LIMITS.token[0]!.max; call += 1) {
      await rateLimited(here, 'token');
    }

    assert.ok(await rateLimited(here, 'token'));
    assert.equal(await rateLimited(there, 'token'), null);
  });

  it('counts staff in their own organisation, wherever they are looking', async () => {
    // Technavious staff act inside whichever customer they open. Counted there, they
    // would have a fresh allowance in every customer.
    const store = new InMemoryDocumentStore();
    const inAcme = { id: 'rate-test-staff', orgId: 'acme', homeOrgId: 'technavious' };
    const inGlobex = { id: 'rate-test-staff', orgId: 'globex', homeOrgId: 'technavious' };
    for (let call = 0; call < RATE_LIMITS.token[0]!.max; call += 1) {
      assert.equal(await rateLimited(inAcme, 'token', 1, { store }), null);
    }

    assert.ok(await rateLimited(inGlobex, 'token', 1, { store }), 'the count followed them');
    const row = await store.get<StoredRate>(
      'orgs/technavious/ratelimits',
      'rate-test-staff__token',
    );
    assert.equal(row?.windows['60']?.count, RATE_LIMITS.token[0]!.max);
  });

  it('stores who and what it counted, and when the count may be thrown away', async () => {
    // The person and kind let a purge rebuild the id; expireAt is what the TTL policy
    // reads, one longest window ahead so nothing is thrown away while it still counts.
    const store = new InMemoryDocumentStore();
    const before = Date.now();
    await rateLimited({ id: 'rate-test-stored', orgId: 'acme' }, 'chat', 1, { store });

    const row = await store.get<StoredRate>('orgs/acme/ratelimits', 'rate-test-stored__chat');
    assert.ok(row);
    assert.equal(row.personId, 'rate-test-stored');
    assert.equal(row.kind, 'chat');
    assert.ok(row.expireAt instanceof Date, 'a Date, which Firestore stores as a Timestamp');
    const ahead = row.expireAt.getTime() - before;
    assert.ok(ahead >= HOUR && ahead < HOUR + 5000, `expires ${ahead} ms ahead`);
    assert.equal(row.windows['60']?.count, 1);
    assert.equal(row.windows['3600']?.count, 1);
  });

  it('weighs a call by the units it is given', async () => {
    const store = new InMemoryDocumentStore();
    const person = { id: 'rate-test-weight', orgId: 'acme' };
    const max = RATE_LIMITS.listening[0]!.max;

    assert.equal(await rateLimited(person, 'listening', max - 1, { store }), null);
    assert.ok(await rateLimited(person, 'listening', 2, { store }), 'two do not fit in one');
    assert.equal(await rateLimited(person, 'listening', 1, { store }), null, 'one does');
  });
});

/** A store that answers everything from memory, with its own idea of `update`. */
function storeWith(update: DocumentStore['update']): DocumentStore {
  const memory = new InMemoryDocumentStore();
  return {
    kind: 'fake',
    get: (collection, id) => memory.get(collection, id),
    set: (collection, id, value) => memory.set(collection, id, value),
    remove: (collection, id) => memory.remove(collection, id),
    all: (collection) => memory.all(collection),
    where: (collection, field, value) => memory.where(collection, field, value),
    update,
  };
}

/** The in-memory store, keeping count of how often it is asked to update. */
class CountingStore extends InMemoryDocumentStore {
  updates = 0;
  options: (UpdateOptions | undefined)[] = [];

  override async update<T>(
    collection: string,
    id: string,
    change: (current: T | undefined) => T,
    options?: UpdateOptions,
  ): Promise<T> {
    this.updates += 1;
    this.options.push(options);
    return super.update(collection, id, change);
  }
}

describe('when the count is slow, contended or unavailable', () => {
  it('lets the call through once the budget runs out', async () => {
    // A count that never answers must not hold up the trainee it is counting.
    const hanging = storeWith(() => new Promise(() => undefined));
    const started = Date.now();
    const result = await rateLimited({ id: 'rate-test-hang', orgId: 'acme' }, 'speech', 1, {
      store: hanging,
      budgetMs: 50,
    });
    const took = Date.now() - started;

    assert.equal(result, null);
    assert.ok(took >= 40 && took < 1000, `took ${took} ms`);
  });

  it('swallows a failure that arrives after the budget ran out', async () => {
    // Left unhandled, a late rejection would be reported as a crash of the process.
    let fail: (error: Error) => void = () => undefined;
    const late = storeWith(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);
    try {
      const result = await rateLimited({ id: 'rate-test-late', orgId: 'acme' }, 'speech', 1, {
        store: late,
        budgetMs: 10,
      });
      assert.equal(result, null);
      fail(new Error('too late'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', record);
    }
  });

  for (const code of [10, 409]) {
    it(`refuses, briefly, when the transaction is contended (code ${code})`, async () => {
      // Others writing the same count at once is a burst from one person, which is the
      // thing being limited, not an outage to wave through.
      const contended = storeWith(() =>
        Promise.reject(Object.assign(new Error('ABORTED: too much contention'), { code })),
      );
      const refused = await rateLimited({ id: `rate-test-${code}`, orgId: 'acme' }, 'speech', 1, {
        store: contended,
      });

      assert.ok(refused);
      assert.equal(refused.status, 429);
      assert.equal(refused.headers.get('Retry-After'), '1');
      const body = (await refused.json()) as { error: string };
      assert.match(body.error, /Try again in 1 second\./);
    });
  }

  it('lets the call through when the store is unavailable', async () => {
    const down = storeWith(() =>
      Promise.reject(Object.assign(new Error('UNAVAILABLE'), { code: 14 })),
    );
    assert.equal(
      await rateLimited({ id: 'rate-test-down', orgId: 'acme' }, 'speech', 1, { store: down }),
      null,
    );
  });

  it('asks the store to give up after two attempts', async () => {
    // Through the organisation scope, which has to pass the option on for Firestore to
    // ever see it.
    const store = new CountingStore();
    await rateLimited({ id: 'rate-test-attempts', orgId: 'acme' }, 'speech', 1, { store });
    assert.deepEqual(store.options, [{ maxAttempts: 2 }]);
  });

  it('hands maxAttempts to Firestore, and only when it is set', () => {
    const source = read('src/lib/firebase/firestore.ts');
    assert.match(source, /runTransaction\(/);
    assert.match(source, /maxAttempts === undefined \? undefined : \{ maxAttempts \}/);
  });
});

describe('refusing again without asking the database', () => {
  it('refuses somebody it has just refused without another transaction', async () => {
    // Somebody calling in a loop carries on after the first refusal, and each of those
    // calls would otherwise be another transaction on the document already contended.
    const store = new CountingStore();
    const person = { id: 'rate-test-blocked', orgId: 'acme' };
    const max = RATE_LIMITS.sample[0]!.max;
    for (let call = 0; call < max; call += 1) {
      assert.equal(await rateLimited(person, 'sample', 1, { store }), null);
    }

    const first = await rateLimited(person, 'sample', 1, { store });
    assert.ok(first);
    assert.equal(store.updates, max + 1);

    const second = await rateLimited(person, 'sample', 1, { store });
    assert.ok(second);
    assert.equal(second.status, 429);
    assert.ok(Number(second.headers.get('Retry-After')) >= 1);
    assert.equal(store.updates, max + 1, 'the second refusal never reached the store');
  });

  it('still asks for a lighter call that might fit', async () => {
    // A heavy call refused says nothing about one light enough for the room left.
    const store = new CountingStore();
    const person = { id: 'rate-test-blocked-weight', orgId: 'acme' };
    const max = RATE_LIMITS.listening[0]!.max;

    assert.equal(await rateLimited(person, 'listening', max - 5, { store }), null);
    assert.ok(await rateLimited(person, 'listening', 10, { store }));
    assert.equal(await rateLimited(person, 'listening', 5, { store }), null);
    assert.equal(store.updates, 3);

    assert.ok(await rateLimited(person, 'listening', 10, { store }));
    assert.equal(store.updates, 3, 'as heavy as the refused one, so refused here');
  });
});

describe('a purge', () => {
  it('deletes the counts with the customer', () => {
    const source = read('src/lib/orgs/lifecycle.ts');
    const owned = source.slice(
      source.indexOf('const OWNED_COLLECTIONS'),
      source.indexOf('] as const'),
    );
    assert.match(owned, /'ratelimits'/);
    // And rebuilds the id the way rateLimited writes it, or the row is read and left.
    assert.match(source, /`\$\{row\.personId\}__\$\{row\.kind\}`/);
  });
});

/**
 * Every route that spends money asks first.
 *
 * Read from the source, because a route driven end to end would need a signed-in person
 * and a provider to answer it. What matters is the order: after the gate, so the count
 * belongs to somebody, and before the first call that is billed, so a refused call
 * costs nothing.
 */

const read = (path: string) => readFileSync(path, 'utf8');

interface Spender {
  path: string;
  kind: keyof typeof RATE_LIMITS;
  /** The line after which the person is known, and allowed. */
  gate: string;
  /** Anything that reaches a paid provider. */
  spends: string[];
  /**
   * Where the limit sits relative to reading the body. Before, where nothing in it is
   * needed. After, where the body is what the gate checks or what the call is weighed
   * by.
   */
  body: 'before' | 'after';
  /** Whether the call is weighed by its size rather than counted once. */
  weighed?: boolean;
}

const PASSED_GATE = 'if (!gate.ok) return gate.response;';

const SPENDERS: Spender[] = [
  {
    path: 'src/app/api/chat/route.ts',
    kind: 'chat',
    gate: PASSED_GATE,
    spends: ['new GoogleGenAI(', 'generateContentStream('],
    // The deck id the gate checks is in the body, so it has to be read first.
    body: 'after',
  },
  {
    path: 'src/app/api/tts/route.ts',
    kind: 'speech',
    gate: PASSED_GATE,
    spends: ['synthesise('],
    // Weighed by the length of the text, so the text has to be read first.
    body: 'after',
    weighed: true,
  },
  {
    path: 'src/app/api/voices/sample/route.ts',
    kind: 'sample',
    gate: PASSED_GATE,
    spends: ['synthesise('],
    body: 'before',
  },
  {
    path: 'src/app/api/stt/route.ts',
    kind: 'listening',
    gate: PASSED_GATE,
    spends: ['fetch(', 'recordQuietly('],
    // Weighed by the seconds of audio, so the audio has to be read first.
    body: 'after',
    weighed: true,
  },
  {
    path: 'src/app/api/deepgram/token/route.ts',
    kind: 'token',
    gate: PASSED_GATE,
    spends: ['fetch(GRANT_URL'],
    body: 'before',
  },
  {
    path: 'src/app/api/decks/[id]/analyse/route.ts',
    kind: 'analyse',
    gate: PASSED_GATE,
    spends: ['analyseDeckMeta(', 'analyseSlideBatch(', 'analyseSlideDetail(', 'analyseTopics('],
    body: 'before',
  },
  {
    path: 'src/app/api/openai-test/speak/route.ts',
    kind: 'openaiTest',
    gate: 'if (!mayUseOpenAiTest(gate.person))',
    spends: ['speakWithOpenAi('],
    body: 'before',
  },
  {
    path: 'src/app/api/openai-test/transcribe/route.ts',
    kind: 'openaiTest',
    gate: 'if (!mayUseOpenAiTest(gate.person))',
    spends: ['transcribeWithOpenAi(', 'transcribeWithDeepgram('],
    body: 'before',
  },
];

/** The handler alone, so a word in the header comment or an import cannot match. */
function handlerOf(path: string): string {
  const source = read(path);
  const start = source.indexOf('export async function');
  assert.ok(start >= 0, `${path} has a handler`);
  return source.slice(start);
}

describe('the routes that cost money', () => {
  for (const route of SPENDERS) {
    it(`${route.path} asks for '${route.kind}' after the gate and before spending`, () => {
      const handler = handlerOf(route.path);

      const calls = [...handler.matchAll(/rateLimited\(gate\.person, '(\w+)'(?:, (\w+))?\)/g)];
      assert.equal(calls.length, 1, 'asks exactly once');
      assert.equal(calls[0]![1], route.kind);
      assert.equal(calls[0]![2] !== undefined, route.weighed === true, 'weighs the call');
      const asked = calls[0]!.index!;
      assert.match(handler, /if \(limited\) return limited;/);

      const gate = handler.indexOf(route.gate);
      assert.ok(gate >= 0, `finds the gate: ${route.gate}`);
      assert.ok(asked > gate, 'asks after the gate');

      for (const spend of route.spends) {
        const at = handler.indexOf(spend);
        assert.ok(at >= 0, `finds ${spend}`);
        assert.ok(asked < at, `asks before ${spend}`);
      }

      const body = handler.search(/request\.(json|formData|arrayBuffer|text)\(/);
      if (route.body === 'before') {
        if (body >= 0) assert.ok(asked < body, 'asks before reading the body');
      } else {
        assert.ok(body >= 0, 'reads the body');
        assert.ok(asked > body, 'asks after reading the body');
      }
    });
  }

  it('limits nothing that is free', () => {
    // These read and write the app's own records. Limiting them would only get in
    // the way of a trainee whose session is otherwise fine.
    for (const path of [
      'src/app/api/usage/stt/route.ts',
      'src/app/api/progress/route.ts',
      'src/app/api/voices/route.ts',
    ]) {
      assert.doesNotMatch(read(path), /rateLimited/, path);
    }
  });
});
