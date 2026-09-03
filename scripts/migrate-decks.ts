/**
 * Moves decks written before there were customers into the home organisation.
 *
 *   npm run migrate-decks                 # says what it would do, changes nothing
 *   npm run migrate-decks -- --apply      # does it
 *
 * A deck used to live at `decks/{id}`; it now lives at `orgs/{orgId}/decks/{id}`, and
 * a store built for a customer looks only under their prefix. So a deck left where it
 * was is not exposed to everybody — it is invisible to everybody, which is the right
 * way round for the gap to fail and the reason this is not urgent but is necessary.
 *
 * Both storage tiers are handled, because a deployment has one and a developer machine
 * usually has the other:
 *
 *   filesystem  `.data/decks/{id}`            -> `.data/orgs/{orgId}/decks/{id}`
 *   blob        `decks/{id}/...`              -> `orgs/{orgId}/decks/{id}/...`
 *
 * The blob half must be run where the token is, which is not a developer machine.
 * Nothing is deleted: objects and directories are copied, and the originals are left
 * for somebody to remove once they are satisfied.
 */

import { readdir, mkdir, cp, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { defaultDataRoot, defaultFilesystemRoot } from '../src/lib/decks/store-fs';
import { LEGACY_DECK_ROOT, vercelBinaryBlobClient } from '../src/lib/decks/store-blob';
import { deckPrefix, filesystemRoot } from '../src/lib/orgs/scope';
import { HOME_ORG_ID } from '../src/lib/orgs/types';

const APPLY = process.argv.includes('--apply');

function contentTypeFor(name: string): string {
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

async function migrateFilesystem(): Promise<boolean> {
  // Read from where decks used to live, write to where the app now looks. Both come
  // from the same functions the app itself uses, so the two cannot drift apart. They
  // did once: this script stripped a trailing "decks" from the base and the registry
  // did not, so the migration wrote to `.data/orgs/{id}/decks` while the app read
  // `.data/decks/orgs/{id}/decks`. Nothing failed. The store seeded itself a fresh
  // copy of the worked example at its own location, and the library showed one deck.
  const from = defaultFilesystemRoot();
  const to = filesystemRoot(defaultDataRoot(), HOME_ORG_ID, 'decks');

  let entries: string[];
  try {
    entries = (await readdir(from, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return false;
  }

  if (entries.length === 0) return false;

  console.log(`\n  Filesystem: ${from}`);
  console.log(`          ->  ${to}`);
  for (const id of entries) console.log(`    ${id}`);

  if (!APPLY) return true;

  await mkdir(to, { recursive: true });
  for (const id of entries) {
    const target = join(to, id);
    // Skip anything already moved, so a second run is not a second copy.
    const already = await stat(target).catch(() => null);
    if (already) {
      console.log(`    ${id} — already there, left alone`);
      continue;
    }
    await cp(join(from, id), target, { recursive: true });
    console.log(`    ${id} — copied`);
  }

  return true;
}

async function migrateBlob(): Promise<boolean> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return false;

  const client = vercelBinaryBlobClient(token);
  const objects = await client.list(`${LEGACY_DECK_ROOT}/`);
  if (objects.length === 0) return false;

  const target = deckPrefix(HOME_ORG_ID);
  console.log(`\n  Blob: ${LEGACY_DECK_ROOT}/  ->  ${target}/`);
  console.log(`  ${objects.length} object(s)`);

  if (!APPLY) return true;

  // Copied one at a time rather than in parallel. This runs once, against a live
  // store, and a burst of concurrent writes against somebody's production blob is not
  // worth the minute it would save.
  for (const object of objects) {
    const rest = object.pathname.slice(LEGACY_DECK_ROOT.length + 1);
    const bytes = await client.readBytes(object.pathname);
    if (!bytes) {
      console.log(`    ${rest} — unreadable, skipped`);
      continue;
    }
    await client.put(`${target}/${rest}`, bytes, contentTypeFor(rest));
    console.log(`    ${rest} — copied`);
  }

  return true;
}

async function main(): Promise<void> {
  console.log(`\n  ${APPLY ? 'Migrating' : 'Would migrate'} decks into "${HOME_ORG_ID}"`);

  const movedBlob = await migrateBlob();
  const movedFiles = await migrateFilesystem();

  if (!movedBlob && !movedFiles) {
    console.log('\n  Nothing found to migrate.\n');
    return;
  }

  console.log(
    APPLY
      ? '\n  Done. The originals are left in place; remove them once you are satisfied.\n'
      : '\n  Nothing was changed. Re-run with --apply to do it.\n',
  );
}

main().catch((error: unknown) => {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
