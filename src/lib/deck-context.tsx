'use client';

/**
 * The deck, on the client.
 *
 * Everything in the browser that needs to know about the deck reads it from here,
 * and what it gets is the narrow projection rather than the deck itself. The
 * components used to import the deck module directly, which is how the entire
 * deck ended up in the client bundle: presenter notes, teaching briefs and the two
 * author-only notes about promoting a third-party platform, all sitting in
 * .next/static/chunks for anyone who opened devtools.
 *
 * A context rather than props because the alternative is threading the deck
 * through five components and a hook that only need it to answer "how many slides
 * are there".
 */

import { createContext, useContext, type ReactNode } from 'react';

import type { DeckClientView } from './deck-types';

const DeckContext = createContext<DeckClientView | null>(null);

export function DeckProvider({ deck, children }: { deck: DeckClientView; children: ReactNode }) {
  return <DeckContext.Provider value={deck}>{children}</DeckContext.Provider>;
}

/**
 * The deck being presented.
 *
 * Throws rather than returning null. A missing provider is a wiring mistake that
 * would otherwise surface as a session with zero slides, which is a much harder
 * thing to diagnose than a clear error at the point of use.
 */
export function useDeck(): DeckClientView {
  const deck = useContext(DeckContext);
  if (!deck) {
    throw new Error('useDeck was called outside a DeckProvider. Wrap the tree in one.');
  }
  return deck;
}
