import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { isAdministrator } from '../auth/permissions';
import type { DeckRecord } from '../deck-types';
import { approveDeck } from '../decks/approval';
import { ISMS_DECK } from '../decks/isms';
import { resetDeckStore } from '../decks/registry';
import { DocumentDeckStore } from '../decks/store-documents';
import { entriesFor, forgetRecentFailures } from '../failures/devlog';
import { alertsFrom } from '../failures/alerts';
import { scopedDocuments } from '../orgs/scope';
import { saveUploadedProfile } from '../profiles/store';
import type { UploadResult } from '../profiles/upload';
import { InMemoryDocumentStore } from '../roster/documents';
import { resetRosterStore } from '../roster/registry';
import { DocumentRosterStore } from '../roster/store-documents';
import type { Role, SignedInPerson } from '../roster/types';
import { createSession } from '../training/service';
import { trainingStore } from '../training/store';
import type { TrainingSession } from '../training/types';
import { escapeHtml, renderHtml } from './compose';
import {
  incompleteInUpcomingSessions,
  notifyIncompleteUpload,
  notifySessionSetUp,
  writeUpcomingDigests,
} from './events';
import { runNotifications } from './job';
import {
  attempt,
  configuredProvider,
  enqueue,
  forgetNotificationsOf,
  HELD_REASON,
  MAX_ATTEMPTS,
  NOTIFICATIONS,
  notificationIdFor,
  pruneOld,
  recentNotifications,
  retryNow,
  RETRY_DELAYS_MS,
  sendDue,
  type NotificationInput,
} from './outbox';
import {
  classifyResendFailure,
  RESEND_ENDPOINT,
  resendProvider,
  type EmailProvider,
  type OutgoingEmail,
  type SendOutcome,
} from './provider';
import type { NotificationRecord } from './types';

/**
 * Email notifications (AI-35): the outbox, its retries, the Resend provider, the events
 * that write notifications, the daily run, and who may see them.
 *
 * Everything runs on the in-memory document store and a stand-in provider, so no email
 * is sent and no key is needed. The Resend provider itself is driven through a stand-in
 * `fetch`, which records what would have been sent.
 */

const ORG = 'acme';
const T0 = Date.parse('2026-11-13T04:30:00.000Z');

let store: InMemoryDocumentStore;
let now: number;
const clock = () => now;

/** A provider that answers each send from a list, and remembers what it was given. */
function scripted(...answers: SendOutcome[]): EmailProvider & { sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    name: 'resend',
    sent,
    async send(email) {
      sent.push(email);
      return answers.length > 1 ? answers.shift()! : answers[0]!;
    },
  };
}

const OK: SendOutcome = { ok: true, providerId: 'email-1' };
const DOWN = classifyResendFailure(503, { name: 'service_unavailable', message: 'Down' });
const UNVERIFIED = classifyResendFailure(403, {
  name: 'validation_error',
  message: 'You can only send testing emails to your own email address.',
});

function input(overrides: Partial<NotificationInput> = {}): NotificationInput {
  return {
    kind: 'session-set-up',
    dedupeKey: 'session-set-up:acme:s-one',
    orgId: ORG,
    subject: 'Session set up',
    text: 'Text',
    html: '<p>Text</p>',
    ...overrides,
  };
}

const stored = (id: string) => store.get<NotificationRecord>(NOTIFICATIONS, id);
const all = () => store.all<NotificationRecord>(NOTIFICATIONS);

let savedEnv: Record<string, string | undefined>;
const ENV = ['RESEND_API_KEY', 'NOTIFY_TO', 'NOTIFY_FROM', 'APP_URL', 'CRON_SECRET'];

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
  for (const name of ENV) delete process.env[name];
  store = new InMemoryDocumentStore();
  now = T0;
  forgetRecentFailures();
});

afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

// ---------------------------------------------------------------------- outbox

