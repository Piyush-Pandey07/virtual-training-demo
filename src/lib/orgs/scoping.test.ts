import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Nothing may reach a store without saying whose it is.
 *
 * `isolation.test.ts` proves two customers cannot see each other. This one guards the
 * way that stops being true: not by anybody writing a cross-customer query, but by the
 * organisation quietly acquiring a default, or by a route naming one directly instead
 * of taking it from whoever is signed in.
 *
 * Both are one line, both look reasonable in a diff, and neither fails a type check.
 * So they are read out of the source, the same way the authorisation boundary is.
 */

/**
 * Everything that takes a customer and then reads their data.
 *
 * The three registries were the original list, on the reasoning that a store is the
 * only way to reach a customer's rows. That was true and is no longer sufficient: a
 * page reaches most of its data through a helper that takes the organisation and
 * builds the store itself, so `peopleOverview('technavious')` reads somebody else's
 * roster while never naming a store at all. It compiles, and it passed this file.
 *
 * So the list is every function whose first argument decides whose data comes back.
 * Anything new of that shape belongs here on the day it is written.
 */
const STORES = [
  // The registries.
  'rosterStore',
  'deckStore',
  'assetStore',
  // The helpers that take an organisation and build one.
  'listDecks',
  'loadStoredDeck',
  'defaultDeck',
  'peopleOverview',
  'trainingFor',
  'progressForDeck',
  'customerOverview',
  // Usage and limits. These decide whose meter moves and whose cap is checked, which
  // is the same question in a different currency: metering one customer's session
  // against another's allowance is a billing error rather than a data leak, and it
  // would be just as invisible.
  'usageFor',
  'usageHistory',
  'mayStartSession',
  'record',
  'recordQuietly',
  // Reads a deck's own content, including the rendered pages sent to the model.
  'loadDeck',
  'slideImageParts',
  'analyseSlideBatch',
  'analyseSlideDetail',
  'analyseTopics',
  // The lifecycle operations. Naming the wrong customer here does not leak data, it
  // destroys or suspends theirs, which is the worse end of the same mistake.
  'purge',
  'suspend',
  'resume',
] as const;

/**
 * Functions that take an organisation first and are still not store calls.
 *
 * They exist because the shape alone cannot tell a reader from a string builder, and
 * guarding a string builder would be wrong: `deckPrefix('acme')` in a path test is
 * exactly what that function is for. Each entry says why it is safe.
 */
const ORG_FIRST_BUT_NOT_A_READER: Record<string, string> = {
  orgPrefix: 'Builds a storage prefix from an id. Touches no store.',
  deckPrefix: 'Builds a storage prefix from an id. Touches no store.',
  rosterPrefix: 'Builds a storage prefix from an id. Touches no store.',
  assertUsableOrgId: 'Validates the id itself and reads nothing.',
  emptyUsage: 'Constructs a zeroed counter record. Reads nothing.',
  forgetDeckStores: 'Evicts a cache entry. Reads no rows.',
  forgetRosterStore: 'Evicts a cache entry. Reads no rows.',
};

/**
 * The list above is hand-written and has now been short twice.
 *
 * First it held three registries, and a helper that built a store internally walked
 * straight past it. Widening it to nine still missed six more. So the guard below
 * derives the same set mechanically and fails when the two disagree, which turns
 * "somebody remembered" into "the compiler noticed".
 */
