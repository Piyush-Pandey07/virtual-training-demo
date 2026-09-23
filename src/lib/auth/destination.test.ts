import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { safeDestination } from './destination';

/**
 * Where somebody lands after signing in.
 *
 * The destination must never leave this site, because it is followed at the moment a
 * person trusts the page most. `guarded-pages.test.ts` covers the other half: that every
 * page says where a signed-out visitor was going in the first place.
 *
 * The awkward characters are built from their codes rather than typed. A backslash, a
 * tab and a newline are exactly what gets silently rewritten on the way into a file, and
 * this repository has been caught that way before: `\b` in a template literal is a
 * backspace, not a word boundary. A test of escaping should not depend on escaping.
 */

const BACKSLASH = String.fromCharCode(92);
const TAB = String.fromCharCode(9);
const NEWLINE = String.fromCharCode(10);
const RETURN = String.fromCharCode(13);

/** Every way off the site that has been found, including the ones the old check let in. */
const OFF_SITE: [string, string][] = [
  ['https://evil.com', 'an absolute address'],
  ['//evil.com', 'a protocol-relative address'],
  ['/' + BACKSLASH + 'evil.com', 'a backslash, which the parser reads as a slash'],
  ['/' + TAB + '/evil.com', 'a tab, which the parser strips'],
  ['/' + NEWLINE + '/evil.com', 'a newline, which the parser strips'],
  ['/' + RETURN + '/evil.com', 'a carriage return, which the parser strips'],
  ['/.//evil.com', 'a dot segment that normalises to two slashes'],
  [' //evil.com', 'leading whitespace in front of two slashes'],
  ['javascript:alert(1)', 'a script address'],
  ['data:text/html,<script>alert(1)</script>', 'a data address'],
];

describe('the destination after sign-in', () => {
  it('goes home when there is nowhere to go', () => {
    assert.equal(safeDestination(undefined), '/');
    assert.equal(safeDestination(null), '/');
    assert.equal(safeDestination(''), '/');
  });

  it('keeps a real path on this site exactly as it was', () => {
    for (const path of [
      '/',
      '/decks',
      '/decks/pptxgenjs-presentation-7te7df',
      '/decks/pptxgenjs-presentation-7te7df/progress',
      '/people/WhLJhWtF29YgoScuHIH9wqtaUhx1',
      '/session?deck=isms',
      '/decks/isms#slides',
    ]) {
      assert.equal(safeDestination(path), path, `${path} should have survived untouched`);
    }
  });

  for (const [next, why] of OFF_SITE) {
    it(`refuses ${why}`, () => {
      assert.equal(safeDestination(next), '/', `${JSON.stringify(next)} was let through`);
    });
  }

  it('refuses every case the old check let through', () => {
    // The regression this file exists for. If the old check ever comes back, these are
    // the cases it fails on, and this says so rather than leaving it to a reader.
    const oldCheck = (n: string) => n.startsWith('/') && !n.startsWith('//');
    const beaten = OFF_SITE.map(([next]) => next).filter(oldCheck);
    assert.ok(beaten.length >= 3, 'the table no longer holds the cases that beat the old check');
    for (const next of beaten) assert.equal(safeDestination(next), '/');
  });

  it('only ever returns something that stays on the site it is resolved against', () => {
    // The property that matters, stated directly rather than case by case: whatever
    // comes out, a browser resolving it against this site stays on this site.
    const site = 'https://virtual-training-demo.vercel.app';
    for (const [next] of OFF_SITE) {
      const landed = new URL(safeDestination(next), site + '/signin');
      assert.equal(landed.origin, site, `${JSON.stringify(next)} escaped to ${landed.origin}`);
    }
  });

  it('is what the sign-in page uses, rather than a check of its own', () => {
    const page = readFileSync('src/app/signin/page.tsx', 'utf8');
    assert.match(page, /safeDestination\(next\)/);
    assert.doesNotMatch(
      page,
      /startsWith\('\/\/'\)/,
      'the sign-in page has its own startsWith check again, which is the one that failed',
    );
  });
});
