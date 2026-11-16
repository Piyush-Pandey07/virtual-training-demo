/**
 * Copies every file in the backup blob store back into the main one (AI-57).
 *
 *   npm run restore-files                               # says what it would do, changes nothing
 *   npm run restore-files -- --apply                    # does it
 *   npm run restore-files -- --prefix=orgs/acme/ --apply
 *   npm run restore-files -- --missing-only --apply     # leaves files the main store has
 *
 * Every upload is copied to the backup store under the same pathname (see
 * `src/lib/backup/files.ts`), so a restore is a straight copy with nothing to map. Needs
 * both tokens, `BACKUP_BLOB_READ_WRITE_TOKEN` to read and `BLOB_READ_WRITE_TOKEN` to
 * write, which on a developer machine means pulling them from Vercel into .env.local
 * for the length of the restore.
 *
 * The backup store keeps files the main store has since deleted, including those of a
 * customer that was purged. `--prefix` exists so a restore can be limited to what was
 * actually lost, rather than bringing back things somebody meant to remove.
 *
 * Written directly against the SDK rather than through the app's blob client, because
 * that client is the one the stores use, and a store writing through it would copy each
 * restored file straight back into the backup.
 */

import { get, list, put } from '@vercel/blob';

const APPLY = process.argv.includes('--apply');
const MISSING_ONLY = process.argv.includes('--missing-only');
const PREFIX = process.argv.find((arg) => arg.startsWith('--prefix='))?.slice('--prefix='.length);

/** A render never changes under its key, which is what the main client assumes too. */
const CACHE_MAX_AGE = 31_536_000;

async function pathnames(token: string, prefix?: string): Promise<string[]> {
  const found: string[] = [];
  let cursor: string | undefined;
  // Paginated, because a store with a few dozen decks already holds thousands of pages.
  do {
    const page = await list({ prefix, token, cursor, limit: 1000 });
    found.push(...page.blobs.map((blob) => blob.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return found;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set. A restore needs both blob tokens.`);
  return value;
}

async function main(): Promise<void> {
  const backupToken = required('BACKUP_BLOB_READ_WRITE_TOKEN');
  const mainToken = required('BLOB_READ_WRITE_TOKEN');
  if (backupToken === mainToken) {
    // Copying a store onto itself does nothing useful, and it means the backup was never
    // a separate store in the first place, which is worth knowing loudly.
    throw new Error('Both tokens are the same, so the backup is not a separate store.');
  }

  const inBackup = await pathnames(backupToken, PREFIX);
  const inMain = new Set(MISSING_ONLY ? await pathnames(mainToken, PREFIX) : []);
  const toCopy = inBackup.filter((pathname) => !inMain.has(pathname));

  console.log(
    `\n  ${APPLY ? 'Restoring' : 'Would restore'} ${toCopy.length} of ${inBackup.length} file(s)` +
      `${PREFIX ? ` under ${PREFIX}` : ''} from the backup store` +
      `${MISSING_ONLY ? ', skipping those the main store already has' : ''}.`,
  );

  if (!APPLY) {
    for (const pathname of toCopy.slice(0, 20)) console.log(`    ${pathname}`);
    if (toCopy.length > 20) console.log(`    and ${toCopy.length - 20} more`);
    console.log('\n  Nothing was changed. Re-run with --apply to do it.\n');
    return;
  }

  // One at a time, as the other scripts do. This runs against the live store, usually in
  // the middle of an incident, and a burst of concurrent writes is not worth the minutes.
  let copied = 0;
  let failed = 0;
  for (const pathname of toCopy) {
    try {
      const result = await get(pathname, { access: 'private', token: backupToken });
      if (!result || result.statusCode !== 200) throw new Error('unreadable');
      const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
      await put(pathname, bytes, {
        access: 'private',
        token: mainToken,
        contentType: result.blob.contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: CACHE_MAX_AGE,
      });
      copied += 1;
      console.log(`    ${pathname} - restored`);
    } catch (error) {
      // Carried on past, so one bad object does not leave the rest unrestored. Each one
      // is named, and the run can be repeated with --missing-only to pick them up.
      failed += 1;
      console.log(`    ${pathname} - FAILED: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(`\n  Restored ${copied}, failed ${failed}.\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
