/**
 * Moves the structured half of each deck into Firestore.
 *
 *   npm run migrate-decks-to-firestore                 # says what it would do
 *   npm run migrate-decks-to-firestore -- --apply      # does it
 *
 * A deck used to be two JSON objects in blob storage beside its rendered slides. The
 * record now lives in Firestore, as one document per slide, and only the images stay
 * in blob. Two different kinds of data that were sharing a store because both happened
 * to belong to a deck.
 *
 * The images are not touched and must not be: they are large, binary, fetched by name,
 * and a Firestore document is capped at a mebibyte.
 *
 * Nothing is deleted. The blob copies stay until somebody is satisfied, and until they
 * are removed `DECK_STORE=blob` still reads them.
 */

import { deckPrefix, filesystemRoot, scopedDocuments } from '../src/lib/orgs/scope';
import { firestoreDocuments } from '../src/lib/firebase/firestore';
import { firebaseAdminConfigured } from '../src/lib/firebase/admin';
import { orgStore, orgsConfigured } from '../src/lib/orgs/registry';
import { BlobDeckStore, vercelBlobClient } from '../src/lib/decks/store-blob';
import { DocumentDeckStore } from '../src/lib/decks/store-documents';
import { defaultDataRoot, FilesystemDeckStore } from '../src/lib/decks/store-fs';
import type { DeckStore } from '../src/lib/decks/store';

const APPLY = process.argv.includes('--apply');

/**
 * Where a customer's decks are being read from.
 *
 * Blob when a token is present, because that is what a deployment has; the filesystem
 * otherwise, because that is what a developer machine has. Both are the tier the
 * registry used before this change, named explicitly so the migration cannot be
 * pointed at the destination by accident and report that everything is already done.
 */
function source(orgId: string): DeckStore {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) return new BlobDeckStore(vercelBlobClient(token), deckPrefix(orgId));
  return new FilesystemDeckStore(filesystemRoot(defaultDataRoot(), orgId, 'decks'));
}

async function migrate(orgId: string, name: string): Promise<void> {
  const from = source(orgId);
  const to = new DocumentDeckStore(scopedDocuments(firestoreDocuments(), orgId));

  const [old, already] = await Promise.all([
    from.list().catch(() => []),
    to.list().catch(() => []),
  ]);

  const there = new Set(already.map((deck) => deck.id));
  const pending = old.filter((deck) => !there.has(deck.id));

  console.log(`\n  ${name} (${orgId})`);
  console.log(`    ${from.kind}: ${old.length} deck(s), Firestore already has ${already.length}`);

  if (pending.length === 0) {
    console.log('    nothing to move');
    return;
  }

  for (const deck of pending) console.log(`      ${deck.id} (${deck.status})`);
  if (!APPLY) return;

  for (const summary of pending) {
    // Read whole and written whole. The destination splits it into one document per
    // slide on the way in, which is its business rather than this script's.
    const stored = await from.get(summary.id).catch(() => undefined);
    if (!stored) {
      console.log(`      ${summary.id} — could not be read, skipped`);
      continue;
    }
    await to.save(stored.record, stored.status);
    console.log(`      ${summary.id} — moved`);
  }
}

async function main(): Promise<void> {
  if (!firebaseAdminConfigured() || !orgsConfigured()) {
    throw new Error(
      'Firebase is not configured, so there is nowhere to move decks to. Run with --env-file.',
    );
  }
  if (process.env.DECK_STORE === 'blob') {
    throw new Error('DECK_STORE=blob forces the old tier, so this would read and write the same place.');
  }

  console.log(`\n  ${APPLY ? 'Moving' : 'Would move'} deck records into Firestore`);
  console.log('  Slide images stay in blob storage and are not touched.');

  for (const organisation of await orgStore().list()) {
    await migrate(organisation.id, organisation.name);
  }

  console.log(
    APPLY
      ? '\n  Done. The blob copies are left in place; remove them once you are satisfied.\n'
      : '\n  Nothing was changed. Re-run with --apply to do it.\n',
  );
}

main().catch((error: unknown) => {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
