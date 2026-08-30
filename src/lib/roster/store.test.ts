import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { coverageOf, percentComplete } from './completion';
import { emailKeyOf, localPersonId, withCovered, type RosterStore } from './store';
import type { BlobEntry, BlobClient } from '../decks/store-blob';
import { InMemoryDocumentStore } from './documents';
import { BlobRosterStore } from './store-blob';
import { DocumentRosterStore } from './store-documents';
import { FilesystemRosterStore } from './store-fs';
import { NoRosterStore } from './store-none';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function freshStore(): Promise<RosterStore> {
  const root = await mkdtemp(join(tmpdir(), 'roster-'));
  roots.push(root);
  return new FilesystemRosterStore(root);
}

/** In memory, in the shape the deck store's blob client already has. */
function fakeBlobClient(): BlobClient {
  const objects = new Map<string, string>();
  const urlFor = (pathname: string) => `https://blob.test/${pathname}`;

  return {
    async put(pathname: string, body: string): Promise<BlobEntry> {
      objects.set(pathname, body);
      return { pathname, url: urlFor(pathname) };
    },
    async list(prefix: string): Promise<BlobEntry[]> {
      return [...objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ pathname: key, url: urlFor(key) }));
    },
    async remove(urls: string[]): Promise<void> {
      for (const url of urls) objects.delete(url.replace('https://blob.test/', ''));
    },
    async read(pathname: string): Promise<string | null> {
      return objects.get(pathname) ?? null;
    },
  };
}

/**
 * Both writable stores are held to the same contract.
 *
 * They are different enough to drift — one keeps a single document, the other keeps
 * an object per attempt — and the difference is exactly where a bug would hide.
 */
const HARNESSES: Array<{ name: string; make: () => Promise<RosterStore> }> = [
  { name: 'the filesystem store', make: freshStore },
  { name: 'the blob store', make: async () => new BlobRosterStore(fakeBlobClient()) },
  {
    name: 'the document store',
    make: async () => new DocumentRosterStore(new InMemoryDocumentStore()),
  },
];

const DECK = { deckId: 'fire-safety', slideCount: 5, totalSeconds: 500 };

for (const harness of HARNESSES) {
  describe(harness.name, () => {
    runContract(harness.make);
  });
}