describe('the outbox', () => {
  it('writes one notification per event, however often the event is reported', async () => {
    const provider = scripted(OK);
    const first = await enqueue(input(), { store, provider, now: clock });
    const again = await enqueue(input({ subject: 'Different words' }), {
      store,
      provider,
      now: clock,
    });

    assert.equal(first.created, true);
    assert.equal(again.created, false);
    assert.equal(again.record.subject, 'Session set up', 'the first one stands');
    assert.equal((await all()).length, 1);
    assert.equal(first.record.id, notificationIdFor('session-set-up:acme:s-one'));
    assert.equal(first.record.status, 'pending');
    assert.equal(first.record.attempts, 0);
    assert.deepEqual(first.record.to, ['training@technavious.com']);
  });

  it('keeps a different event as a different notification', async () => {
    await enqueue(input(), { store, provider: scripted(OK), now: clock });
    await enqueue(input({ dedupeKey: 'session-set-up:acme:s-two' }), {
      store,
      provider: scripted(OK),
      now: clock,
    });
    assert.equal((await all()).length, 2);
  });

  it('never sends a sent notification again', async () => {
    const provider = scripted(OK);
    const { record } = await enqueue(input(), { store, provider, now: clock });
    assert.equal((await attempt(record.id, { store, provider, now: clock })).outcome, 'sent');
    assert.equal((await attempt(record.id, { store, provider, now: clock })).outcome, 'skipped');
    await sendDue({ store, provider, now: clock });
    assert.equal(provider.sent.length, 1);
    const sent = await stored(record.id);
    assert.equal(sent?.status, 'sent');
    assert.equal(sent?.providerId, 'email-1');
    assert.equal(sent?.attempts, 1);
    assert.equal(sent?.claimedUntil, null);
  });

  it('does not send one another server is in the middle of sending', async () => {
    // The claim itself is atomic only in Firestore, which runs it in a transaction; the
    // in-memory store cannot prove that. What this proves is that a claim, once made,
    // turns a second sender away until the first has finished.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const sent: OutgoingEmail[] = [];
    const slow: EmailProvider = {
      name: 'resend',
      async send(email) {
        sent.push(email);
        await gate;
        return OK;
      },
    };
    const { record } = await enqueue(input(), { store, provider: slow, now: clock });
    const first = attempt(record.id, { store, provider: slow, now: clock });
    while (sent.length === 0) await new Promise((resolve) => setImmediate(resolve));

    const second = await attempt(record.id, { store, provider: slow, now: clock });
    assert.equal(second.outcome, 'skipped');
    assert.equal((await sendDue({ store, provider: slow, now: clock })).sent, 0);
    release();
    assert.equal((await first).outcome, 'sent');
    assert.equal(sent.length, 1);
  });

  it('lets a claim lapse when the server holding it died mid-send', async () => {
    const hung: EmailProvider = { name: 'resend', send: () => new Promise(() => undefined) };
    const { record } = await enqueue(input(), { store, provider: hung, now: clock });
    void attempt(record.id, { store, provider: hung, now: clock });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok((await stored(record.id))?.claimedUntil);

    now += 2 * 60_000;
    const provider = scripted(OK);
    assert.equal((await attempt(record.id, { store, provider, now: clock })).outcome, 'sent');
  });

  it('gives Resend the notification id as the idempotency key on every try', async () => {
    const provider = scripted(DOWN, OK);
    const { record } = await enqueue(input(), { store, provider, now: clock });
    await attempt(record.id, { store, provider, now: clock });
    now += RETRY_DELAYS_MS[0];
    await attempt(record.id, { store, provider, now: clock });
    assert.deepEqual(
      provider.sent.map((email) => email.idempotencyKey),
      [record.id, record.id],
    );
  });

  it('deletes a customer’s notifications with the customer, and nobody else’s', async () => {
    await enqueue(input(), { store, provider: null, now: clock });
    await enqueue(input({ dedupeKey: 'other', orgId: 'globex' }), {
      store,
      provider: null,
      now: clock,
    });
    assert.equal(await forgetNotificationsOf(ORG, { store }), 1);
    assert.deepEqual(
      (await all()).map((record) => record.orgId),
      ['globex'],
    );
  });

  it('prunes what is past its 30 days, and lists only this month and last', async () => {
    now = Date.parse('2026-09-20T00:00:00Z');
    await enqueue(input({ dedupeKey: 'september' }), { store, provider: null, now: clock });
    now = Date.parse('2026-11-01T00:00:00Z');
    await enqueue(input({ dedupeKey: 'november' }), { store, provider: null, now: clock });
    now = T0;

    assert.deepEqual(
      (await recentNotifications({ store, now: clock })).map((record) => record.dedupeKey),
      ['november'],
    );
    assert.equal(await pruneOld({ store, now: clock }), 1);
    assert.deepEqual(
      (await all()).map((record) => record.dedupeKey),
      ['november'],
    );
  });
});

