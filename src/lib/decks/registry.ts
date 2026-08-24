/**
 * Finding a deck by id.
 *
 * There is one deck today and it is compiled in, so this is a lookup in a literal.
 * It is async and it is the only way the server obtains a deck, which is the whole
 * point: when decks move to storage, this file changes and nothing else does.
 */

import 'server-only';

import type { DeckRecord } from '../deck-types';
import { ISMS_DECK } from './isms';

/** Used when a request does not name a deck, which is every request today. */
export const DEFAULT_DECK_ID = 'isms';

const SEEDED: Record<string, DeckRecord> = {
  [ISMS_DECK.meta.id]: ISMS_DECK,
};

/** Resolves a deck id to a deck, or undefined if there is no such deck. */
export async function loadDeck(id: string = DEFAULT_DECK_ID): Promise<DeckRecord | undefined> {
  return SEEDED[id];
}

/** Every deck available to run, for the library index. */
export async function listDecks(): Promise<DeckRecord[]> {
  return Object.values(SEEDED);
}
