import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { deckStore, deckStorage, resetDeckStore } from './registry';

/**
 * Which store gets used is decided from the environment, and getting it wrong is
 * not a subtle failure.
 *
 * The case that matters most is the last one. This app is deployed and working with
 * two environment variables set. If a missing blob token resolved to the filesystem
 * store there, every write would appear to succeed and then vanish, because Vercel's
 * filesystem is read-only apart from a temporary directory that does not outlive a
 * request. Falling back to the built-in deck keeps that deployment behaving exactly
 * as it did before storage existed.
 */
describe('choosing a deck store', () => {
  const saved = {
    token: process.env.BLOB_READ_WRITE_TOKEN,
    vercel: process.env.VERCEL,
    dir: process.env.DECK_STORE_DIR,
  };

  function setEnv(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  afterEach(() => {
    setEnv('BLOB_READ_WRITE_TOKEN', saved.token);
    setEnv('VERCEL', saved.vercel);
    setEnv('DECK_STORE_DIR', saved.dir);
    resetDeckStore();
  });

  it('uses blob storage when a token is present', () => {
    setEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test');
    resetDeckStore();
    assert.equal(deckStorage().kind, 'blob');
    assert.equal(deckStorage().writable, true);
  });

  it('prefers blob storage over the filesystem even on a developer machine', () => {
    setEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test');
    setEnv('VERCEL', undefined);
    resetDeckStore();
    assert.equal(deckStorage().kind, 'blob');
  });

  it('uses the filesystem locally when there is no token', () => {
    setEnv('BLOB_READ_WRITE_TOKEN', undefined);
    setEnv('VERCEL', undefined);
    resetDeckStore();
    assert.equal(deckStorage().kind, 'filesystem');
  });

  it('falls back to the built-in deck on Vercel with no token', () => {
    // Not the filesystem: writes there look successful and then disappear.
    setEnv('BLOB_READ_WRITE_TOKEN', undefined);
    setEnv('VERCEL', '1');
    resetDeckStore();
    assert.equal(deckStorage().kind, 'seeded');
    assert.equal(deckStorage().writable, false);
  });

  it('resolves a customer store once, so seeding is not re-checked per request', () => {
    setEnv('BLOB_READ_WRITE_TOKEN', undefined);
    setEnv('VERCEL', undefined);
    resetDeckStore();
    assert.equal(deckStore('acme'), deckStore('acme'));
  });

  it('gives two customers two different stores', () => {
    // The cache is per customer now. One shared store would have handed Globex's
    // request whichever customer happened to ask first after a cold start.
    setEnv('BLOB_READ_WRITE_TOKEN', undefined);
    setEnv('VERCEL', undefined);
    resetDeckStore();
    assert.notEqual(deckStore('acme'), deckStore('globex'));
  });
});