// ---------------------------------------------------------------------- retries

describe('retrying', () => {
  it('backs off a minute, five, thirty, two hours and twelve, then gives up', async () => {
    const provider = scripted(DOWN);
    const { record } = await enqueue(input(), { store, provider, now: clock });

    const waits: number[] = [];
    for (let tryNumber = 1; tryNumber <= MAX_ATTEMPTS; tryNumber += 1) {
      const result = await attempt(record.id, { store, provider, now: clock });
      const after = result.record!;
      assert.equal(after.attempts, tryNumber);
      assert.match(after.lastError ?? '', /Resend 503 service_unavailable: Down/);
      if (tryNumber < MAX_ATTEMPTS) {
        assert.equal(result.outcome, 'retrying');
        assert.equal(after.status, 'pending');
        const wait = Date.parse(after.nextAttemptAt!) - now;
        waits.push(wait);
        // Not due a moment before its time.
        now += wait - 1;
        assert.equal((await sendDue({ store, provider, now: clock })).retrying, 0);
        now += 1;
      } else {
        assert.equal(result.outcome, 'failed');
        assert.equal(after.status, 'failed');
        assert.equal(after.nextAttemptAt, null);
      }
    }
    assert.deepEqual(waits, [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);
    assert.equal(MAX_ATTEMPTS, 6);
    assert.equal(provider.sent.length, 6);
  });

  it('sends a due retry from the run, and leaves one not yet due', async () => {
    const provider = scripted(DOWN, OK);
    const { record } = await enqueue(input(), { store, provider, now: clock });
    await attempt(record.id, { store, provider, now: clock });

    assert.deepEqual(await sendDue({ store, provider, now: clock }), {
      sent: 0,
      retrying: 0,
      failed: 0,
      held: 0,
      left: 0,
    });
    now += 60_000;
    assert.equal((await sendDue({ store, provider, now: clock })).sent, 1);
    assert.equal((await stored(record.id))?.status, 'sent');
  });

  it('does not retry a refusal: an unverified sender fails at once', async () => {
    const provider = scripted(UNVERIFIED);
    const { record } = await enqueue(input(), { store, provider, now: clock });
    const result = await attempt(record.id, { store, provider, now: clock });
    assert.equal(result.outcome, 'failed');
    assert.equal(result.record?.attempts, 1);
    now += 86_400_000;
    await sendDue({ store, provider, now: clock });
    assert.equal(provider.sent.length, 1);
  });

  it('logs every failed send to the developer log, as Resend, for the banner', async () => {
    const provider = scripted(UNVERIFIED);
    const { record } = await enqueue(input({ dedupeKey: 'logged-once' }), {
      store,
      provider,
      now: clock,
    });
    await attempt(record.id, { store, provider, now: clock });

    // The developer log is shared by every test in this file, so only this one's entry.
    const today = new Date().toISOString().slice(0, 10);
    const logged = (await entriesFor(today)).filter((entry) => entry.detail.includes(record.id));
    assert.equal(logged.length, 1);
    assert.equal(logged[0]!.provider, 'resend');
    assert.equal(logged[0]!.kind, 'not_configured');
    assert.equal(logged[0]!.orgId, ORG);
    assert.deepEqual(
      alertsFrom(logged).map((alert) => `${alert.provider} ${alert.kind}`),
      ['resend not_configured'],
    );
  });

  it('lets an administrator retry a failed one at once, as a fresh round', async () => {
    const provider = scripted(UNVERIFIED, OK);
    const { record } = await enqueue(input(), { store, provider, now: clock });
    await attempt(record.id, { store, provider, now: clock });
    assert.equal((await stored(record.id))?.status, 'failed');

    const result = await retryNow(record.id, { store, provider, now: clock });
    assert.equal(result?.outcome, 'sent');
    assert.equal(result?.record?.attempts, 1);
    assert.equal(await retryNow('n-0000', { store, provider, now: clock }), undefined);
  });
});

// ------------------------------------------------------------------ the provider

describe('Resend', () => {
  it('posts the email as its API asks, with the key and an idempotency key', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchStub = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ id: 'abc-123' }, { status: 200 });
    }) as unknown as typeof fetch;

    const outcome = await resendProvider('re_test', fetchStub).send({
      from: 'Nova <notifications@technavious.com>',
      to: ['training@technavious.com'],
      subject: 'Hello',
      text: 'Plain',
      html: '<p>Plain</p>',
      idempotencyKey: 'n-1',
    });

    assert.deepEqual(outcome, { ok: true, providerId: 'abc-123' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, RESEND_ENDPOINT);
    assert.equal(calls[0]!.init.method, 'POST');
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer re_test');
    assert.equal(headers['Idempotency-Key'], 'n-1');
    assert.deepEqual(JSON.parse(calls[0]!.init.body as string), {
      from: 'Nova <notifications@technavious.com>',
      to: ['training@technavious.com'],
      subject: 'Hello',
      html: '<p>Plain</p>',
      text: 'Plain',
    });
  });

  it('retries a network error, a 429 and a 5xx, and nothing else', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const network = await resendProvider('re_test', failing).send({
      from: 'a@b.c',
      to: ['d@e.f'],
      subject: 's',
      text: 't',
      html: 'h',
      idempotencyKey: 'k',
    });
    assert.equal(network.ok, false);
    assert.equal(!network.ok && network.retry, true);
    assert.equal(!network.ok && network.kind, 'connection');

    const cases: [number, string, string, boolean, string][] = [
      [429, 'rate_limit_exceeded', 'Too many requests', true, 'busy'],
      [
        429,
        'daily_quota_exceeded',
        'You have reached your daily email sending quota',
        true,
        'out_of_credit',
      ],
      [429, 'monthly_quota_exceeded', 'Monthly quota', true, 'out_of_credit'],
      [500, 'application_error', 'Unexpected', true, 'unavailable'],
      [503, 'service_unavailable', 'Down', true, 'unavailable'],
      [409, 'concurrent_idempotent_requests', 'In progress', true, 'busy'],
      [401, 'missing_api_key', 'Missing API key in the authorization header', false, 'bad_key'],
      [403, 'restricted_api_key', 'This API key is restricted', false, 'bad_key'],
      [400, 'validation_error', 'API key is invalid', false, 'bad_key'],
      [
        403,
        'validation_error',
        'The technavious.com domain is not verified.',
        false,
        'not_configured',
      ],
      [422, 'missing_required_field', 'Missing `to` field', false, 'rejected'],
      [409, 'invalid_idempotent_request', 'Same key, different body', false, 'rejected'],
      [404, 'not_found', 'Not found', false, 'rejected'],
    ];
    for (const [status, name, message, retry, kind] of cases) {
      const outcome = classifyResendFailure(status, { name, message });
      assert.equal(outcome.retry, retry, `${status} ${name}`);
      assert.equal(outcome.kind, kind, `${status} ${name}`);
      assert.match(outcome.detail, new RegExp(`^Resend ${status} ${name}`));
    }
  });

  it('reads a failed response through fetch as the classification says', async () => {
    const fetchStub = (async () =>
      Response.json(
        { statusCode: 429, name: 'rate_limit_exceeded', message: 'Slow down' },
        { status: 429 },
      )) as unknown as typeof fetch;
    const outcome = await resendProvider('re_test', fetchStub).send({
      from: 'a@b.c',
      to: ['d@e.f'],
      subject: 's',
      text: 't',
      html: 'h',
      idempotencyKey: 'k',
    });
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.retry, true);
    assert.equal(!outcome.ok && outcome.status, 429);
  });
});

