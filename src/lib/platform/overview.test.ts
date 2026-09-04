import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { OPEN_SESSION_MINUTES } from './overview-types';
import { summariseCustomer } from './overview';
import type { DeckSummary } from '../decks/store';
import type { Attempt, Person } from '../roster/types';

/**
 * The one screen that reads across customers.
 *
 * `overview.ts` is `server-only` and reads Firestore, so what is checked here is the
 * part where the mistakes would be: that it stays inside the organisation it is given,
 * and that it carries counts and names rather than anything a support call has no
 * business seeing. A page built to answer "is anybody using it" is exactly the place
 * where somebody later adds "and what did they ask", and that is the line worth
 * holding by a test rather than by memory.
 */

const SOURCE = readFileSync('src/lib/platform/overview.ts', 'utf8');

describe('the cross-customer overview', () => {
  it('reads every store through the organisation it was given', () => {
    // The whole isolation design rests on stores being scoped at construction. This
    // module is the one place in the app that legitimately runs per organisation in a
    // loop, so an unscoped call here would be both easy to write and invisible.
    for (const call of ['rosterStore(', 'listDecks(']) {
      const uses = [...SOURCE.matchAll(new RegExp(`${call.replace('(', '\\(')}([^)]*)\\)`, 'g'))];
      assert.ok(uses.length > 0, `${call} is no longer called, so this test checks nothing`);
      for (const [, argument] of uses) {
        assert.equal(
          argument.trim(),
          'orgId',
          `${call}${argument}) does not take the organisation this overview is for`,
        );
      }
    }
  });

  it('does not reach for anything a trainee said', () => {
    // Attempts carry covered slides and timings, which is what the counts are made of.
    // Transcripts, chat turns and deck content are a different matter: none of them
    // belong on a customer list, and none of them should start appearing because the
    // shape of a row made it convenient.
    for (const forbidden of ['transcript', 'messages', 'internalNotes', 'narrationBrief']) {
      assert.ok(
        !SOURCE.includes(forbidden),
        `the overview now reads ${forbidden}, which a customer list has no reason to show`,
      );
    }
  });

  it('marks platform staff so a customer is not credited with an administrator', () => {
    // Technavious staff are administrators inside every customer. Listing them without
    // saying so would answer "who runs this company" with our own support team, and
    // the honest answer for a customer with no administrator of their own is nobody.
    assert.match(SOURCE, /platform: isPlatformAdmin\(person\.email\)/);
  });

  it('calls a session open on recency rather than on a flag nothing sets', () => {
    // There is no "session ended" event -- a closed tab sends nothing. Deriving it from
    // the last recorded slide is the only honest option, and it is why the window is a
    // named constant the screen can print rather than a number buried in a comparison.
    assert.match(SOURCE, /attempt\.lastSeenAt < cutoff/);
    assert.match(SOURCE, /OPEN_SESSION_MINUTES \* 60_000/);
    assert.ok(
      OPEN_SESSION_MINUTES >= 5,
      'a window shorter than a slide would drop sessions that are still being attended',
    );
  });
});

describe('what the client half is allowed to import', () => {
  it('takes its types from the module with no storage behind it', () => {
    // The client/server import test in deck.test.ts already fails the build if this
    // regresses; this says why the split exists, next to the thing it protects.
    const types = readFileSync('src/lib/platform/overview-types.ts', 'utf8');
    assert.ok(!types.includes("'server-only'"), 'the shared types became server-only');
    assert.ok(!/^import /m.test(types), 'the shared types now import something');

    const list = readFileSync('src/app/platform/CustomerList.tsx', 'utf8');
    assert.ok(list.includes("'use client'"), 'CustomerList is no longer a client component');
    assert.ok(
      !/from '@\/lib\/platform\/overview'/.test(list),
      'the client list imports the server-only reader again',
    );
  });
});

/**
 * The counting itself, by calling it.
 *
 * The scans above pin the rules that must not change. They cannot tell you whether the
 * arithmetic is right, because they never run it: the first version of this file read
 * `overview.ts` as text and asserted on the text, so the cutoff, the sort and every
 * count shipped with no behavioural coverage at all.
 */

