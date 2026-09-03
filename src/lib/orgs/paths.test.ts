import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { defaultDataRoot, defaultFilesystemRoot } from '../decks/store-fs';
import { deckPrefix, filesystemRoot, orgPrefix, rosterPrefix } from './scope';

/**
 * Where a customer's files go, and where they are looked for.
 *
 * These have to be the same place, and once they were not. The migration wrote decks
 * to `.data/orgs/{id}/decks` while the app read `.data/decks/orgs/{id}/decks`, because
 * one stripped a trailing "decks" from the base and the other did not.
 *
 * Nothing failed. Every deck was migrated successfully, into a directory nothing ever
 * opened, and the deck store seeded itself a fresh copy of the worked example at its
 * own location. The library showed exactly one deck and no error at all. That is the
 * shape of the bug this file exists to prevent: not a crash, a quiet disagreement
 * about a path.
 */

describe('the roots the app scopes', () => {
  it('does not already carry the segment scoping is about to add', () => {
    // `defaultDataRoot` is the one that gets scoped. If it ever ends in `decks` or
    // `roster` the doubling comes straight back.
    const root = defaultDataRoot().split('\\').join('/');

    assert.doesNotMatch(root, /\/decks$/, 'the data root ends in "decks", which scoping repeats');
    assert.doesNotMatch(root, /\/roster$/, 'the data root ends in "roster"');
    assert.match(root, /\.data$/, 'the data root is no longer .data');
  });

  it('puts each kind exactly once in the path', () => {
    const decks = filesystemRoot(defaultDataRoot(), 'acme', 'decks').split('\\').join('/');
    const roster = filesystemRoot(defaultDataRoot(), 'acme', 'roster').split('\\').join('/');

    assert.equal(decks.match(/\/decks/g)?.length, 1, `"decks" appears more than once: ${decks}`);
    assert.equal(roster.match(/\/roster/g)?.length, 1, `"roster" appears more than once: ${roster}`);
    assert.ok(decks.endsWith('.data/orgs/acme/decks'), decks);
    assert.ok(roster.endsWith('.data/orgs/acme/roster'), roster);
  });

  it('keeps the legacy root separate from the one that gets scoped', () => {
    // `defaultFilesystemRoot` still means "where decks used to live", and the migration
    // reads it. It must not become the thing the registries scope, which is what went
    // wrong.
    assert.notEqual(defaultFilesystemRoot(), defaultDataRoot());
    assert.match(defaultFilesystemRoot().split('\\').join('/'), /\.data\/decks$/);
  });
});

describe('the migration and the app agree on where decks live', () => {
  it('derives both ends from the same functions', () => {
    // The check that would have caught it. Reading the script rather than running it,
    // because running it moves files; what matters is that it computes its destination
    // the same way the registry computes where it reads.
    const migration = readFileSync('scripts/migrate-decks.ts', 'utf8');
    const registry = readFileSync('src/lib/decks/registry.ts', 'utf8');

    assert.match(
      migration,
      /filesystemRoot\(defaultDataRoot\(\), HOME_ORG_ID, 'decks'\)/,
      'the migration no longer writes where the registry reads',
    );
    assert.match(
      registry,
      /filesystemRoot\(base, orgId, 'decks'\)/,
      'the registry no longer reads a scoped root',
    );
    assert.match(
      registry,
      /DECK_STORE_DIR \?\? defaultDataRoot\(\)/,
      'the registry scopes something other than the data root',
    );

    // And the thing that actually broke: a base that already ends in the segment.
    assert.doesNotMatch(
      registry,
      /DECK_STORE_DIR \?\? defaultFilesystemRoot\(\)/,
      'the registry is scoping the legacy deck root again, which doubles the path',
    );
  });
});

describe('the blob prefixes', () => {
  it('name each kind once, under the customer', () => {
    assert.equal(orgPrefix('acme'), 'orgs/acme');
    assert.equal(deckPrefix('acme'), 'orgs/acme/decks');
    assert.equal(rosterPrefix('acme'), 'orgs/acme/roster');
  });

  it('refuse an organisation that could climb out of the prefix', () => {
    for (const bad of ['..', 'a/b', '']) {
      assert.throws(() => deckPrefix(bad), /not a usable organisation id/);
    }
  });
});