// --------------------------------------------------------------- without a key

describe('without a key', () => {
  it('has no provider until RESEND_API_KEY is set, and one once it is', () => {
    assert.equal(configuredProvider(), null);
    process.env.RESEND_API_KEY = '   ';
    assert.equal(configuredProvider(), null);
    process.env.RESEND_API_KEY = 're_live_key';
    assert.equal(configuredProvider()?.name, 'resend');
  });

  it('holds every notification, sends nothing, and says why', async () => {
    const { record } = await enqueue(input(), { store, provider: null, now: clock });
    assert.equal(record.status, 'held');
    assert.equal(record.lastError, HELD_REASON);
    assert.equal(record.attempts, 0);
    assert.equal((await attempt(record.id, { store, provider: null, now: clock })).outcome, 'held');
    assert.deepEqual(await sendDue({ store, provider: null, now: clock }), {
      sent: 0,
      retrying: 0,
      failed: 0,
      held: 0,
      left: 0,
    });
    assert.equal((await stored(record.id))?.status, 'held');
  });

  it('holds by default, with no key in the environment, and sends nothing', async () => {
    let fetched = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetched += 1;
      return Response.json({});
    }) as typeof fetch;
    try {
      const { record } = await enqueue(input(), { store, now: clock });
      assert.equal(record.status, 'held');
      await attempt(record.id, { store, now: clock });
      await runNotifications({ store, now: clock, orgIds: [] });
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(fetched, 0);
  });

  it('sends what was held on the first run once a key exists', async () => {
    const first = await enqueue(input(), { store, provider: null, now: clock });
    const second = await enqueue(input({ dedupeKey: 'another' }), {
      store,
      provider: null,
      now: clock,
    });

    const provider = scripted(OK);
    const report = await runNotifications({ store, provider, now: clock, orgIds: [] });
    assert.equal(report.configured, true);
    assert.equal(report.sent, 2);
    assert.equal(provider.sent.length, 2);
    assert.equal((await stored(first.record.id))?.status, 'sent');
    assert.equal((await stored(second.record.id))?.status, 'sent');
  });

  it('tells the developer log, once a run, that email is not going out', async () => {
    await enqueue(input(), { store, provider: null, now: clock });
    const report = await runNotifications({ store, provider: null, now: clock, orgIds: [] });
    assert.equal(report.configured, false);
    assert.equal(report.stillHeld, 1);

    const today = new Date().toISOString().slice(0, 10);
    const logged = (await entriesFor(today)).filter(
      (entry) => entry.provider === 'resend' && entry.kind === 'not_configured',
    );
    assert.ok(logged.length >= 1);
    assert.match(logged[0]!.detail, /RESEND_API_KEY is not set/);
  });
});

