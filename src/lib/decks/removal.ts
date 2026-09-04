import type { AssetStore } from './assets';
import type { DeckStore } from './store';
import type { RosterStore } from '../roster/store';

/**
 * Removing a deck, and everything that pointed at it.
 *
 * Three stores hold a piece of a deck: the record and its slides, the rendered pages,
 * and the assignments telling people to attend it. Removing the first two and leaving
 * the third is not a tidiness problem. An assignment naming a deck that no longer
 * exists still counts towards what its trainee has been asked to do, and nothing can
 * ever complete it, so the person is stranded one deck short of finished for as long
 * as the row survives -- on a deck whose title the screen cannot even look up, so it
 * shows the id instead.
 *
 * Attempts are the deliberate exception. They are the record that somebody sat through
 * the training, which stays true after the deck is withdrawn; `unassign` already makes
 * that distinction for a single person and this is the same rule applied to everybody
 * at once. An attempt on a removed deck is unreachable rather than wrong, and deck ids
 * carry six random characters so a later deck cannot inherit one.
 *
 * Takes its stores rather than reaching for them, so the order below can be tested
 * without Firestore or blob storage.
 */
export interface DeckRemoval {
  /** How many people were told to attend it, and no longer are. */
  unassigned: number;
}

/**
 * How many assignments to clear at once.
 *
 * One at a time was the first version, on the reasoning that a slower delete is a
 * correct delete. That reasoning missed the clock. The route that calls this runs
 * with `maxDuration = 30`, and a mandatory deck is assigned to everybody: at roughly
 * fifty to a hundred milliseconds per round trip, a few hundred people exhausts the
 * budget. A timeout is worse than the failure this function was written to handle,
 * because nothing throws. The function is killed mid-loop, so some people are
 * unassigned and some are not, the deck is still there, and no code path runs to say
 * so.
 *
 * Bounded rather than unbounded for the opposite reason: `Promise.all` over every
 * assignment would open one connection per person, and a deck given to a thousand
 * people would replace a slow delete with a thundering herd.
 */
const UNASSIGN_BATCH = 25;

async function unassignAll(
  roster: RosterStore,
  assignments: { personId: string }[],
  deckId: string,
): Promise<void> {
  for (let from = 0; from < assignments.length; from += UNASSIGN_BATCH) {
    const batch = assignments.slice(from, from + UNASSIGN_BATCH);
    await Promise.all(batch.map((row) => roster.unassign(row.personId, deckId)));
  }
}

export async function removeDeckEverywhere(
  decks: DeckStore,
  assets: AssetStore,
  roster: RosterStore,
  deckId: string,
): Promise<DeckRemoval> {
  // Assignments first, because this is the half that is visible to somebody. If the
  // deck record survives a failure here the deck is merely still there, which is the
  // state the administrator started in and can retry from.
  //
  // Deliberately not caught. Swallowing the failure and carrying on with an empty list
  // would delete the deck and leave every assignment pointing at it, which is the exact
  // state this function exists to prevent -- and it would report `unassigned: 0` while
  // doing it, so nothing would look wrong. Failing here leaves the deck intact.
  const assignments = await roster.listAssignmentsForDeck(deckId);
  await unassignAll(roster, assignments, deckId);

  // Renders before the record. A deck record with no images is a broken session;
  // orphaned images with no record are invisible, so that is the better order to
  // fail in.
  await assets.removeAll(deckId);
  await decks.remove(deckId);

  return { unassigned: assignments.length };
}
