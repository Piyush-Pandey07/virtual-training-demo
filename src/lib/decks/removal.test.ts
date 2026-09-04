import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ISMS_DECK } from './isms';
import { removeDeckEverywhere } from './removal';
import { DocumentDeckStore } from './store-documents';
import { InMemoryDocumentStore } from '../roster/documents';
import { DocumentRosterStore } from '../roster/store-documents';
import { scopedDocuments } from '../orgs/scope';
import type { AssetStore } from './assets';
import type { RosterStore } from '../roster/store';

/**
 * What happens to everything else when a deck is removed.
 *
 * The bug this pins was not a crash. Deleting a deck left its assignments behind, and
 * an assignment naming a deck that no longer exists still counts towards what its
 * trainee has been asked to do. Their page read "0 of 2 complete" with the second row
 * showing a deck id instead of a title, and no action available anywhere could ever
 * make it say 2 of 2. Nothing errored, and the administrator who deleted the deck was
 * told only "removed".
 */

/** Enough of an asset store to record what it was asked to forget. */
function assets(): AssetStore & { removed: string[] } {
  const removed: string[] = [];
  return {
    kind: 'filesystem',
    writable: true,
    removed,
    async put() {},
    async get() {
      return undefined;
    },
    async removeAll(deckId: string) {
      removed.push(deckId);
    },
  } as AssetStore & { removed: string[] };
}

async function world() {
  const documents = new InMemoryDocumentStore();
  const scoped = scopedDocuments(documents, 'test-org');
  const decks = new DocumentDeckStore(scoped);
  const roster = new DocumentRosterStore(scoped);

  await decks.save({ ...ISMS_DECK, meta: { ...ISMS_DECK.meta, id: 'doomed' } }, 'published');

  const alice = await roster.upsertPerson({ email: 'alice@example.com', name: 'Alice' });
  const bob = await roster.upsertPerson({ email: 'bob@example.com', name: 'Bob' });
  for (const person of [alice, bob]) {
    await roster.assign({ personId: person.id, deckId: 'doomed', assignedBy: 'admin' });
  }

  return { decks, roster, alice, bob, store: assets() };
}

describe('removing a deck', () => {
  it('takes it off the list of everybody who was told to attend it', async () => {
    const { decks, roster, alice, bob, store } = await world();

    const report = await removeDeckEverywhere(decks, store, roster, 'doomed');

    assert.equal(report.unassigned, 2, 'the caller was told the wrong number of people');
    for (const person of [alice, bob]) {
      const left = await roster.listAssignmentsForPerson(person.id);
      assert.deepEqual(
        left.map((row) => row.deckId),
        [],
        `${person.name} is still assigned a deck that no longer exists`,
      );
    }
  });

  it('leaves other decks alone', async () => {
    const { decks, roster, alice, store } = await world();
    await decks.save({ ...ISMS_DECK, meta: { ...ISMS_DECK.meta, id: 'keeper' } }, 'published');
    await roster.assign({ personId: alice.id, deckId: 'keeper', assignedBy: 'admin' });

    await removeDeckEverywhere(decks, store, roster, 'doomed');

    const left = await roster.listAssignmentsForPerson(alice.id);
    assert.deepEqual(left.map((row) => row.deckId), ['keeper']);
    assert.ok(await decks.get('keeper'), 'removing one deck removed another');
  });

  it('keeps the record that somebody did the training', async () => {
    // Deliberate, and the same rule `unassign` already applies to one person: an
    // assignment is an instruction and stops meaning anything, but an attempt is
    // evidence, and withdrawing a deck does not make it untrue that they sat through
    // it. Somebody restoring the deck should find their history intact.
    const { decks, roster, alice, store } = await world();
    await roster.recordCovered({
      personId: alice.id,
      deckId: 'doomed',
      slideId: 1,
      targetSeconds: 45,
      slideCount: ISMS_DECK.slides.length,
      totalSeconds: 900,
    });

    await removeDeckEverywhere(decks, store, roster, 'doomed');

    const attempt = await roster.getAttempt(alice.id, 'doomed');
    assert.ok(attempt, 'the record of the training they did was destroyed with the deck');
  });

  it('leaves everything alone when the assignments cannot be read', async () => {
    // The failure that used to pass silently. `listAssignmentsForDeck` was wrapped in
    // `.catch(() => [])`, so a storage failure produced an empty worklist, the loop
    // unassigned nobody, and the deck and its renders were deleted anyway -- reporting
    // `unassigned: 0` while leaving every assignment pointing at a deck that no longer
    // exists. That is the exact state this module was written to prevent.
    const { decks, roster, store } = await world();

    // Built on the real store as a prototype rather than spread over it. A spread copies
    // own enumerable properties only, so a class instance loses every method it has and
    // the result is a `RosterStore` in name alone.
    const broken: RosterStore = Object.assign(Object.create(roster) as RosterStore, {
      listAssignmentsForDeck: () => Promise.reject(new Error('storage is down')),
    });

    await assert.rejects(
      () => removeDeckEverywhere(decks, store, broken, 'doomed'),
      /storage is down/,
      'the failure was swallowed instead of stopping the removal',
    );

    assert.ok(await decks.get('doomed'), 'the deck was removed despite the failure');
    assert.deepEqual(store.removed, [], 'the renders were removed despite the failure');
  });

  it('clears assignments in parallel batches rather than one at a time', async () => {
    // Not a style preference. The route calling this runs with maxDuration = 30, and a
    // mandatory deck is assigned to everybody, so a serial loop over a few hundred
    // people runs out of clock. A timeout is worse than an error here: nothing throws,
    // the function is killed mid-loop, and it leaves some people unassigned and some
    // not, with the deck still present and nothing raised to say so.
    const { decks, roster, store } = await world();

    const people = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        roster.upsertPerson({ email: `p${i}@example.com`, name: `P${i}` }),
      ),
    );
    for (const person of people) {
      await roster.assign({ personId: person.id, deckId: 'doomed', assignedBy: 'admin' });
    }

    let inFlight = 0;
    let peakConcurrency = 0;
    const watched: RosterStore = Object.assign(Object.create(roster) as RosterStore, {
      unassign: async (personId: string, deckId: string) => {
        inFlight += 1;
        peakConcurrency = Math.max(peakConcurrency, inFlight);
        await Promise.resolve();
        await roster.unassign(personId, deckId);
        inFlight -= 1;
      },
    });

    const report = await removeDeckEverywhere(decks, store, watched, 'doomed');

    assert.equal(report.unassigned, 62, 'the two from the fixture plus the sixty added');
    assert.ok(
      peakConcurrency > 1,
      `unassign ran one at a time (peak concurrency ${peakConcurrency}), which is the ` +
        'shape that runs out of the route budget on a widely assigned deck',
    );
    assert.ok(
      peakConcurrency <= 25,
      `unassign opened ${peakConcurrency} at once; unbounded parallelism replaces a slow ` +
        'delete with a thundering herd on a deck given to a thousand people',
    );

    for (const person of people.slice(0, 5)) {
      assert.deepEqual(await roster.listAssignmentsForPerson(person.id), []);
    }
  });

  it('removes the renders and the record itself', async () => {
    const { decks, roster, store } = await world();

    await removeDeckEverywhere(decks, store, roster, 'doomed');

    assert.deepEqual(store.removed, ['doomed'], 'the rendered pages were left in storage');
    assert.equal(await decks.get('doomed'), undefined, 'the deck record survived');
  });
});
