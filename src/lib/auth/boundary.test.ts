import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * That every route and page decides who may reach it.
 *
 * This matters more than any individual check in the codebase, because the failure
 * it prevents is one nobody notices: somebody copies an existing route, adapts it,
 * and forgets the two lines at the top. Nothing breaks. The tests pass, the build
 * passes, the feature works — and there is a way in that nobody chose to open.
 *
 * Written by scanning source rather than by convention, in the same shape as the
 * client-bundle invariant in `deck.test.ts`. A rule that is only in somebody's head
 * is not a rule.
 *
 * Being public is allowed, and is a decision rather than an oversight: it has to be
 * written down here, with the reason, and reviewed like any other change.
 */

const PUBLIC_ROUTES: Record<string, string> = {
  'api/health/route.ts':
    'Diagnoses a deployment, including one where sign-in itself is misconfigured. Gating it would make it unreachable exactly when it is needed. Reports booleans, counts and variable names, never values.',
  'api/auth/session/route.ts':
    'How a session comes to exist. It verifies a Firebase token itself and refuses anybody the roster does not know.',
  'api/auth/register/route.ts':
    'How a first password is set. It refuses any address an administrator has not already added.',
  'api/auth/dev/route.ts':
    'The development sign-in. Refuses to run on Vercel, in a production build, or wherever Firebase is configured.',
};

const PUBLIC_PAGES: Record<string, string> = {
  'signin/page.tsx': 'The way in. Gating it would leave nobody able to sign in.',
};

/** Anything that establishes who the caller is counts as a guard. */
const GUARDS =
  /\b(checkUser|checkAdmin|checkAssignedDeck|requireUser|requireAdmin|requireAssignedDeck|requireUserPage|requireAdminPage|requireAssignedDeckPage)\b/;

function walk(dir: string, match: (name: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path, match));
    else if (match(entry.name)) found.push(path);
  }
  return found;
}

const APP = join('src', 'app');
const routes = walk(join(APP, 'api'), (name) => name === 'route.ts').map((path) =>
  path.slice(APP.length + 1).replace(/\\/g, '/'),
);
const pages = walk(APP, (name) => name === 'page.tsx').map((path) =>
  path.slice(APP.length + 1).replace(/\\/g, '/'),
);

function source(relative: string): string {
  return readFileSync(join(APP, relative), 'utf8');
}

describe('the authorisation boundary', () => {
  it('finds the routes and pages, so a broken scan cannot pass silently', () => {
    // The assertion everybody forgets. Without it, a glob that stops matching turns
    // this whole file into a test that proves nothing while still going green.
    // Raised as routes were added. A floor left behind is a floor that passes while
    // three of them have gone missing, which is the failure this line exists to catch.
    assert.ok(routes.length >= 19, `only found ${routes.length} routes`);
    assert.ok(pages.length >= 10, `only found ${pages.length} pages`);
  });

  it('has every API route either guarded or deliberately public', () => {
    const unguarded = routes.filter(
      (path) => !GUARDS.test(source(path)) && !(path in PUBLIC_ROUTES),
    );

    assert.deepEqual(
      unguarded,
      [],
      `these routes decide nothing about who may call them. Add a guard, or add them to PUBLIC_ROUTES with the reason: ${unguarded.join(', ')}`,
    );
  });

  it('has every page either guarded or deliberately public', () => {
    const unguarded = pages.filter((path) => !GUARDS.test(source(path)) && !(path in PUBLIC_PAGES));

    assert.deepEqual(
      unguarded,
      [],
      `these pages decide nothing about who may open them: ${unguarded.join(', ')}`,
    );
  });

  it('has no stale entry in either public list', () => {
    // A renamed route would otherwise leave its exemption behind, ready to bless a
    // future file that happens to land at the same path.
    for (const path of Object.keys(PUBLIC_ROUTES)) {
      assert.ok(routes.includes(path), `PUBLIC_ROUTES names ${path}, which does not exist`);
    }
    for (const path of Object.keys(PUBLIC_PAGES)) {
      assert.ok(pages.includes(path), `PUBLIC_PAGES names ${path}, which does not exist`);
    }
  });

  it('gives a reason for every public entry', () => {
    for (const [path, why] of [...Object.entries(PUBLIC_ROUTES), ...Object.entries(PUBLIC_PAGES)]) {
      assert.ok(why.length > 40, `${path} is public without a reason worth reading`);
    }
  });

  it('keeps identity in one place', () => {
    // Every route asks the guard who the caller is. A route working that out for
    // itself is how two answers to "who is this" come to exist, and they will
    // eventually disagree.
    //
    // Named functions rather than whole modules: this caught a real conflation when
    // it was written, and then caught a route importing `revokeSessions`, which acts
    // on an account rather than deciding whose request this is. Forbidding the module
    // would have made the rule mean something it does not.
    const RESOLVES_IDENTITY = /\b(currentPerson|verifySessionCookie|createSessionCookie)\b/;

    const offenders = routes.filter((path) => {
      if (path.startsWith('api/auth/')) return false;
      return RESOLVES_IDENTITY.test(source(path));
    });

    assert.deepEqual(
      offenders,
      [],
      `these routes resolve identity themselves instead of asking the guard: ${offenders.join(', ')}`,
    );
  });
});

describe('the Next.js request hook', () => {
  it('is not in the place that is silently ignored', () => {
    // Next 16 renamed the convention to proxy.ts and only looks at the top level or
    // src/. A file at src/app/proxy.ts is picked up by nothing at all — no warning,
    // no error — so it would look installed and do nothing.
    assert.ok(!existsSync(join('src', 'app', 'proxy.ts')), 'src/app/proxy.ts is never loaded');
  });

  it('does not have both conventions at once', () => {
    // Next throws E900 at build time when proxy.ts and middleware.ts both exist, and
    // the legacy one still runs, so the pair fails only once somebody adds the second.
    const proxy = existsSync(join('src', 'proxy.ts')) || existsSync('proxy.ts');
    const middleware = existsSync(join('src', 'middleware.ts')) || existsSync('middleware.ts');
    assert.ok(!(proxy && middleware), 'proxy.ts and middleware.ts cannot both exist');
  });
});
