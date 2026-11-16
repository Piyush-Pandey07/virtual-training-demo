/**
 * A second copy of every uploaded file, in a separate blob store (AI-57).
 *
 * Firestore has its own backups, kept by Google and switched on in the console. The
 * files beside it, slide renders and white paper originals, live in one Vercel Blob
 * store with nothing behind it: a deleted store, a mistaken purge or a bad script would
 * take every deck's pictures with it, and a deck whose record survives with no pictures
 * is not one anybody can train from.
 *
 * So each upload is written twice. The second write goes to a different store, reached
 * with a different token, `BACKUP_BLOB_READ_WRITE_TOKEN`, so nothing holding the main
 * token can reach the copies. It uses the same pathname, which makes a restore a straight
 * copy back (`scripts/restore-files.ts`) with no mapping to get wrong.
 *
 * The copy must never cost the person uploading anything. It is made after the response
 * where there is one, never awaited by the upload, and a failure is logged rather than
 * thrown: a missing backup is something for us to notice, not a reason to refuse a deck.
 *
 * Nothing is removed from the backup store when a file is removed from the main one.
 * That is the point of it, since an accidental delete is one of the things it protects
 * against, and it means a customer's purge does not reach it: see Backups in the README.
 */

import 'server-only';

import { after } from 'next/server';

import { recordFailure } from '../failures/devlog';

export const BACKUP_TOKEN_VARIABLE = 'BACKUP_BLOB_READ_WRITE_TOKEN';

/** The one call to the blob SDK, injected so the logic around it can be tested. */
export type BackupPut = (
  pathname: string,
  body: Buffer,
  options: { token: string; contentType: string },
) => Promise<unknown>;

/** Where a failure goes. The developer log by default. */
export type BackupFailureLog = (pathname: string, error: unknown) => Promise<void>;

export interface BackUpOptions {
  /** Defaults to `process.env.BACKUP_BLOB_READ_WRITE_TOKEN`. */
  token?: string;
  put?: BackupPut;
  log?: BackupFailureLog;
  /**
   * Write before returning rather than after the response. For the tests, and for
   * scripts, which have no response to wait for.
   */
  immediate?: boolean;
}

/** The signature the stores take, so a test can hand them a recording fake. */
export type BackUpFile = (pathname: string, body: Uint8Array, contentType: string) => void;

function configuredToken(): string | undefined {
  return process.env[BACKUP_TOKEN_VARIABLE]?.trim() || undefined;
}

/** Whether uploads are being copied, for /api/health. */
export function fileBackups(): 'on' | 'off' {
  return configuredToken() ? 'on' : 'off';
}

/**
 * The real write, with the same settings the main binary client uses.
 *
 * Private for the same reason the main store is: these are the same files, including
 * whatever a customer uploaded, and nothing ever hands a backup URL to a browser.
 */
const vercelPut: BackupPut = async (pathname, body, { token, contentType }) => {
  const { put } = await import('@vercel/blob');
  await put(pathname, body, {
    access: 'private',
    token,
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
};

const logToDevlog: BackupFailureLog = async (pathname, error) => {
  // Through the developer log, so a run of failed backups shows on the platform's error
  // page and not only in the deployment's own logs. `recordFailure` prints it as well,
  // which covers the case where Firestore is what is down.
  await recordFailure(
    {
      source: 'server',
      provider: 'vercel-blob',
      kind: 'backup_failed',
      // Nobody was shown anything: the upload itself succeeded.
      code: 'unavailable',
      detail: `Could not copy ${pathname} to the backup store: ${(error as Error)?.message ?? String(error)}`,
      route: 'backup',
    },
    { immediate: true },
  );
};

/** Runs after the response when there is one, and straight away otherwise. */
function later(work: () => Promise<void>): void {
  try {
    after(work);
  } catch {
    // Outside a request, as in scripts. `after` refuses there.
    void work();
  }
}

/**
 * Copies one file to the backup store, under the same pathname.
 *
 * Returns at once unless `immediate` is asked for, and never rejects either way. With
 * no backup token configured it does nothing at all, which is every developer machine.
 */
export async function backUpFileWith(
  pathname: string,
  body: Uint8Array,
  contentType: string,
  options: BackUpOptions = {},
): Promise<void> {
  const token = options.token ?? configuredToken();
  if (!token) return;

  const put = options.put ?? vercelPut;
  const log = options.log ?? logToDevlog;

  // Copied now rather than wrapped. The caller's array may be reused or released once
  // its own write returns, and this one runs after that.
  const copy = Buffer.from(body);

  const work = async () => {
    try {
      await put(pathname, copy, { token, contentType });
    } catch (error) {
      await log(pathname, error).catch((logError: unknown) => {
        console.error(
          `[backup] could not copy ${pathname}, and could not log that either: ${(logError as Error)?.message ?? logError}`,
        );
      });
    }
  };

  if (options.immediate) await work();
  else later(work);
}

/** The default the stores use: configured from the environment, after the response. */
export const backUpFile: BackUpFile = (pathname, body, contentType) => {
  void backUpFileWith(pathname, body, contentType);
};
