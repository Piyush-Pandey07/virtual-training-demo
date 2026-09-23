import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Every page that sends a signed-out visitor to sign in says where they were going.
 *
 * Without it a link in an email lands on the home page after sign-in rather than on the
 * thing it linked to. The pages with a fixed address all did this. The three with an id
 * in their address did not, because the guard ran before the id was read, so there was
 * nothing to build the address from: /decks/[id], its progress page, and /people/[id],
 * which is the page an email about somebody links to.
 *
 * `destination.test.ts` covers the other half, that wherever this points is on this site.
 */

const BACKSLASH = String.fromCharCode(92);

function pagesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pagesUnder(path);
    return name === 'page.tsx' ? [path] : [];
  });
}

describe('every guarded page remembers where the visitor was going', () => {
  const guarded = pagesUnder('src/app')
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
    .filter(({ source }) => /require(?:User|Admin|AssignedDeck)Page\(/.test(source));

  it('finds the guarded pages, so a broken scan cannot pass silently', () => {
    assert.ok(guarded.length >= 8, `only found ${guarded.length} guarded pages`);
  });

  for (const { path, source } of guarded) {
    it(`${path.replaceAll(BACKSLASH, '/')} passes its own address to the guard`, () => {
      // An empty call sends a signed-out visitor to sign in and then to the home page,
      // which is how the three pages with an id in their address used to behave.
      assert.doesNotMatch(
        source,
        /require(?:User|Admin)Page\(\s*\)/,
        'this page sends a signed-out visitor to sign in without saying where they were going',
      );
      assert.doesNotMatch(
        source,
        /requireAssignedDeckPage\(\s*[^,()]+\s*\)/,
        'this page passes the deck but not where the visitor was going',
      );
    });
  }
});