// ---------------------------------------------------------------------- events

function person(id: string, role: Role, extra: Partial<SignedInPerson> = {}): SignedInPerson {
  return {
    id,
    orgId: ORG,
    homeOrgId: ORG,
    platform: false,
    email: `${id}@acme.example`,
    emailKey: `${id}@acme.example`,
    name: id,
    role,
    createdAt: '2026-11-01T00:00:00.000Z',
    lastSeenAt: null,
    ...extra,
  };
}

const technavious = person('srikant', 'admin', { platform: true, homeOrgId: 'technavious' });
const hr = person('hr', 'admin', { name: 'Hema Rao' });
const fran = person('fran', 'facilitator', { name: 'Fran Mehta' });
const asha = person('asha', 'trainee', { name: 'Asha Rao' });
const ben = person('ben', 'trainee', { name: 'Ben Okafor' });

describe('the events', () => {
  let roster: DocumentRosterStore;
  const DECK_ID = 'safety-a1b2c3';

  beforeEach(async () => {
    roster = new DocumentRosterStore(scopedDocuments(store, ORG));
    resetRosterStore(roster, ORG);
    for (const who of [hr, fran, asha, ben]) {
      await roster.upsertPerson({
        id: who.id,
        email: who.email,
        name: who.name,
        role: who.role,
        orgId: ORG,
      });
    }
  });

  afterEach(() => {
    resetDeckStore();
    resetRosterStore();
  });

  it('writes one email when a session is set up, with what the training team needs', async () => {
    process.env.APP_URL = 'https://nova.example/';
    const decks = new DocumentDeckStore(scopedDocuments(store, ORG));
    resetDeckStore(decks, ORG);
    const deck: DeckRecord = {
      meta: { ...ISMS_DECK.meta, id: DECK_ID, title: 'Site <safety>', origin: 'uploaded' },
      slides: ISMS_DECK.slides.map((slide) => ({ ...slide })),
      topics: ISMS_DECK.topics.map((topic) => ({ ...topic })),
    };
    await decks.save(deck, 'published');
    await approveDeck(technavious, DECK_ID, { store });

    const session = await createSession(
      hr,
      {
        deckId: DECK_ID,
        facilitatorId: fran.id,
        participantIds: [asha.id, ben.id],
        scheduledFor: '2026-11-14T04:30:00Z',
      },
      { store },
    );

    const written = await all();
    assert.equal(written.length, 1);
    const [record] = written;
    assert.equal(record!.kind, 'session-set-up');
    assert.equal(record!.dedupeKey, `session-set-up:${ORG}:${session.id}`);
    assert.equal(record!.orgId, ORG);
    assert.equal(record!.status, 'held', 'no key in the tests, so nothing is sent');
    assert.equal(record!.subject, 'Session set up: Site <safety>, Sat 14 Nov, 10:00 IST');
    assert.match(record!.text, /Deck: Site <safety>/);
    assert.match(record!.text, /Facilitator: Fran Mehta <fran@acme\.example>/);
    assert.match(record!.text, /When: 14 November 2026, 10:00 IST/);
    assert.match(record!.text, /Participants: 2 participants/);
    assert.match(record!.text, new RegExp(`https://nova\\.example/sessions/${session.id}`));
    // Who is on it is not the email's business: a count, not names.
    assert.doesNotMatch(record!.text, /Asha|Ben/);
    assert.match(record!.html, /Site &lt;safety&gt;/);
    assert.doesNotMatch(record!.html, /<safety>/);

    // Reported again, it is the same event.
    await notifySessionSetUp(hr, session, 'Site <safety>', { store });
    assert.equal((await all()).length, 1);
  });

  it('sends nothing for a session refused, since nothing was set up', async () => {
    await assert.rejects(
      createSession(
        hr,
        { deckId: 'missing', facilitatorId: fran.id, participantIds: [asha.id] },
        {
          store,
        },
      ),
    );
    assert.equal((await all()).length, 0);
  });

  it('writes one digest for an upload that left participants incomplete', async () => {
    const results: UploadResult[] = [
      {
        line: 2,
        email: 'Asha@acme.example',
        status: 'created',
        profile: 'prefilled',
        missing: ['Education, with stream', 'Current department'],
      },
      { line: 3, email: 'ben@acme.example', status: 'updated', profile: 'prefilled', missing: [] },
      { line: 4, email: 'x@acme.example', status: 'rejected', reason: 'Bad row' },
      { line: 5, email: 'Asha@acme.example', status: 'duplicate', duplicateOf: 2 },
    ];
    await notifyIncompleteUpload(hr, results, { store, now: clock });
    await notifyIncompleteUpload(hr, results, { store, now: clock });

    const written = await all();
    assert.equal(written.length, 1, 'the same upload twice in a day is one email');
    const [record] = written;
    assert.equal(record!.kind, 'profiles-incomplete');
    assert.match(record!.dedupeKey, /^profiles-incomplete:upload:acme:2026-11-13:[0-9a-f]{16}$/);
    assert.match(record!.subject, /1 participant uploaded/);
    assert.match(record!.text, /- Asha Rao <Asha@acme\.example>: missing Education, Department/);
    assert.doesNotMatch(record!.text, /ben@acme/);
  });

  it('writes nothing for an upload where every profile is complete', async () => {
    await notifyIncompleteUpload(
      hr,
      [{ line: 2, email: 'ben@acme.example', status: 'created', missing: [] }],
      { store, now: clock },
    );
    assert.equal((await all()).length, 0);
  });

  it('lists participants of the next week’s sessions whose profiles are incomplete', async () => {
    const training = trainingStore(ORG, store);
    const base: TrainingSession = {
      id: 's-soon',
      deckId: DECK_ID,
      facilitatorId: fran.id,
      batchId: null,
      participantIds: [asha.id, ben.id, fran.id],
      scheduledFor: '2026-11-15T04:30:00.000Z',
      status: 'scheduled',
      attendance: {},
      createdBy: hr.id,
      createdAt: '2026-11-01T00:00:00.000Z',
      openedAt: null,
      closedAt: null,
      closedBy: null,
    };
    await training.saveSession(base);
    // Too far ahead, already over, and cancelled: none of them count.
    await training.saveSession({ ...base, id: 's-far', scheduledFor: '2026-12-30T04:30:00.000Z' });
    await training.saveSession({ ...base, id: 's-past', scheduledFor: '2026-11-01T04:30:00.000Z' });
    await training.saveSession({ ...base, id: 's-off', status: 'cancelled' });

    // Ben's uploaded profile has everything; Asha has none at all.
    await saveUploadedProfile(
      { id: ben.id, orgId: ORG, emailKey: ben.emailKey },
      {
        name: 'Ben Okafor',
        education: 'B.E., Electrical',
        yearsExperience: 4,
        department: 'Facilities',
        proficiency: 'intermediate',
        city: 'Pune',
      },
      hr.id,
      { store },
    );

    const found = await incompleteInUpcomingSessions(ORG, { store, now: clock });
    assert.deepEqual(found, [
      {
        name: 'Asha Rao',
        email: 'asha@acme.example',
        missing: ['Name', 'Education', 'Years of experience', 'Department', 'Proficiency'],
        session: 'Sun 15 Nov, 10:00 IST',
      },
    ]);
    // Nothing a profile says, only that fields are missing.
    assert.equal(await writeUpcomingDigests({ store, now: clock, orgIds: [ORG] }), 1);
    assert.equal(await writeUpcomingDigests({ store, now: clock, orgIds: [ORG] }), 0);
    const [digest] = await all();
    assert.equal(digest!.dedupeKey, 'profiles-incomplete:daily:acme:2026-11-13');
    assert.doesNotMatch(digest!.text, /Pune|Electrical|Facilities/);
    assert.match(digest!.text, /Asha Rao <asha@acme\.example>: missing Name, Education/);
  });

  it('writes no digest for a customer whose profiles are switched off', async () => {
    const saved = process.env.PROFILES_ENABLED;
    process.env.PROFILES_ENABLED = 'off';
    try {
      assert.equal(await writeUpcomingDigests({ store, now: clock, orgIds: [ORG] }), 0);
    } finally {
      if (saved === undefined) delete process.env.PROFILES_ENABLED;
      else process.env.PROFILES_ENABLED = saved;
    }
  });
});

