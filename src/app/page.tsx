/**
 * The front door, which is two different places.
 *
 * A trainee gets their assigned training and nothing else. HR gets the library, the
 * upload, and the reports. One route rather than two, because two `page.tsx` at the
 * same path is not a thing Next allows, and because "where do I go when I sign in"
 * should not be a decision the person has to make.
 */

import type { Metadata } from 'next';

import { requireUserPage } from '@/lib/auth/guard';
import { DEFAULT_DECK_ID, deckStore, listDecks } from '@/lib/decks/registry';
import { rosterStore } from '@/lib/roster/registry';
import { peopleOverview, trainingFor } from '@/lib/roster/report';
import { HomeForAdmin } from './HomeForAdmin';
import { HomeForTrainee } from './HomeForTrainee';

// Read per request. There is per-person content on this page now, so caching it
// would be serving one person's training to the next.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Technavious | AI-led training sessions',
  description:
    'Upload a deck and run a one to one training session where an AI trainer presents it and answers questions by voice.',
};

export default async function HomePage() {
  const person = await requireUserPage('/');

  if (person.role !== 'admin') {
    return <HomeForTrainee person={person} rows={await trainingFor(person)} />;
  }

  const store = deckStore();
  const [decks, people] = await Promise.all([listDecks(), peopleOverview().catch(() => [])]);

  // Uploaded decks only. The built-in deck is reachable from the one button in the
  // hero, and listing it here as well would put the sample back in the middle of a
  // page that is meant to be about the trainer's own decks.
  //
  // Keyed on origin rather than readOnly, because seeding the built-in deck into a
  // writable store makes it editable without making it the trainer's.
  const uploaded = decks.filter((deck) => deck.origin !== 'authored');

  return (
    <HomeForAdmin
      person={person}
      uploaded={uploaded}
      demo={decks.find((deck) => deck.id === DEFAULT_DECK_ID)}
      canUpload={store.writable}
      peopleCount={people.length}
      outstanding={people.reduce((total, row) => total + row.assigned - row.completed, 0)}
      rosterReady={rosterStore().writable}
    />
  );
}
