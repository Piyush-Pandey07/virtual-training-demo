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

import { requireAssignedDeckPage } from '@/lib/auth/guard';
import { toClientView } from '@/lib/deck';
import { DeckProvider } from '@/lib/deck-context';
import { DEFAULT_DECK_ID, loadStoredDeck } from '@/lib/decks/registry';
import { coverageOf, percentComplete } from '@/lib/roster/completion';
import { rosterStore } from '@/lib/roster/registry';
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
  const deckId = requested?.trim() || DEFAULT_DECK_ID;

  /**
   * The gate, which is now real.
   *
   * This used to carry a comment explaining that a refusal would be theatre: with no
   * authentication, anybody who could open the session could open it whatever a
   * status check said, and a gate that can be walked around is worse than an honest
   * label. That reasoning was right and has expired — there is an identity to refuse
   * now, so a trainee gets a 404 for a deck nobody gave them.
   *
   * An administrator still passes, because previewing a deck before assigning it is
   * exactly what the review screen offers and this is where that preview lands. The
   * draft banner below is what tells them which they are looking at.
   */
  const person = await requireAssignedDeckPage(deckId, `/session?deck=${deckId}`);

  // A deck id out of a URL is untrusted, and the store rejects an unusable one by
  // throwing. A bad link should be a 404, not a 500.
  const stored = await loadStoredDeck(deckId).catch(() => undefined);
  if (!stored) notFound();

  // What an earlier sitting left behind. Slide ids and one percentage: the weighting
  // that produced it stays on this side of the wire.
  const attempt = await rosterStore()
    .getAttempt(person.id, deckId)
    .catch(() => undefined);

  const resume = attempt
    ? {
        coveredSlideIds: attempt.covered.map((slide) => slide.slideId),
        lastSlideId: attempt.lastSlideId,
        percent: percentComplete(coverageOf(attempt)),
      }
    : null;

  return (
    <DeckProvider deck={toClientView(stored.record)}>
      <SessionScreen reviewed={stored.status === 'published'} resume={resume} />
    </DeckProvider>
  );
}
