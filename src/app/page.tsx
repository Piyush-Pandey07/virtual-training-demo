/**
 * The front door, which is two different places.
 *
 * A trainee gets their assigned training and nothing else. HR gets the library, the
 * upload, and the reports. One route rather than two, because two `page.tsx` at the
 * same path is not a thing Next allows, and because "where do I go when I sign in"
 * should not be a decision the person has to make.
 */

import type { Metadata } from 'next';

import { nextStepAfterSession, type NextStep } from '@/lib/assessments/service';
import { requireUserPage } from '@/lib/auth/guard';
import { DEFAULT_DECK_ID, deckStore, listDecks, loadDeck } from '@/lib/decks/registry';
import { COMPLETION_THRESHOLD, completionPercentOf } from '@/lib/roster/completion';
import { rosterStore } from '@/lib/roster/registry';
import { peopleOverview, trainingFor } from '@/lib/roster/report';
import { journeysFor } from '@/lib/training/journey';
import { isAdministrator } from '@/lib/auth/permissions';
import { recentProviderAlerts } from '@/lib/failures/alerts';
import { HOME_ORG_ID } from '@/lib/orgs/types';
import { monthlyAllowance } from '@/lib/usage/limits';
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
    // The AI-led sessions under way or completed, which are the cards that say what comes
    // after. A deck taught in the room has its steps on its session's card instead, and
    // one not started yet has nothing after it to speak of.
    const inTheRoom = new Set(journeys.map((journey) => journey.deckId));
    const aiLed = rows.filter(
      (row) =>
        !inTheRoom.has(row.deckId) &&
        row.deckTitle !== null &&
        (row.completedAt !== null || row.percent > 0),
    );
    const [completionPercents, afterSession] = await Promise.all([
      // Each deck's own completion point (AI-34), for the cards and the note under them.
      // A participant has a handful of decks, so reading each is cheap.
      Promise.all(
        rows.map(async (row) => [
          row.deckId,
          await loadDeck(person.orgId, row.deckId)
            .then((deck) => (deck ? completionPercentOf(deck.meta) : COMPLETION_THRESHOLD))
            .catch(() => COMPLETION_THRESHOLD),
        ]),
      ).then((entries) => Object.fromEntries(entries) as Record<string, number>),
      // What follows each of those, so its card can link the post-session assessment or
      // feedback once the session is completed, and say until then that it opens then
      // (UAT issue 12). Without it, somebody who left a completed session other than by
      // its end screen had no way back to either.
      Promise.all(
        aiLed.map(async (row) => [
          row.deckId,
          await nextStepAfterSession(person.orgId, person.id, row.deckId).catch(() => null),
        ]),
      ).then((entries) => Object.fromEntries(entries) as Record<string, NextStep | null>),
    ]);
    return (
      <HomeForTrainee
        person={person}
        rows={rows}
        journeys={journeys}
        completionPercents={completionPercents}
        afterSession={afterSession}
      />
    );
  }

  const store = deckStore(person.orgId);
  // A customer's administrator sees their own monthly allowance (UAT, issue 19).
  // Technavious's own organisation has none, and its staff see every customer's on the
  // Customers page; looking inside a customer, they see that customer's here.
  const showsAllowance = person.role === 'admin' && person.orgId !== HOME_ORG_ID;
  const [decks, people, alerts, allowance] = await Promise.all([
    listDecks(person.orgId),
    peopleOverview(person.orgId).catch(() => []),
    // Technavious administrators only: the services that need somebody to act (AI-11).
    isAdministrator(person) ? recentProviderAlerts().catch(() => []) : Promise.resolve([]),
    showsAllowance ? monthlyAllowance(person.orgId) : Promise.resolve(null),
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
      allowance={allowance}
    />
  );
}
