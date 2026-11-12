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
import { DEFAULT_DECK_ID, deckStore, listDecks, loadDeck } from '@/lib/decks/registry';
import { COMPLETION_THRESHOLD, completionPercentOf } from '@/lib/roster/completion';
import { rosterStore } from '@/lib/roster/registry';
import { peopleOverview, trainingFor } from '@/lib/roster/report';
import { journeysFor } from '@/lib/training/journey';
import { isAdministrator } from '@/lib/auth/permissions';
import { recentProviderAlerts } from '@/lib/failures/alerts';
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
    const [rows, journeys] = await Promise.all([
      trainingFor(person.orgId, person),
      journeysFor(person).catch(() => []),
    ]);
    // Each deck's own completion point (AI-34), for the cards and the note under them. A
    // participant has a handful of decks, so reading each is cheap.
    const completionPercents = Object.fromEntries(
      await Promise.all(
        rows.map(async (row) => [
          row.deckId,
          await loadDeck(person.orgId, row.deckId)
            .then((deck) => (deck ? completionPercentOf(deck.meta) : COMPLETION_THRESHOLD))
            .catch(() => COMPLETION_THRESHOLD),
        ]),
      ),
    ) as Record<string, number>;
    return (
      <HomeForTrainee
        person={person}
        rows={rows}
        journeys={journeys}
        completionPercents={completionPercents}
      />
    );
  }

  const store = deckStore(person.orgId);
  const [decks, people, alerts] = await Promise.all([
    listDecks(person.orgId),
    peopleOverview(person.orgId).catch(() => []),
    // Technavious administrators only: the services that need somebody to act (AI-11).
    isAdministrator(person) ? recentProviderAlerts().catch(() => []) : Promise.resolve([]),
  ]);

  // Uploaded decks only. The built-in deck is reachable from the one button in the
  // hero, and listing it here as well would put the sample back in the middle of a
  // page that is meant to be about the trainer's own decks.
  //
  // Keyed on origin rather than readOnly, because seeding the built-in deck into a
  // writable store makes it editable without making it the trainer's.
  //
  // A company administrator sees only what is published, since uploading and reviewing
  // are Technavious's and a draft is not theirs to see.
  const manages = isAdministrator(person);
  const uploaded = decks.filter(
    (deck) => deck.origin !== 'authored' && (manages || deck.status === 'published'),
  );
  const demo = decks.find((deck) => deck.id === DEFAULT_DECK_ID);

  return (
    <HomeForAdmin
      person={person}
      uploaded={uploaded}
      demo={manages || demo?.status === 'published' ? demo : undefined}
      mayManageDecks={manages}
      canUpload={manages && store.writable}
      peopleCount={people.length}
      outstanding={people.reduce((total, row) => total + row.assigned - row.completed, 0)}
      rosterReady={rosterStore(person.orgId).writable}
      alerts={alerts}
    />
  );
}
