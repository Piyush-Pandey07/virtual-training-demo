import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { BinaryBlobClient } from '../decks/assets';
import { BlobAssetStore, pageAssetName } from '../decks/assets';
import { BlobPaperFiles } from '../white-papers/files';
import { BACKUP_TOKEN_VARIABLE, backUpFileWith, fileBackups, type BackupPut } from './files';

/**
 * The second copy of every uploaded file (AI-57), against a recording stand-in for the
 * blob SDK. What matters is that the copy lands under the same pathname, in the store
 * the backup token reaches, and that nothing about it can fail the upload it follows.
 */

const PDF = new Uint8Array([37, 80, 68, 70]);

function recordingPut() {
  const calls: Array<{ pathname: string; body: Buffer; token: string; contentType: string }> = [];
  const put: BackupPut = async (pathname, body, { token, contentType }) => {
    calls.push({ pathname, body, token, contentType });
  };
  return { put, calls };
}

let savedToken: string | undefined;
beforeEach(() => {
  savedToken = process.env[BACKUP_TOKEN_VARIABLE];
  delete process.env[BACKUP_TOKEN_VARIABLE];
});
afterEach(() => {
  if (savedToken === undefined) delete process.env[BACKUP_TOKEN_VARIABLE];
  else process.env[BACKUP_TOKEN_VARIABLE] = savedToken;
});

describe('backing up a file', () => {
  it('does nothing when no backup token is configured', async () => {
    const { put, calls } = recordingPut();
    await backUpFileWith('orgs/acme/white-papers/p/original.pdf', PDF, 'application/pdf', {
      put,
      immediate: true,
    });
    assert.equal(calls.length, 0);
    assert.equal(fileBackups(), 'off');
  });

  it('writes the same bytes under the same pathname with the backup token', async () => {
    process.env[BACKUP_TOKEN_VARIABLE] = 'backup-token';
    const { put, calls } = recordingPut();
    await backUpFileWith('orgs/acme/decks/d/pages/1.webp', PDF, 'image/webp', {
      put,
      immediate: true,
    });
    assert.equal(fileBackups(), 'on');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.pathname, 'orgs/acme/decks/d/pages/1.webp');
    assert.equal(calls[0]!.token, 'backup-token');
    assert.equal(calls[0]!.contentType, 'image/webp');
    assert.deepEqual(new Uint8Array(calls[0]!.body), PDF);
  });

  it('copies the bytes, so a caller reusing its array cannot change the backup', async () => {
    const { put, calls } = recordingPut();
    const bytes = new Uint8Array([1, 2, 3]);
    await backUpFileWith('a/b.png', bytes, 'image/png', { token: 't', put, immediate: true });
    bytes[0] = 9;
    assert.deepEqual([...calls[0]!.body], [1, 2, 3]);
  });

  it('logs a failed write rather than throwing it', async () => {
    const logged: string[] = [];
    await backUpFileWith('a/b.png', PDF, 'image/png', {
      token: 't',
      put: async () => {
        throw new Error('store unreachable');
      },
      log: async (pathname, error) => {
        logged.push(`${pathname}: ${(error as Error).message}`);
      },
      immediate: true,
    });
    assert.deepEqual(logged, ['a/b.png: store unreachable']);
  });

  it('survives the log itself failing', async () => {
    const quiet = console.error;
    console.error = () => undefined;
    try {
      await backUpFileWith('a/b.png', PDF, 'image/png', {
        token: 't',
        put: async () => {
          throw new Error('store unreachable');
        },
        log: async () => {
          throw new Error('log unreachable');
        },
        immediate: true,
      });
    } finally {
      console.error = quiet;
    }
  });

  it('does not wait for the write when not asked to', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let finished = false;
    await backUpFileWith('a/b.png', PDF, 'image/png', {
      token: 't',
      put: async () => {
        await held;
        finished = true;
      },
    });
    // Returned while the write is still outstanding, which is what keeps the upload fast.
    assert.equal(finished, false);
    release();
    await held;
  });
});

/** Main blob storage as a map, which can be told to fail. */
function memoryBlobs(fail = false): BinaryBlobClient & { paths: () => string[] } {
  const stored = new Map<string, Uint8Array>();
  return {
    async put(pathname, bytes) {
      if (fail) throw new Error('main store refused');
      stored.set(pathname, bytes);
      return { url: `https://blob.invalid/${pathname}` };
    },
    async list() {
      return [];
    },
    async remove() {},
    async readBytes() {
      return null;
    },
    paths: () => [...stored.keys()],
  };
}

function recordingBackup() {
  const copies: Array<{ pathname: string; contentType: string }> = [];
  return {
    copies,
    backup: (pathname: string, _body: Uint8Array, contentType: string) => {
      copies.push({ pathname, contentType });
    },
  };
}

describe('uploads are backed up', () => {
  it('copies a slide render under the pathname it was stored at', async () => {
    const blobs = memoryBlobs();
    const { backup, copies } = recordingBackup();
    const store = new BlobAssetStore(blobs, 'orgs/acme/decks', backup);
    await store.put('deck-a-abc123', pageAssetName(1, 'full'), PDF, 'image/webp');
    assert.deepEqual(copies, [{ pathname: blobs.paths()[0]!, contentType: 'image/webp' }]);
  });

  it('copies a white paper original under the pathname it was stored at', async () => {
    const blobs = memoryBlobs();
    const { backup, copies } = recordingBackup();
    await new BlobPaperFiles(blobs, 'orgs/acme/white-papers', backup).put('paper-1', PDF);
    assert.deepEqual(copies, [
      { pathname: 'orgs/acme/white-papers/paper-1/original.pdf', contentType: 'application/pdf' },
    ]);
  });

  it('does not back up a file the main store refused', async () => {
    const { backup, copies } = recordingBackup();
    const store = new BlobAssetStore(memoryBlobs(true), 'orgs/acme/decks', backup);
    await assert.rejects(store.put('deck-a-abc123', pageAssetName(1, 'full'), PDF, 'image/webp'));
    assert.equal(copies.length, 0);
  });
});
