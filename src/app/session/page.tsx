/**
 * The session route.
 *
 * A server component whose only job is to fetch the deck and narrow it before it
 * crosses to the browser. The session itself is a client component, so without
 * this split the deck would have to be imported there, which is precisely how the
 * whole deck including the author-only notes ended up in the client bundle.
 */

import { notFound } from 'next/navigation';

import { SessionScreen } from './SessionScreen';
import { toClientView } from '@/lib/deck';
import { DeckProvider } from '@/lib/deck-context';
import { loadDeck } from '@/lib/decks/registry';

export default async function SessionPage() {
  const deck = await loadDeck();
  if (!deck) notFound();

  return (
    <DeckProvider deck={toClientView(deck)}>
      <SessionScreen />
    </DeckProvider>
  );
}