describe('the email itself', () => {
  it('escapes everything somebody typed in the HTML', () => {
    assert.equal(
      escapeHtml(`<a href="x">'&'</a>`),
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
    const html = renderHtml({
      subject: 's',
      intro: '<script>alert(1)</script>',
      facts: [['Deck', '<b>x</b>']],
      link: { label: 'Open', url: 'https://nova.example/sessions/s-1?a=1&b=2' },
    });
    assert.doesNotMatch(html, /<script>|<b>/);
    assert.match(html, /href="https:\/\/nova\.example\/sessions\/s-1\?a=1&amp;b=2"/);
  });
});

// -------------------------------------------------------------------- the cron

describe('the cron route', () => {
  const call = async (headers: Record<string, string> = {}) => {
    const { GET } = await import('../../app/api/cron/notifications/route');
    return GET(new Request('https://nova.example/api/cron/notifications', { headers }));
  };

  it('is a 404 to everybody while CRON_SECRET is unset', async () => {
    assert.equal((await call()).status, 404);
    assert.equal((await call({ authorization: 'Bearer anything' })).status, 404);
  });

  it('is a 404 without the secret, or with the wrong one', async () => {
    process.env.CRON_SECRET = 'the-right-secret';
    assert.equal((await call()).status, 404);
    assert.equal((await call({ authorization: 'Bearer the-wrong-secret' })).status, 404);
    assert.equal((await call({ authorization: 'the-right-secret' })).status, 404);
  });

  it('is scheduled once a day in vercel.json, which the Hobby plan allows', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      crons: { path: string; schedule: string }[];
    };
    const cron = config.crons.find((entry) => entry.path === '/api/cron/notifications');
    assert.ok(cron, 'the notifications run is not scheduled');
    const [minute, hour, ...rest] = cron.schedule.split(' ');
    assert.match(minute!, /^\d+$/);
    assert.match(hour!, /^\d+$/);
    assert.deepEqual(rest, ['*', '*', '*']);
  });

  it('is secured as the retention job is', () => {
    const source = readFileSync('src/app/api/cron/notifications/route.ts', 'utf8');
    assert.match(source, /if \(!authorised\(request\)\) return notFound\(\);/);
    assert.match(source, /timingSafeEqual/);
  });
});

