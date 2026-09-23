import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * Asking who is signed in, and loading the deck under review, once per request.
 *
 * Both are asked for several times by one page load, and nothing about any single call
 * site looks wrong. The root layout asks who is signed in for the acting banner,
 * `generateMetadata` asks again, and the page's guard asks a third time. Each answer
 * checks revocation with Firebase, a network round trip measured at about 320ms from
 * Mumbai, plus a roster read. Counted on a production build: three lookups per load
 * before, one after.
 *
 * The failure this guards against is silent. Remove the `cache` and every page still
 * works, every test still passes, and each load quietly goes back to asking Firebase
 * three times, or eight on a cold start. So it is read out of the source, the same way
 * the thinking budget is.
 */

const SESSION = readFileSync('src/lib/auth/session.ts', 'utf8');
const DECK_PAGE = readFileSync('src/app/decks/[id]/page.tsx', 'utf8');

describe('who is signed in is answered once per request', () => {
  it('wraps the lookup in React cache', () => {
    assert.match(
      SESSION,
      /export const currentPerson = cache\(resolveCurrentPerson\);/,
      'currentPerson is no longer cached, so the layout, the metadata and the guard ' +
        'each verify the cookie with Firebase separately again',
    );
  });

  it('does not export the uncached lookup', () => {
    // An exported resolver is a way round the cache that looks like the proper call.
    assert.doesNotMatch(SESSION, /export (?:async )?function resolveCurrentPerson/);
  });

  it('imports cache from React, not a same-named lookalike', () => {
    assert.match(SESSION, /import \{ cache \} from 'react';/);
  });
});

describe('the deck under review is loaded once per request', () => {
  it('reads through the cached loader in both metadata and the page', () => {
    const uses = DECK_PAGE.match(/loadDeckOnce\(/g) ?? [];
    // One definition plus the two readers: generateMetadata and the page.
    assert.ok(
      uses.length >= 2,
      'the deck page no longer reads through loadDeckOnce, so metadata and the page ' +
        'each load the whole deck separately',
    );
  });

  it('calls loadStoredDeck only from inside the cache', () => {
    const direct = DECK_PAGE.match(/loadStoredDeck\(/g) ?? [];
    assert.equal(
      direct.length,
      1,
      'loadStoredDeck is called directly again somewhere on the deck page, outside ' +
        'the cached loader',
    );
    assert.match(
      DECK_PAGE,
      /const loadDeckOnce = cache\(\(orgId: string, id: string\) => loadStoredDeck\(orgId, id\)\);/,
    );
  });

  it('starts the roster read before waiting for the deck', () => {
    // It needs only the customer and the id. Queuing it behind the deck load cost
    // about 120ms for nothing.
    const roster = DECK_PAGE.indexOf('const rosterRead');
    const deck = DECK_PAGE.indexOf('await loadDeckOnce(admin.orgId, id)');
    assert.ok(roster >= 0 && deck >= 0, 'could not find the two reads to compare');
    assert.ok(roster < deck, 'the roster read waits for the deck again');
  });
});