const NOW = new Date('2026-06-15T12:00:00.000Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

function person(over: Partial<Person> & { id: string }): Person {
  return {
    email: `${over.id}@example.com`,
    emailKey: `${over.id}@example.com`,
    name: over.id,
    role: 'trainee',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: null,
    ...over,
  };
}

function deck(id: string, status: 'draft' | 'published' = 'published'): DeckSummary {
  return {
    id,
    title: `Deck ${id}`,
    subtitle: '',
    status,
    slideCount: 10,
    estimatedMinutes: 15,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    readOnly: false,
    origin: 'uploaded',
  } as DeckSummary;
}

function attempt(personId: string, deckId: string, over: Partial<Attempt> = {}): Attempt {
  return {
    personId,
    deckId,
    covered: [],
    lastSlideId: null,
    slideCount: 10,
    totalSeconds: 900,
    startedAt: minutesAgo(30),
    lastSeenAt: minutesAgo(30),
    completedAt: null,
    ...over,
  };
}

describe('counting what a customer is doing', () => {
  it('separates finished sittings from unfinished ones', () => {
    const out = summariseCustomer(
      [person({ id: 'a' }), person({ id: 'b' })],
      [
        {
          deck: deck('d1'),
          attempts: [
            attempt('a', 'd1', { completedAt: minutesAgo(60) }),
            attempt('b', 'd1'),
          ],
        },
      ],
      NOW,
    );

    assert.equal(out.sessions.completed, 1);
    assert.equal(out.sessions.unfinished, 1);
  });

  it('calls a session open only while it is inside the window', () => {
    // The whole point of the ten minutes. One attempt touched a moment ago and one
    // abandoned half an hour ago are both unfinished; only the first is open.
    const out = summariseCustomer(
      [person({ id: 'recent' }), person({ id: 'stale' })],
      [
        {
          deck: deck('d1'),
          attempts: [
            attempt('recent', 'd1', { lastSeenAt: minutesAgo(OPEN_SESSION_MINUTES - 1) }),
            attempt('stale', 'd1', { lastSeenAt: minutesAgo(OPEN_SESSION_MINUTES + 1) }),
          ],
        },
      ],
      NOW,
    );

    assert.equal(out.sessions.unfinished, 2, 'both are unfinished whatever their age');
    assert.deepEqual(
      out.sessions.open.map((s) => s.personEmail),
      ['recent@example.com'],
      'the stale attempt was reported as open',
    );
  });

  it('puts the most recently touched session first', () => {
    const out = summariseCustomer(
      [person({ id: 'older' }), person({ id: 'newer' })],
      [
        {
          deck: deck('d1'),
          attempts: [
            attempt('older', 'd1', { lastSeenAt: minutesAgo(8) }),
            attempt('newer', 'd1', { lastSeenAt: minutesAgo(2) }),
          ],
        },
      ],
      NOW,
    );

    assert.deepEqual(
      out.sessions.open.map((s) => s.personName),
      ['newer', 'older'],
    );
  });

  it('skips an attempt whose person is gone rather than showing an id', () => {
    // A row removed while a session was open leaves the attempt behind. Showing
    // "local-abc123 is in a session" would be worse than showing nothing.
    const out = summariseCustomer(
      [],
      [{ deck: deck('d1'), attempts: [attempt('vanished', 'd1', { lastSeenAt: minutesAgo(1) })] }],
      NOW,
    );

    assert.equal(out.sessions.unfinished, 1, 'it still counts towards unfinished');
    assert.deepEqual(out.sessions.open, [], 'but it cannot be named, so it is not listed');
  });

  it('takes the latest activity across every deck', () => {
    const out = summariseCustomer(
      [person({ id: 'a' })],
      [
        { deck: deck('d1'), attempts: [attempt('a', 'd1', { lastSeenAt: minutesAgo(90) })] },
        { deck: deck('d2'), attempts: [attempt('a', 'd2', { lastSeenAt: minutesAgo(20) })] },
      ],
      NOW,
    );

    assert.equal(out.sessions.lastActivityAt, minutesAgo(20));
  });

  it('counts people and decks the way the row reads them', () => {
    const out = summariseCustomer(
      [
        person({ id: 'boss', role: 'admin', lastSeenAt: minutesAgo(5) }),
        person({ id: 'staff1' }),
        person({ id: 'staff2', lastSeenAt: minutesAgo(5) }),
      ],
      [
        { deck: deck('published-1'), attempts: [] },
        { deck: deck('draft-1', 'draft'), attempts: [] },
      ],
      NOW,
    );

    assert.equal(out.people.total, 3);
    assert.equal(out.people.trainees, 2, 'an administrator was counted as a trainee');
    assert.equal(out.people.neverSignedIn, 1);
    assert.equal(out.decks.total, 2);
    assert.equal(out.decks.published, 1, 'a draft was counted as published');
    assert.deepEqual(
      out.people.admins.map((a) => a.name),
      ['boss'],
    );
  });

  it('reports nothing rather than throwing for a customer with no people or decks', () => {
    const out = summariseCustomer([], [], NOW);

    assert.equal(out.people.total, 0);
    assert.equal(out.decks.total, 0);
    assert.equal(out.sessions.completed, 0);
    assert.equal(out.sessions.unfinished, 0);
    assert.equal(out.sessions.lastActivityAt, null);
    assert.deepEqual(out.sessions.open, []);
  });
});
