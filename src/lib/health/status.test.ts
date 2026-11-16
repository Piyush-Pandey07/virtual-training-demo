import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withTimeout } from '../firebase/admin';
import { healthStatus } from './status';

/** What an uptime monitor sees from /api/health (AI-56). */

const up = { ok: true, ms: 12 };
const down = { ok: false, ms: 4000, error: 'Timeout code timeout' };

describe('the health status code', () => {
  it('is 200 when ready and both probes answered', () => {
    assert.equal(healthStatus({ ready: true, firebase: { firestore: up, auth: up } }), 200);
  });

  it('is 200 when ready and Firebase is not configured', () => {
    assert.equal(healthStatus({ ready: true, firebase: null }), 200);
  });

  it('is 503 when the deployment is not ready', () => {
    assert.equal(healthStatus({ ready: false, firebase: { firestore: up, auth: up } }), 503);
    assert.equal(healthStatus({ ready: false, firebase: null }), 503);
  });

  it('is 503 when the database probe failed', () => {
    assert.equal(healthStatus({ ready: true, firebase: { firestore: down, auth: up } }), 503);
  });

  it('is 503 when the sign-in probe failed', () => {
    assert.equal(healthStatus({ ready: true, firebase: { firestore: up, auth: down } }), 503);
  });
});

describe('the probe timeout', () => {
  it('passes through an answer that arrives in time', async () => {
    assert.equal(await withTimeout(Promise.resolve('answered'), 50), 'answered');
  });

  it('gives up on a probe that never answers', async () => {
    const never = new Promise<never>(() => undefined);
    await assert.rejects(withTimeout(never, 20), (error: { code?: string }) => {
      assert.equal(error.code, 'timeout');
      return true;
    });
  });
});
