import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import type { BlobClient, BlobEntry } from '../decks/store-blob';
import { BlobDeckStore } from '../decks/store-blob';
import { FilesystemDeckStore } from '../decks/store-fs';
import { InMemoryDocumentStore } from '../roster/documents';
import { BlobRosterStore } from '../roster/store-blob';
import { DocumentRosterStore } from '../roster/store-documents';
import { FilesystemRosterStore } from '../roster/store-fs';
import { deckPrefix, filesystemRoot, rosterPrefix, scopedDocuments } from './scope';

/**
 * One customer cannot see another's anything.
 *
 * This is the test the whole stage exists for. Everything else — the types, the
 * registries, the fifty call sites — is machinery in service of this one property, and
 * if it ever fails the machinery is decoration.
 *
 * Written against the stores rather than through HTTP on purpose. A route test proves
 * one route is scoped; this proves the storage layer *cannot* be unscoped, which is
 * the claim being made to a customer signing a contract.
 */

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'isolation-'));
  roots.push(root);
  return root;
}

/** One shared backing store, exactly as a real deployment has. */
function sharedBlob(): BlobClient & { objects: Map<string, string> } {
  const objects = new Map<string, string>();
  const urlFor = (pathname: string) => `https://blob.test/${pathname}`;

  return {
    objects,
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

describe('two customers on one document store', () => {
  function pair() {
    // One underlying store, two scoped views of it. This is the real arrangement:
    // isolation here is code, not infrastructure, which is why it is worth proving.
    const shared = new InMemoryDocumentStore();
    return {
      acme: new DocumentRosterStore(scopedDocuments(shared, 'acme')),
      globex: new DocumentRosterStore(scopedDocuments(shared, 'globex')),
    };
  }

  it('does not show one customer another customer’s people', async () => {
    const { acme, globex } = pair();
    await acme.upsertPerson({ email: 'aditi@acme.com', name: 'Aditi', orgId: 'acme' });

    assert.deepEqual(await globex.listPeople(), []);
    assert.equal(await globex.getPersonByEmail('aditi@acme.com'), undefined);
  });

  it('does not let one customer read another’s person by id', async () => {
    // The id is the auth provider's uid and would be visible to whoever holds it.
    // Guessing it must still get nothing.
    const { acme, globex } = pair();
    const person = await acme.upsertPerson({ id: 'uid-1', email: 'a@acme.com', orgId: 'acme' });

    assert.equal(await globex.getPerson(person.id), undefined);
  });

  it('does not let one customer change another’s person', async () => {
    const { acme, globex } = pair();
    const person = await acme.upsertPerson({ id: 'uid-1', email: 'a@acme.com', orgId: 'acme' });

    await assert.rejects(() => globex.setRole(person.id, 'admin'));
    assert.equal((await acme.getPerson(person.id))?.role, 'trainee');
  });

  it('keeps assignments apart', async () => {
    const { acme, globex } = pair();
    const person = await acme.upsertPerson({ id: 'uid-1', email: 'a@acme.com', orgId: 'acme' });
    await acme.assign({ personId: person.id, deckId: 'isms', assignedBy: person.id });

    assert.deepEqual(await globex.listAssignmentsForDeck('isms'), []);
    assert.deepEqual(await globex.listAssignmentsForPerson(person.id), []);
    assert.equal(await globex.isAssigned(person.id, 'isms'), false);
  });

  it('keeps attempts apart, so progress is not shared', async () => {
    // Progress is evidence about a named person. Of everything here this is the row
    // that would matter most in front of a regulator.
    const { acme, globex } = pair();
    const person = await acme.upsertPerson({ id: 'uid-1', email: 'a@acme.com', orgId: 'acme' });
    await acme.recordCovered({
      personId: person.id,
      deckId: 'isms',
      slideId: 1,
      targetSeconds: 60,
      slideCount: 5,
      totalSeconds: 300,
    });

    assert.equal(await globex.getAttempt(person.id, 'isms'), undefined);
    assert.deepEqual(await globex.listAttemptsForDeck('isms'), []);
  });

  it('lets both hold a person at the same address without colliding', async () => {
    // A contractor at two customers, or simply two people who share a name at a
    // shared mail domain. Neither should overwrite the other.
    const { acme, globex } = pair();
    await acme.upsertPerson({ id: 'uid-a', email: 'sam@shared.com', name: 'Sam A', orgId: 'acme' });
    await globex.upsertPerson({
      id: 'uid-g',
      email: 'sam@shared.com',
      name: 'Sam G',
      orgId: 'globex',
    });

    assert.equal((await acme.getPersonByEmail('sam@shared.com'))?.name, 'Sam A');
    assert.equal((await globex.getPersonByEmail('sam@shared.com'))?.name, 'Sam G');
  });
});

describe('two customers on one blob store', () => {
  it('does not list one customer’s decks to another', async () => {
    const shared = sharedBlob();
    const acme = new BlobDeckStore(shared, deckPrefix('acme'));
    const globex = new BlobDeckStore(shared, deckPrefix('globex'));

    // Listing seeds each store with the worked example, which is a copy per customer
    // rather than one shared deck — so both see it, and neither sees the other's.
    await acme.list();
    const before = (await globex.list()).map((deck) => deck.id).sort();

    const record = (await acme.get('isms'))!.record;
    await acme.save({ ...record, meta: { ...record.meta, id: 'acme-only' } }, 'published');

    assert.ok((await acme.list()).some((deck) => deck.id === 'acme-only'));
    assert.deepEqual(
      (await globex.list()).map((deck) => deck.id).sort(),
      before,
      "one customer's upload appeared in another's library",
    );
  });

  it('does not let one customer read another’s deck by id', async () => {
    // Deck ids are `slug(title) + 6 random chars` and semi-guessable, so this is the
    // realistic attempt: take an id you saw and ask somebody else's store for it.
    const shared = sharedBlob();
    const acme = new BlobDeckStore(shared, deckPrefix('acme'));
    const globex = new BlobDeckStore(shared, deckPrefix('globex'));

    await acme.list();
    const record = (await acme.get('isms'))!.record;
    await acme.save({ ...record, meta: { ...record.meta, id: 'secret-plan' } }, 'published');

    assert.equal(await globex.get('secret-plan'), undefined);
  });

  it('keeps the two rosters in separate objects', async () => {
    const shared = sharedBlob();
    const acme = new BlobRosterStore(shared, rosterPrefix('acme'));
    const globex = new BlobRosterStore(shared, rosterPrefix('globex'));

    await acme.upsertPerson({ email: 'aditi@acme.com', orgId: 'acme' });

    assert.deepEqual(await globex.listPeople(), []);
    assert.ok(
      [...shared.objects.keys()].every((key) => key.startsWith('orgs/')),
      `something was written outside a customer prefix: ${[...shared.objects.keys()].join(', ')}`,
    );
  });
});

describe('two customers on one filesystem', () => {
  it('keeps decks and rosters in separate directories', async () => {
    const base = await tempRoot();

    const acmeDecks = new FilesystemDeckStore(filesystemRoot(base, 'acme', 'decks'));
    const globexDecks = new FilesystemDeckStore(filesystemRoot(base, 'globex', 'decks'));
    const acmeRoster = new FilesystemRosterStore(filesystemRoot(base, 'acme', 'roster'));
    const globexRoster = new FilesystemRosterStore(filesystemRoot(base, 'globex', 'roster'));

    await acmeDecks.list();
    const record = (await acmeDecks.get('isms'))!.record;
    await acmeDecks.save({ ...record, meta: { ...record.meta, id: 'acme-only' } }, 'published');
    await acmeRoster.upsertPerson({ email: 'aditi@acme.com', orgId: 'acme' });

    assert.equal(await globexDecks.get('acme-only'), undefined);
    assert.deepEqual(await globexRoster.listPeople(), []);
  });
});

describe('the scoping primitive itself', () => {
  it('refuses an organisation id that could climb out of its prefix', () => {
    // The id becomes a path segment. If `..` got through, the prefix would stop
    // separating anything, and every test above would still pass.
    for (const bad of ['..', 'a/b', '../etc', '', 'A', 'a.b']) {
      assert.throws(() => deckPrefix(bad), /not a usable organisation id/, `${bad} was allowed`);
      assert.throws(() => rosterPrefix(bad), /not a usable organisation id/, `${bad} was allowed`);
      assert.throws(() => filesystemRoot('/base', bad, 'decks'), /not a usable organisation id/);
    }
  });

  it('puts every collection under the customer', () => {
    const shared = new InMemoryDocumentStore();
    const scoped = scopedDocuments(shared, 'acme');
    assert.match(scoped.kind, /acme/);
  });
});
