/**
 * Finding a deck.
 *
 * The rest of the app asks for a deck and gets one. This file is the only place
 * that knows where decks actually come from, which is the point: when uploads land,
 * nothing above this changes.
 *
 * The store is chosen from the environment, in descending order of capability, and
 * the last option requires no configuration at all. That matters because the demo is
 * already deployed with two environment variables set, and a change that silently
 * required a third would have broken it on the next push.
 */

import 'server-only';

import type { DeckRecord } from '../deck-types';
import { firebaseAdminConfigured } from '../firebase/admin';
import { firestoreDocuments } from '../firebase/firestore';
import { deckPrefix, filesystemRoot, scopedDocuments } from '../orgs/scope';
import { BlobAssetStore, FilesystemAssetStore, NoAssetStore, type AssetStore } from './assets';
import type { DeckStore, DeckSummary, StoredDeck } from './store';
import { BlobDeckStore, vercelBinaryBlobClient, vercelBlobClient } from './store-blob';
import { DocumentDeckStore } from './store-documents';
import { defaultDataRoot, FilesystemDeckStore } from './store-fs';
import { SeededDeckStore } from './store-seeded';

/** Used when a request does not name a deck. */
export const DEFAULT_DECK_ID = 'isms';

const cached = new Map<string, DeckStore>();
const cachedAssets = new Map<string, AssetStore>();

/**
 * One customer's decks, and no other customer's.
 *
 * The organisation is required. That is the whole point: a store handed back here can
 * only see one customer, so no query above this line can forget to filter by one —
 * there is no unfiltered query available to write.
 *
 * Cached per customer because the filesystem and blob stores each seed themselves on
 * first use, and that check should happen once per customer rather than per request.
 *
 * Each customer's store seeds itself with the worked example, so every one of them has
 * a deck to look at on their first day. That is a copy rather than a shared platform
 * deck, which is a small deviation from the plan and a deliberate one: a copy is what
 * the seeding already did, needs no special case in `get`, `list`, `save` or `remove`,
 * and lets a customer delete the example if they do not want it in their library.
 */
export function deckStore(orgId: string): DeckStore {
  const existing = cached.get(orgId);
  if (existing) return existing;

  const store = buildDeckStore(orgId);
  cached.set(orgId, store);
  return store;
}

/**
 * Which storage tier this deployment would use, without naming a customer.
 *
 * For the health check, which is anonymous and so has no organisation to ask about.
 * Constructing a store performs no I/O -- the filesystem and blob stores seed on first
 * use, not on construction -- so this reports the decision without acting on it, and
 * cannot drift from the real one because it *is* the real one.
 */
export function deckStorage(): { kind: DeckStore['kind']; writable: boolean } {
  const probe = buildDeckStore('health');
  return { kind: probe.kind, writable: probe.writable };
}

function buildDeckStore(orgId: string): DeckStore {
  // Firestore first, for the same reason the roster prefers it: it is the one tier
  // that can change a document atomically, and it keeps the structured half of a deck
  // beside everything else known about a customer.
  //
  // The slide images do not follow. They are large, binary, fetched by name and served
  // rather than queried, and a Firestore document is capped at a mebibyte. Nothing
  // about a picture benefits from being in a database, so `assetStore` still resolves
  // to blob storage independently of this.
  //
  // DECK_STORE=blob forces the older tier, which is what the migration uses to read
  // the decks it is moving.
  if (firebaseAdminConfigured() && process.env.DECK_STORE !== 'blob') {
    return new DocumentDeckStore(scopedDocuments(firestoreDocuments(), orgId));
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) return new BlobDeckStore(vercelBlobClient(token), deckPrefix(orgId));

  // Vercel's filesystem is read-only apart from a temporary directory that does not
  // outlive a request, so writing decks there would appear to work and then lose
  // them. Falling through to the built-in deck is the honest behaviour.
  if (!process.env.VERCEL) {
    // The data root, not the deck root. DECK_STORE_DIR names the directory customers
    // sit under, so a customer's decks land in `{root}/orgs/{id}/decks`.
    const base = process.env.DECK_STORE_DIR ?? defaultDataRoot();
    return new FilesystemDeckStore(filesystemRoot(base, orgId, 'decks'));
  }

  return new SeededDeckStore();
}

/**
 * Where a deck's slide renders live.
 *
 * Resolved by the same rule as the deck store, so the two cannot disagree about
 * which deployment they are in. A deck in blob storage whose images sat on a
 * filesystem that does not survive the request would be worse than either.
 */
export function assetStore(orgId: string): AssetStore {
  const existing = cachedAssets.get(orgId);
  if (existing) return existing;

  const store = buildAssetStore(orgId);
  cachedAssets.set(orgId, store);
  return store;
}

function buildAssetStore(orgId: string): AssetStore {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) return new BlobAssetStore(vercelBinaryBlobClient(token), deckPrefix(orgId));

  if (!process.env.VERCEL) {
    const base = process.env.DECK_STORE_DIR ?? defaultDataRoot();
    return new FilesystemAssetStore(filesystemRoot(base, orgId, 'decks'));
  }

  return new NoAssetStore();
}

/**
 * Drops a customer's cached stores.
 *
 * Called when a customer is deleted. The cache is per organisation and each store
 * remembers whether it has seeded, so without this a re-provisioned id reuses a store
 * that believes it already seeded a library that no longer exists -- and the new
 * customer opens an empty one.
 */
export function forgetDeckStores(orgId: string): void {
  cached.delete(orgId);
  cachedAssets.delete(orgId);
}

/** Only for tests, which need a fresh store per case. */
export function resetDeckStore(store?: DeckStore, orgId = 'test-org'): void {
  cached.clear();
  cachedAssets.clear();
  if (store) cached.set(orgId, store);
}

export async function loadDeck(
  orgId: string,
  id: string = DEFAULT_DECK_ID,
): Promise<DeckRecord | undefined> {
  const stored = await deckStore(orgId).get(id);
  return stored?.record;
}

/** The deck plus its status and timestamps, for anything that manages decks. */
export async function loadStoredDeck(orgId: string, id: string): Promise<StoredDeck | undefined> {
  return deckStore(orgId).get(id);
}

export async function listDecks(orgId: string): Promise<DeckSummary[]> {
  return deckStore(orgId).list();
}

/**
 * The deck a bare visit should present.
 *
 * The default deck when it is there, otherwise the first published one, otherwise
 * whatever exists. A library that has had its seed deck deleted should still open on
 * something rather than on an error.
 */
export async function defaultDeck(orgId: string): Promise<DeckSummary | undefined> {
  const decks = await listDecks(orgId);
  return (
    decks.find((deck) => deck.id === DEFAULT_DECK_ID) ??
    decks.find((deck) => deck.status === 'published') ??
    decks[0]
  );
}
