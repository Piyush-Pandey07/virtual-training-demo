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
import type { DeckStore, DeckSummary, StoredDeck } from './store';
import { BlobDeckStore, vercelBlobClient } from './store-blob';
import { defaultFilesystemRoot, FilesystemDeckStore } from './store-fs';
import { SeededDeckStore } from './store-seeded';

/** Used when a request does not name a deck. */
export const DEFAULT_DECK_ID = 'isms';

let cached: DeckStore | null = null;

/**
 * Picks a store once per process.
 *
 * Cached because the filesystem and blob stores each seed themselves on first use,
 * and that check should happen once rather than on every request.
 */
export function deckStore(): DeckStore {
  if (cached) return cached;

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    cached = new BlobDeckStore(vercelBlobClient(token));
    return cached;
  }

  // Vercel's filesystem is read-only apart from a temporary directory that does not
  // outlive a request, so writing decks there would appear to work and then lose
  // them. Falling through to the built-in deck is the honest behaviour.
  const onVercel = Boolean(process.env.VERCEL);
  if (!onVercel) {
    cached = new FilesystemDeckStore(process.env.DECK_STORE_DIR ?? defaultFilesystemRoot());
    return cached;
  }

  cached = new SeededDeckStore();
  return cached;
}

/** Only for tests, which need a fresh store per case. */
export function resetDeckStore(store?: DeckStore): void {
  cached = store ?? null;
}

export async function loadDeck(id: string = DEFAULT_DECK_ID): Promise<DeckRecord | undefined> {
  const stored = await deckStore().get(id);
  return stored?.record;
}

/** The deck plus its status and timestamps, for anything that manages decks. */
export async function loadStoredDeck(id: string): Promise<StoredDeck | undefined> {
  return deckStore().get(id);
}

export async function listDecks(): Promise<DeckSummary[]> {
  return deckStore().list();
}

/**
 * The deck a bare visit should present.
 *
 * The default deck when it is there, otherwise the first published one, otherwise
 * whatever exists. A library that has had its seed deck deleted should still open on
 * something rather than on an error.
 */
export async function defaultDeck(): Promise<DeckSummary | undefined> {
  const decks = await listDecks();
  return (
    decks.find((deck) => deck.id === DEFAULT_DECK_ID) ??
    decks.find((deck) => deck.status === 'published') ??
    decks[0]
  );
}