function runContract(make: () => Promise<RosterStore>) {
  let store: RosterStore;

  beforeEach(async () => {
    store = await make();
  });

  describe('people', () => {
    it('creates somebody on first sight and finds them again by address', async () => {
      const made = await store.upsertPerson({ email: 'Aditi@Technavious.com', name: 'Aditi' });
      const found = await store.getPersonByEmail('  aditi@technavious.com ');
      assert.equal(found?.id, made.id);
    });

    it('keeps the address as spelled but joins on the lower-cased form', async () => {
      const made = await store.upsertPerson({ email: 'Aditi@Technavious.com' });
      assert.equal(made.email, 'Aditi@Technavious.com');
      assert.equal(made.emailKey, 'aditi@technavious.com');
    });

    it('does not create a second row for the same person', async () => {
      await store.upsertPerson({ email: 'a@technavious.com' });
      await store.upsertPerson({ email: 'A@TECHNAVIOUS.COM', name: 'Later' });
      assert.equal((await store.listPeople()).length, 1);
    });

    it('starts everyone as a trainee', async () => {
      const made = await store.upsertPerson({ email: 'a@technavious.com' });
      assert.equal(made.role, 'trainee');
    });

    it('does not let signing in restore a role an admin just removed', async () => {
      // upsertPerson runs on every sign-in. If it took the role from its input, a
      // demoted admin would be re-promoted the next time they signed in.
      const made = await store.upsertPerson({ email: 'a@technavious.com' });
      await store.setRole(made.id, 'admin');
      const again = await store.upsertPerson({ email: 'a@technavious.com', role: 'admin' });
      assert.equal(again.role, 'admin');

      await store.setRole(made.id, 'trainee');
      const third = await store.upsertPerson({ email: 'a@technavious.com', role: 'admin' });
      assert.equal(third.role, 'trainee');
    });

    it('carries assignments across when somebody added by hand first signs in', async () => {
      // An admin assigns work to an address before that person has ever signed in.
      // When they do, the provider gives them a real id, and their work must follow.
      const added = await store.upsertPerson({ email: 'niranjan@technavious.com' });
      assert.equal(added.id, localPersonId('niranjan@technavious.com'));
      await store.assign({ personId: added.id, deckId: DECK.deckId, assignedBy: 'admin' });

      const signedIn = await store.upsertPerson({
        id: 'firebase-uid-123',
        email: 'niranjan@technavious.com',
        name: 'Niranjan',
      });
      assert.equal(signedIn.id, 'firebase-uid-123');
      assert.equal((await store.listPeople()).length, 1);
      assert.deepEqual(
        (await store.listAssignmentsForPerson('firebase-uid-123')).map((row) => row.deckId),
        [DECK.deckId],
      );
    });

    it('takes a person and their records away together', async () => {
      const made = await store.upsertPerson({ email: 'a@technavious.com' });
      await store.assign({ personId: made.id, deckId: DECK.deckId, assignedBy: 'admin' });
      await store.recordCovered({ personId: made.id, slideId: 1, targetSeconds: 100, ...DECK });

      await store.removePerson(made.id);
      assert.deepEqual(await store.listPeople(), []);
      assert.deepEqual(await store.listAssignmentsForDeck(DECK.deckId), []);
      assert.deepEqual(await store.listAttemptsForDeck(DECK.deckId), []);
    });
  });

  describe('assignments', () => {
    it('is what decides whether somebody may attend', async () => {
      const made = await store.upsertPerson({ email: 'a@technavious.com' });
      assert.equal(await store.isAssigned(made.id, DECK.deckId), false);
      await store.assign({ personId: made.id, deckId: DECK.deckId, assignedBy: 'admin' });
      assert.equal(await store.isAssigned(made.id, DECK.deckId), true);
    });

    it('assigning twice changes the due date without rewriting the record', async () => {
      const made = await store.upsertPerson({ email: 'a@technavious.com' });
      const first = await store.assign({
        personId: made.id,
        deckId: DECK.deckId,
        assignedBy: 'admin-one',
        dueAt: '2026-03-31T00:00:00.000Z',
      });
      const second = await store.assign({
        personId: made.id,
        deckId: DECK.deckId,
        assignedBy: 'admin-two',
        dueAt: '2026-04-30T00:00:00.000Z',
      });

      assert.equal((await store.listAssignmentsForPerson(made.id)).length, 1);
      assert.equal(second.dueAt, '2026-04-30T00:00:00.000Z');
      assert.equal(
        second.assignedBy,
        'admin-one',
        'who first asked is the record of the instruction',
      );
      assert.equal(second.assignedAt, first.assignedAt);
    });

    it('keeps the attempt when work is unassigned', async () => {
      // Somebody who did the training and then had it unassigned still did the
      // training. Deleting that would be the wrong kind of tidy.
      const made = await store.upsertPerson({ email: 'a@technavious.com' });
      await store.assign({ personId: made.id, deckId: DECK.deckId, assignedBy: 'admin' });
      await store.recordCovered({ personId: made.id, slideId: 1, targetSeconds: 100, ...DECK });

      await store.unassign(made.id, DECK.deckId);
      assert.equal(await store.isAssigned(made.id, DECK.deckId), false);
      assert.ok(await store.getAttempt(made.id, DECK.deckId));
    });
  });

  describe('progress', () => {
    let personId: string;

    beforeEach(async () => {
      personId = (await store.upsertPerson({ email: 'a@technavious.com' })).id;
    });

    it('opens an attempt on the first slide, without a start call arriving first', async () => {
      const attempt = await store.recordCovered({
        personId,
        slideId: 1,
        targetSeconds: 100,
        ...DECK,
      });
      assert.equal(attempt.covered.length, 1);
      assert.equal(attempt.lastSlideId, 1);
    });

    it('counts the same slide once, however many times it arrives', async () => {
      // Two tabs, a retry, or a trainee re-narrating a slide they already heard.
      for (let i = 0; i < 3; i += 1) {
        await store.recordCovered({ personId, slideId: 2, targetSeconds: 100, ...DECK });
      }
      const attempt = await store.getAttempt(personId, DECK.deckId);
      assert.equal(attempt?.covered.length, 1);
    });

    it('keeps covered slides in slide order however they arrive', async () => {
      for (const slideId of [4, 1, 3]) {
        await store.recordCovered({ personId, slideId, targetSeconds: 100, ...DECK });
      }
      const attempt = await store.getAttempt(personId, DECK.deckId);
      assert.deepEqual(
        attempt?.covered.map((slide) => slide.slideId),
        [1, 3, 4],
      );
    });

    it('records the weighting rather than trusting the deck later', async () => {
      await store.recordCovered({ personId, slideId: 1, targetSeconds: 150, ...DECK });
      const attempt = await store.getAttempt(personId, DECK.deckId);
      assert.equal(attempt?.covered[0]?.targetSeconds, 150);
    });

    it('does not move the denominator under an attempt already open', async () => {
      // Re-analysing a deck changes its pacing. Somebody halfway through keeps the
      // deck as it was, or their percentage would move without them doing anything.
      await store.recordCovered({ personId, slideId: 1, targetSeconds: 100, ...DECK });
      await store.recordCovered({
        personId,
        slideId: 2,
        targetSeconds: 100,
        deckId: DECK.deckId,
        slideCount: 40,
        totalSeconds: 4000,
      });

      const attempt = await store.getAttempt(personId, DECK.deckId);
      assert.equal(attempt?.totalSeconds, 500);
      assert.equal(attempt?.slideCount, 5);
    });

    it('marks a session complete once enough of it has been taught', async () => {
      for (const slideId of [1, 2, 3, 4]) {
        await store.recordCovered({ personId, slideId, targetSeconds: 125, ...DECK });
      }
      const attempt = await store.getAttempt(personId, DECK.deckId);
      assert.ok(attempt);
      assert.equal(percentComplete(coverageOf(attempt)), 100);
      assert.ok(attempt.completedAt, 'should have stamped a completion');
    });

    it('does not re-stamp a completion that already happened', async () => {
      for (const slideId of [1, 2, 3, 4]) {
        await store.recordCovered({ personId, slideId, targetSeconds: 125, ...DECK });
      }
      const first = (await store.getAttempt(personId, DECK.deckId))?.completedAt;
      await store.recordCovered({ personId, slideId: 5, targetSeconds: 0, ...DECK });
      const second = (await store.getAttempt(personId, DECK.deckId))?.completedAt;
      assert.equal(first, second);
    });

    it('does not call a barely-started session complete', async () => {
      await store.recordCovered({ personId, slideId: 1, targetSeconds: 100, ...DECK });
      const attempt = await store.getAttempt(personId, DECK.deckId);
      assert.equal(attempt?.completedAt, null);
    });

    it('opens an attempt without covering anything, so a lobby visit is recorded', async () => {
      const attempt = await store.touchAttempt({ personId, ...DECK });
      assert.deepEqual(attempt.covered, []);
      assert.equal(attempt.lastSlideId, null);
    });
  });
}

