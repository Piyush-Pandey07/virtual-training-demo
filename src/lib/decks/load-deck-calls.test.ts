import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Every call to loadDeck names the organisation first.
 *
 * `loadDeck(orgId, id = DEFAULT_DECK_ID)` compiles with one argument, so a call that
 * passes only a deck id type-checks and quietly asks the wrong organisation. The
 * progress route did exactly that from 1 September 2026, when stores were scoped to
 * their customer, and every uploaded deck's progress was refused with a 404 the
 * session swallows by design. This finds a one-argument call wherever it is written.
 */

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('loadDeck', () => {
  it('is never called with only a deck id', () => {
    const offenders: string[] = [];
    for (const path of walk('src')) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/\bloadDeck\(\s*([^,()]+?)\s*\)/g)) {
        offenders.push(`${path}: loadDeck(${match[1]})`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});
