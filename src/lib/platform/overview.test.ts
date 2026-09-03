import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { OPEN_SESSION_MINUTES } from './overview-types';

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