describe('a deployment with no roster storage', () => {
  const store: RosterStore = new NoRosterStore();

  it('reads as empty rather than throwing, so a page can still render', async () => {
    assert.deepEqual(await store.listPeople(), []);
    assert.deepEqual(await store.listAssignmentsForPerson('anyone'), []);
    assert.equal(await store.isAssigned('anyone', 'any-deck'), false);
  });

  it('refuses a write, naming what is missing', async () => {
    await assert.rejects(() => store.upsertPerson({ email: 'a@technavious.com' }), /Firebase/);
  });

  it('assigns nobody, so nothing is reachable by default', async () => {
    assert.equal(await store.isAssigned('someone', 'isms'), false);
  });
});

describe('the small shared pieces', () => {
  it('normalises an address the same way everywhere', () => {
    assert.equal(emailKeyOf('  Aditi@Technavious.COM '), 'aditi@technavious.com');
  });

  it('derives a stable id from an address rather than a random one', () => {
    // Adding the same person twice must collide on the key rather than produce two
    // rows nobody can tell apart.
    assert.equal(
      localPersonId('aditi@technavious.com'),
      localPersonId('  Aditi@Technavious.com  '),
    );
  });

  it('will not count a slide twice', () => {
    const at = '2026-03-03T10:00:00.000Z';
    const once = withCovered([], { slideId: 1, targetSeconds: 100, coveredAt: at });
    const twice = withCovered(once, { slideId: 1, targetSeconds: 999, coveredAt: 'later' });
    assert.equal(twice.length, 1);
    assert.equal(twice[0]?.targetSeconds, 100, 'the first time it was taught is the record');
  });
});

