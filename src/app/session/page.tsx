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
import { DEFAULT_DECK_ID, loadStoredDeck } from '@/lib/decks/registry';
import { SessionScreen } from './SessionScreen';

// The deck comes from storage now, so prerendering this would pin whichever deck
// existed at build time.
export const dynamic = 'force-dynamic';

interface SessionPageProps {
  searchParams: Promise<{ deck?: string }>;
}

export async function generateMetadata({ searchParams }: SessionPageProps): Promise<Metadata> {
  const { deck: requested } = await searchParams;
  const stored = await loadStoredDeck(requested?.trim() || DEFAULT_DECK_ID).catch(() => undefined);
  if (!stored) return {};
  const { meta } = stored.record;
  // A draft says so in the tab as well as on the page, since a tab is often all
  // somebody sees of a link they were sent.
  const title = `${meta.title} | ${meta.owner}`;
  return { title: stored.status === 'published' ? title : `Draft: ${title}` };
}

export default async function SessionPage({ searchParams }: SessionPageProps) {
  const { deck: requested } = await searchParams;

  // A deck id out of a URL is untrusted, and the store rejects an unusable one by
  // throwing. A bad link should be a 404, not a 500.
  const stored = await loadStoredDeck(requested?.trim() || DEFAULT_DECK_ID).catch(() => undefined);
  if (!stored) notFound();

  /**
   * Whether this deck has been reviewed, passed down so the session can say so.
   *
   * Deliberately not a refusal. This app has no authentication, so anyone who can
   * open the session can open it whether a status check exists or not, and a gate
   * that can be walked around is worse than an honest label because it implies a
   * protection that is not there. A trainer previewing their own draft is also a
   * thing the review screen deliberately offers.
   *
   * What was actually missing is that nobody was told. A draft carries placeholder
   * meta saying the owner is "your organisation", and possibly no expertise at
   * all, and it was being presented as though it were finished.
   */
  return (
    <DeckProvider deck={toClientView(stored.record)}>
      <SessionScreen reviewed={stored.status === 'published'} />
    </DeckProvider>
  );
}