// ---------------------------------------------------------------- who sees it

describe('who sees the notifications', () => {
  // Line endings normalised, since a Windows checkout has CRLF.
  const read = (path: string) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');

  it('is Technavious’s administrators, not a customer’s', () => {
    assert.equal(isAdministrator(technavious), true);
    assert.equal(
      isAdministrator({ role: 'admin', platform: false, homeOrgId: 'technavious' }),
      true,
    );
    assert.equal(isAdministrator(hr), false);
    assert.equal(isAdministrator(fran), false);
    assert.equal(isAdministrator(asha), false);
  });

  it('guards the page with the administrator page guard, a 404 for anybody else', () => {
    const page = read('src/app/platform/notifications/page.tsx');
    assert.match(page, /await requireAdministratorPage\('\/platform\/notifications'\)/);
  });

  it('guards both of the API’s methods before anything is read', () => {
    const route = read('src/app/api/platform/notifications/route.ts');
    for (const [method, reads] of [
      ['GET', 'recentNotifications('],
      ['POST', 'retryNow('],
    ] as const) {
      const body = route.slice(route.indexOf(`export async function ${method}`));
      const guard = body.indexOf(
        'const gate = await checkAdministrator();\n  if (!gate.ok) return gate.response;',
      );
      assert.ok(guard >= 0, `${method} is not guarded`);
      assert.ok(guard < body.indexOf(reads), `${method} reads before it is guarded`);
    }
    assert.doesNotMatch(
      route,
      /\bcheckAdmin\(\)|requireAdmin\(\)/,
      'a company administrator could get in',
    );
  });

  it('keeps the retry button free of anything server-only', () => {
    const button = read('src/app/platform/notifications/RetryNotification.tsx');
    assert.match(button, /^'use client';/);
    for (const line of button.split('\n').filter((entry) => entry.startsWith('import'))) {
      assert.doesNotMatch(line, /outbox|events|job|provider|config/, line);
    }
  });
});