/**
 * The reason for moving off blob storage.
 *
 * A real database runs the change function again when another writer got there
 * first, so it has to be a pure function of what it is handed and safe to run twice.
 * Get that wrong and the retry is where a slide quietly goes missing — which is
 * exactly the failure this whole change exists to remove, and it would never show up
 * in a test that only ever calls it once.
 */
describe('surviving a retry, which is what makes a document store atomic', () => {
  /** Runs every change twice, as a contended transaction would. */
  class RetryingDocumentStore extends InMemoryDocumentStore {
    override async update<T>(
      collection: string,
      id: string,
      change: (current: T | undefined) => T,
    ): Promise<T> {
      // The first attempt is thrown away, exactly as a database discards the work of
      // a transaction it is about to retry.
      change(await this.get<T>(collection, id));
      return super.update(collection, id, change);
    }
  }

  const DECK = { deckId: 'fire-safety', slideCount: 5, totalSeconds: 500 };

  it('counts a slide once even when the write is retried', async () => {
    const store = new DocumentRosterStore(new RetryingDocumentStore());
    const personId = (await store.upsertPerson({ email: 'a@technavious.com' })).id;

    await store.recordCovered({ personId, slideId: 2, targetSeconds: 100, ...DECK });

    const attempt = await store.getAttempt(personId, DECK.deckId);
    assert.equal(attempt?.covered.length, 1);
    assert.equal(attempt?.covered[0]?.slideId, 2);
  });

  it('keeps every slide when several are written in turn', async () => {
    const store = new DocumentRosterStore(new RetryingDocumentStore());
    const personId = (await store.upsertPerson({ email: 'a@technavious.com' })).id;

    for (const slideId of [1, 2, 3, 4]) {
      await store.recordCovered({ personId, slideId, targetSeconds: 100, ...DECK });
    }

    const attempt = await store.getAttempt(personId, DECK.deckId);
    assert.deepEqual(
      attempt?.covered.map((slide) => slide.slideId),
      [1, 2, 3, 4],
    );
  });

  it('does not stamp a completion twice under retry', async () => {
    const store = new DocumentRosterStore(new RetryingDocumentStore());
    const personId = (await store.upsertPerson({ email: 'a@technavious.com' })).id;

    for (const slideId of [1, 2, 3, 4]) {
      await store.recordCovered({ personId, slideId, targetSeconds: 125, ...DECK });
    }
    const first = (await store.getAttempt(personId, DECK.deckId))?.completedAt;

    await store.recordCovered({ personId, slideId: 5, targetSeconds: 0, ...DECK });
    assert.equal((await store.getAttempt(personId, DECK.deckId))?.completedAt, first);
  });

  it('does not duplicate an assignment when the write is retried', async () => {
    const store = new DocumentRosterStore(new RetryingDocumentStore());
    const personId = (await store.upsertPerson({ email: 'a@technavious.com' })).id;

    await store.assign({ personId, deckId: DECK.deckId, assignedBy: 'admin' });
    await store.assign({ personId, deckId: DECK.deckId, assignedBy: 'admin' });

    assert.equal((await store.listAssignmentsForPerson(personId)).length, 1);
  });
});
