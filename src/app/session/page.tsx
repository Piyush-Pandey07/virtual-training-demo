/**
 * The session route.
 *
 * A server component whose only job is to fetch the deck and narrow it before it
 * crosses to the browser. The session itself is a client component, so without this
 * split the deck would have to be imported there, which is precisely how the whole
 * deck including the author-only notes ended up in the client bundle.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { toClientView } from '@/lib/deck';
import { DeckProvider } from '@/lib/deck-context';
import { loadDeck } from '@/lib/decks/registry';
import { SessionScreen } from './SessionScreen';

// The deck comes from storage now, so prerendering this would pin whichever deck
// existed at build time.
export const dynamic = 'force-dynamic';

interface SessionPageProps {
  searchParams: Promise<{ deck?: string }>;
}

export async function generateMetadata({ searchParams }: SessionPageProps): Promise<Metadata> {
  const { deck: requested } = await searchParams;
  const deck = await loadDeck(requested?.trim() || undefined).catch(() => undefined);
  return deck ? { title: `${deck.meta.title} | ${deck.meta.owner}` } : {};
}

export default async function SessionPage({ searchParams }: SessionPageProps) {
  const { deck: requested } = await searchParams;

  // A deck id out of a URL is untrusted, and the store rejects an unusable one by
  // throwing. A bad link should be a 404, not a 500.
  const deck = await loadDeck(requested?.trim() || undefined).catch(() => undefined);
  if (!deck) notFound();

  return (
    <DeckProvider deck={toClientView(deck)}>
      <SessionScreen />
    </DeckProvider>
  );
}
