import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import nextConfig from '../../next.config';

/**
 * The headers every response carries.
 *
 * Read from the real config, through the same `headers()` Next.js calls, so what is
 * checked here is what is sent. A copy of the policy written out in the test could
 * agree with itself while the config drifted.
 */

async function sent(): Promise<{ source: string; headers: Map<string, string> }[]> {
  assert.ok(nextConfig.headers, 'the config sets headers');
  const rules = await nextConfig.headers();
  return rules.map((rule) => ({
    source: rule.source,
    headers: new Map(rule.headers.map(({ key, value }) => [key, value])),
  }));
}

async function header(name: string): Promise<string> {
  const [rule] = await sent();
  const value = rule!.headers.get(name);
  assert.ok(value !== undefined, `${name} is sent`);
  return value;
}

/** The policy as directive name to its sources. */
async function policy(): Promise<Map<string, string[]>> {
  const csp = await header('Content-Security-Policy');
  return new Map(
    csp
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...sources]) => [name!, sources]),
  );
}

describe('security headers', () => {
  it('apply to every path', async () => {
    const rules = await sent();
    assert.equal(rules.length, 1);
    assert.equal(rules[0]!.source, '/:path*');
  });

  it('let no other site frame a page, load a plugin, or move the base URL', async () => {
    const csp = await policy();
    assert.deepEqual(csp.get('frame-ancestors'), ["'none'"]);
    assert.deepEqual(csp.get('object-src'), ["'none'"]);
    assert.deepEqual(csp.get('base-uri'), ["'self'"]);
  });

  it('let the browser reach Deepgram and Firebase sign-in, and nothing else outside', async () => {
    // The whole list, so a source added later has to be added here too and argued for.
    const connect = (await policy()).get('connect-src') ?? [];
    assert.deepEqual(connect, [
      "'self'",
      'wss://api.deepgram.com',
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com',
    ]);
    assert.ok(!connect.includes('blob:'));
    assert.ok(!connect.includes('data:'));
  });

  it('frame nothing, now that sign-in has no popup or redirect frame', async () => {
    assert.deepEqual((await policy()).get('frame-src'), ["'none'"]);
  });

  it('run workers from this site only', async () => {
    // The pdf.js worker is copied into this site; nothing builds a worker from a blob.
    assert.deepEqual((await policy()).get('worker-src'), ["'self'"]);
  });

  it('keep other origins away from these windows and these responses', async () => {
    assert.equal(await header('Cross-Origin-Opener-Policy'), 'same-origin');
    assert.equal(await header('Cross-Origin-Resource-Policy'), 'same-origin');
  });

  it("allow 'unsafe-eval' only in development", async () => {
    // The tests never run as development, so this is the policy a deployment sends.
    assert.notEqual(process.env.NODE_ENV, 'development');
    const csp = await header('Content-Security-Policy');
    assert.doesNotMatch(csp, /'unsafe-eval'/);
    assert.ok(!(await policy()).get('connect-src')?.includes('ws:'));
  });

  it('refuse framing for browsers that predate frame-ancestors', async () => {
    assert.equal(await header('X-Frame-Options'), 'DENY');
  });

  it('stop the browser guessing a content type', async () => {
    assert.equal(await header('X-Content-Type-Options'), 'nosniff');
  });

  it('allow the microphone from this site only, and no other device', async () => {
    const permissions = await header('Permissions-Policy');
    const features = new Map(
      permissions.split(',').map((entry) => {
        const [name, allow] = entry.trim().split('=');
        return [name!, allow!];
      }),
    );
    assert.equal(features.get('microphone'), '(self)');
    for (const [name, allow] of features) {
      if (name !== 'microphone') assert.equal(allow, '()', name);
    }
  });
});

/**
 * Firebase Auth in the browser, started without the popup and redirect resolver.
 *
 * `getAuth` installs that resolver, and on Safari, iOS and Android it then loads a script
 * from apis.google.com that the policy above refuses. Read from the source because the
 * module only runs in a browser. Comments are stripped first, since the file explains
 * in prose why `getAuth` is not used, and the prose is not a call.
 */
describe('the Firebase browser client', () => {
  const source = readFileSync('src/lib/firebase/client.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('starts Auth with initializeAuth and never calls getAuth', () => {
    assert.match(source, /initializeAuth\(app\(\), DEPS\)/);
    assert.doesNotMatch(source, /\bgetAuth\b/);
  });

  it('gives Auth no popup or redirect resolver, and keeps the user in memory', () => {
    assert.doesNotMatch(source, /popupRedirectResolver/);
    assert.doesNotMatch(source, /signInWithPopup|signInWithRedirect|OAuthProvider/);
    assert.match(source, /const DEPS: Dependencies = \{ persistence: inMemoryPersistence \};/);
  });
});