const ORG_FIRST_ARGUMENT = /export (?:async )?function (\w+)\(\s*orgId: string/g;

/**
 * A store call whose customer is written into the code: a quoted string, or the home
 * constant, rather than something read off whoever is signed in.
 *
 * Built in one place because writing it twice got it wrong once — inside a template
 * literal `\(` is just `(` and `\s` is just `s`, so the second copy matched nothing
 * and the check it fed passed on every file. A test that cannot fail is worse than no
 * test, since it also reports success.
 */
function namesAnOrg(store: string): RegExp {
  return new RegExp(`${store}\\(\\s*(['\`]|HOME_ORG_ID)`);
}

/**
 * Files that may name an organisation directly, and why.
 *
 * Every entry is a place with no signed-in person to ask. Adding one is a deliberate
 * act: a route on this list is a route serving one customer's data to everybody.
 */
const MAY_NAME_AN_ORG: Record<string, string> = {
  'src/app/api/auth/dev/route.ts':
    'The development sign-in, which refuses to exist wherever real sign-in works. There is one customer on a developer machine and it is the home one.',
  'src/app/signin/page.tsx':
    'Reads people only to populate the development sign-in picker, which exists only where Firebase does not.',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const FILES = walk('src').map((path) => path.split('\\').join('/'));

describe('the registries', () => {
  it('require an organisation, with no default', () => {
    // A default is the whole hole reopened in one line: `deckStore()` would compile
    // again everywhere, and every call site that forgot would read one shared library.
    const sources = [
      ['src/lib/roster/registry.ts', 'rosterStore'],
      ['src/lib/decks/registry.ts', 'deckStore'],
      ['src/lib/decks/registry.ts', 'assetStore'],
    ] as const;

    for (const [path, fn] of sources) {
      const source = readFileSync(path, 'utf8');
      const signature = new RegExp(`export function ${fn}\\(([^)]*)\\)`);
      const match = signature.exec(source);

      assert.ok(match, `${fn} is no longer exported from ${path}`);
      assert.match(match[1] ?? '', /orgId: string/, `${fn} does not take an organisation`);
      assert.doesNotMatch(
        match[1] ?? '',
        /=/,
        `${fn} gives its organisation a default, which makes an unscoped call legal again`,
      );
    }
  });
});

describe('every store call', () => {
  it('names no organisation of its own outside the places allowed to', () => {
    // A literal or a constant here means a file that serves whichever customer is
    // written into it, rather than the one asking. That is not a type error and reads
    // like ordinary code, so it is caught by looking.
    const offenders: string[] = [];

    for (const path of FILES) {
      if (path in MAY_NAME_AN_ORG) continue;
      const source = readFileSync(path, 'utf8');

      for (const store of STORES) {
        if (namesAnOrg(store).test(source)) {
          offenders.push(`${path} calls ${store} with a fixed organisation`);
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `these take their customer from the code rather than from who is signed in:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('has a reason written down for each place that does', () => {
    for (const [path, reason] of Object.entries(MAY_NAME_AN_ORG)) {
      assert.ok(
        FILES.includes(path),
        `${path} is allowed to name an organisation but does not exist`,
      );
      assert.ok(reason.length > 40, `${path} is on the allowlist without a reason worth reading`);

      // An entry that no longer names an organisation is an entry that has quietly
      // stopped being an exception, and should come off the list rather than sit
      // there granting permission nothing is asking for.
      const source = readFileSync(path, 'utf8');
      assert.ok(
        STORES.some((store) => namesAnOrg(store).test(source)),
        `${path} is on the allowlist but names no organisation. Remove it.`,
      );
    }
  });

  it('found enough files to have actually looked', () => {
    // A broken walk would pass every assertion above by examining nothing.
    assert.ok(FILES.length >= 60, `only walked ${FILES.length} files`);
    assert.ok(
      FILES.some((path) => path.endsWith('src/app/api/chat/route.ts')),
      'the walk missed a file known to exist',
    );
  });
});

/**
 * Who may ask which customer holds an address, and why.
 *
 * `orgIdHolding` is the only lookup in the app that spans customers. It exists to
 * enforce that somebody belongs to exactly one, so the places that need it are the
 * places that put people into customers or move them between them. Anything else
 * calling it is either a second cross-customer read or a mistake, and both want
 * noticing rather than allowing.
 */
const MAY_LOOK_ACROSS_CUSTOMERS: Record<string, string> = {
  'src/lib/orgs/store.ts': 'Defines it.',
  'src/app/api/platform/move/route.ts':
    'Moving somebody between customers has to find which one currently holds them, and that is the question this answers. Platform staff only.',
};

describe('the one lookup that spans customers', () => {
  it('is called only where moving people between customers requires it', () => {
    const callers = FILES.filter(
      (path) =>
        !(path in MAY_LOOK_ACROSS_CUSTOMERS) && readFileSync(path, 'utf8').includes('orgIdHolding'),
    );

    assert.deepEqual(callers, [], `unexpected cross-customer lookups in: ${callers.join(', ')}`);
  });

  it('has a reason written down for each place that does', () => {
    for (const [path, reason] of Object.entries(MAY_LOOK_ACROSS_CUSTOMERS)) {
      assert.ok(FILES.includes(path), `${path} is allowed to look across customers but is gone`);
      assert.ok(
        readFileSync(path, 'utf8').includes('orgIdHolding'),
        `${path} no longer looks across customers. Remove it from the list.`,
      );
      assert.ok(reason.length > 8, `${path} is on the list without a reason`);
    }
  });
});

describe('the list of org-scoped functions', () => {
  it('holds every exported function whose first argument is an organisation', () => {
    // The check that would have caught both misses. Rather than trusting the list to be
    // complete, find the same set by shape: an exported function taking `orgId: string`
    // first decides whose data comes back, whoever wrote it and whenever.
    const found = new Set<string>();
    for (const path of FILES) {
      const source = readFileSync(path, 'utf8');
      for (const [, name] of source.matchAll(ORG_FIRST_ARGUMENT)) found.add(name);
    }

    const classified = new Set<string>([...STORES, ...Object.keys(ORG_FIRST_BUT_NOT_A_READER)]);
    const unclassified = [...found].filter((name) => !classified.has(name)).sort();

    assert.deepEqual(
      unclassified,
      [],
      `these take an organisation first and are neither guarded nor excused, so a ` +
        `hardcoded customer in one of them would pass this file unnoticed: ` +
        `${unclassified.join(', ')}. Add each to STORES, or to ` +
        `ORG_FIRST_BUT_NOT_A_READER with a reason.`,
    );
  });

  it('does not list a function that no longer exists', () => {
    // The other direction. A name left behind after a rename guards nothing and reads
    // like coverage, which is the more dangerous of the two failures.
    const sources = FILES.map((path) => readFileSync(path, 'utf8')).join('\n');
    // Concatenation rather than a template literal, and deliberately. `\b` inside a
    // template literal is the backspace character, not a word boundary, so the first
    // version of this line searched for U+0008 and reported every name as missing.
    // That is the same trap `namesAnOrg` above carries a comment about, hit again in
    // the same file by writing the escape a third way.
    const stale = STORES.filter((name) => !new RegExp('\\b' + name + '\\b').test(sources));

    assert.deepEqual(stale, [], `guarded names that appear nowhere in src: ${stale.join(', ')}`);
  });
});
