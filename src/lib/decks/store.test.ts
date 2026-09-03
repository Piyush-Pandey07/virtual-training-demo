import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import type { DeckRecord } from '../deck-types';
import { ISMS_DECK } from './isms';
import { checkReadyToPublish, DECK_FORMAT_VERSION, parseDeck, serialiseDeck } from './serialise';
import { assertUsableDeckId, DeckInvalidError, DeckStoreError, type DeckStore } from './store';
import { BlobDeckStore, type BlobClient, type BlobEntry } from './store-blob';
import { FilesystemDeckStore } from './store-fs';
import { SeededDeckStore } from './store-seeded';
import { InMemoryDocumentStore } from '../roster/documents';
import { scopedDocuments } from '../orgs/scope';
import { DocumentDeckStore } from './store-documents';

/** One customer's prefix. The stores are scoped at construction, so tests are too. */
const TEST_DECK_BASE = 'orgs/test-org/decks';

/** A second deck, so listing and defaulting are exercised with more than one. */
function otherDeck(): DeckRecord {
  return {
    ...ISMS_DECK,
    meta: { ...ISMS_DECK.meta, id: 'fire-safety', title: 'Fire Safety Awareness' },
  };
}

// ===========================================================================
// Serialisation
// ===========================================================================

describe('serialising a deck', () => {
  it('round-trips without losing anything', () => {
    const parsed = parseDeck(serialiseDeck(ISMS_DECK));
    assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('; '));
    assert.deepEqual(parsed.record, ISMS_DECK);
  });

  it('records the format version, so a future change can migrate', () => {
    const envelope = JSON.parse(serialiseDeck(ISMS_DECK));
    assert.equal(envelope.version, DECK_FORMAT_VERSION);
  });

  it('refuses a deck written by a newer build rather than guessing', () => {
    const text = JSON.stringify({ version: DECK_FORMAT_VERSION + 1, record: ISMS_DECK });
    const parsed = parseDeck(text);
    assert.ok(!parsed.ok);
    assert.match(parsed.errors[0], /format version/);
  });

  it('accepts a bare record, for a deck written by hand', () => {
    assert.ok(parseDeck(JSON.stringify(ISMS_DECK)).ok);
  });
});

/**
 * Once a deck comes from storage, the compiler is no longer what guarantees its
 * shape. Every one of these produced a session that started and then misbehaved
 * later, which is much harder to diagnose than a refusal at load.
 */
describe('validating a stored deck', () => {
  function errorsFor(mutate: (deck: DeckRecord) => void): string[] {
    const copy = JSON.parse(JSON.stringify(ISMS_DECK)) as DeckRecord;
    mutate(copy);
    const parsed = parseDeck(JSON.stringify(copy));
    assert.ok(!parsed.ok, 'expected this deck to be rejected');
    return parsed.errors;
  }

  it('rejects malformed JSON with the reason', () => {
    const parsed = parseDeck('{ not json');
    assert.ok(!parsed.ok);
    assert.match(parsed.errors[0], /not valid JSON/);
  });

  it('names a missing meta field', () => {
    const errors = errorsFor((deck) => {
      delete (deck.meta as Partial<DeckRecord['meta']>).spokenSubject;
    });
    assert.ok(errors.some((e) => e.includes('meta.spokenSubject')));
  });

  it('names a missing slide field, with its index', () => {
    const errors = errorsFor((deck) => {
      delete (deck.slides[2] as Partial<DeckRecord['slides'][number]>).targetSeconds;
    });
    assert.ok(errors.some((e) => e.includes('slides[2].targetSeconds')));
  });

  it('reports every problem at once rather than only the first', () => {
    const errors = errorsFor((deck) => {
      delete (deck.meta as Partial<DeckRecord['meta']>).title;
      delete (deck.slides[0] as Partial<DeckRecord['slides'][number]>).image;
      delete (deck.slides[1] as Partial<DeckRecord['slides'][number]>).narrationBrief;
    });
    assert.ok(errors.length >= 3, `only found: ${errors.join('; ')}`);
  });

  it('rejects an absurd slide duration', () => {
    const errors = errorsFor((deck) => {
      deck.slides[0].targetSeconds = 99_999;
    });
    assert.ok(errors.some((e) => e.includes('targetSeconds')));
  });

  it('rejects duplicate slide ids', () => {
    const errors = errorsFor((deck) => {
      deck.slides[1].id = deck.slides[0].id;
    });
    assert.ok(errors.some((e) => e.includes('share the id')));
  });

  it('rejects a topic pointing at a slide that does not exist', () => {
    const errors = errorsFor((deck) => {
      deck.topics[0].slideIds = [99];
    });
    assert.ok(errors.some((e) => e.includes('slide 99, which does not exist')));
  });

  it('rejects a topic with no triggers, which could never be retrieved', () => {
    const errors = errorsFor((deck) => {
      deck.topics[0].triggers = [];
    });
    assert.ok(errors.some((e) => e.includes('no triggers')));
  });

  it('accepts a deck with no expertise at all, which is what an upload is', () => {
    // Structural validity and readiness are different questions. A deck that has
    // been rendered but not yet analysed is a perfectly good deck to have stored;
    // it just is not ready to put in front of anyone. Refusing it here would leave
    // nowhere to keep a deck between uploading and analysing it.
    const copy = JSON.parse(JSON.stringify(ISMS_DECK)) as DeckRecord;
    copy.topics = [];
    const parsed = parseDeck(JSON.stringify(copy));
    assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('; '));
  });

  it('rejects a deck with no slides', () => {
    const errors = errorsFor((deck) => {
      deck.slides = [];
    });
    assert.ok(errors.some((e) => e.includes('no slides')));
  });
});

// ===========================================================================
// Deck ids
// ===========================================================================

describe('deck ids', () => {
  it('accepts the shapes a generated deck will use', () => {
    for (const id of ['isms', 'fire-safety', 'deck-2026-01', 'a']) {
      assert.doesNotThrow(() => assertUsableDeckId(id));
    }
  });

  it('refuses anything that could escape its own prefix', () => {
    // A store key is built by concatenation, so traversal and separators have to be
    // refused here rather than trusted to the storage layer.
    for (const id of ['../secrets', 'a/b', 'a\\b', '', 'UPPER', 'has space', '.', 'a'.repeat(65)]) {
      assert.throws(() => assertUsableDeckId(id), DeckStoreError, `"${id}" should be refused`);
    }
  });
});

// ===========================================================================
// A fake blob store, so the production store's logic is actually covered
// ===========================================================================

/**
 * In-memory stand-in for Vercel Blob.
 *
 * The real client is four SDK calls; everything that can be wrong is above it. This
 * makes the key layout, the seeding rule and the parse-failure paths testable
 * without a storage token, which is the difference between shipping this stage
 * verified and shipping it hoped-for.
 */
function fakeBlobClient(): BlobClient & {
  objects: Map<string, string>;
  puts: number;
  lists: number;
  reads: number;
} {
  const objects = new Map<string, string>();
  const urlFor = (pathname: string) => `https://blob.test/${pathname}`;

  const client = {
    objects,
    puts: 0,
    // Counted because the cost of this store is round trips, not CPU, and the
    // difference between one call and one per deck is invisible in every other test.
    lists: 0,
    reads: 0,

    async put(pathname: string, body: string): Promise<BlobEntry> {
      client.puts += 1;
      objects.set(pathname, body);
      return { pathname, url: urlFor(pathname) };
    },

    async list(prefix: string): Promise<BlobEntry[]> {
      client.lists += 1;
      return [...objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ pathname: key, url: urlFor(key) }));
    },

    async remove(urls: string[]): Promise<void> {
      for (const url of urls) {
        const pathname = url.replace('https://blob.test/', '');
        objects.delete(pathname);
      }
    },

    async read(pathname: string): Promise<string | null> {
      client.reads += 1;
      return objects.get(pathname) ?? null;
    },
  };

  return client;
}

// ===========================================================================
// Behaviour shared by both writable stores
// ===========================================================================

interface Harness {
  name: string;
  make: () => Promise<DeckStore>;
  cleanup: () => Promise<void>;
}

const tempRoots: string[] = [];

const harnesses: Harness[] = [
  {
    name: 'blob',
    make: async () => new BlobDeckStore(fakeBlobClient(), TEST_DECK_BASE),
    cleanup: async () => {},
  },
  {
    name: 'filesystem',
    make: async () => {
      const root = await mkdtemp(join(tmpdir(), 'deck-store-'));
      tempRoots.push(root);
      return new FilesystemDeckStore(root);
    },
    cleanup: async () => {},
  },
  {
    // The document store keeps a deck as one document per slide rather than one per
    // deck, so it is the implementation most able to drift from the contract: every
    // read reassembles a record from pieces that were written separately. Holding it
    // to the same tests as the other two is the point of them being shared.
    name: 'document',
    make: async () =>
      new DocumentDeckStore(scopedDocuments(new InMemoryDocumentStore(), 'test-org')),
    cleanup: async () => {},
  },
];

after(async () => {
  for (const root of tempRoots) await rm(root, { recursive: true, force: true });
});

for (const harness of harnesses) {
  describe(`the ${harness.name} store`, () => {
    it('seeds itself with the built-in deck on first use', async () => {
      const store = await harness.make();
      const decks = await store.list();
      assert.equal(decks.length, 1);
      assert.equal(decks[0].id, 'isms');
      assert.equal(decks[0].status, 'published');
      assert.equal(decks[0].slideCount, ISMS_DECK.slides.length);
      assert.equal(decks[0].readOnly, false, 'a stored deck is editable, unlike the seeded one');
    });

    it('returns the deck it stored, unchanged', async () => {
      const store = await harness.make();
      const stored = await store.get('isms');
      assert.ok(stored);
      assert.deepEqual(stored.record, ISMS_DECK);
    });

    it('returns undefined for a deck that is not there', async () => {
      const store = await harness.make();
      assert.equal(await store.get('nonexistent'), undefined);
    });

    it('saves a new deck and lists it alongside the first', async () => {
      // Saving before any read, deliberately: seeding used to be skipped whenever
      // the store was non-empty, so an upload as the very first operation lost the
      // built-in deck entirely.
      const store = await harness.make();
      await store.save(otherDeck(), 'draft');

      const decks = await store.list();
      assert.equal(decks.length, 2);
      assert.deepEqual(
        decks.map((deck) => deck.id),
        ['fire-safety', 'isms'],
        'listing is sorted by title',
      );
      assert.equal(decks.find((deck) => deck.id === 'fire-safety')?.status, 'draft');
    });

    it('keeps createdAt when a deck is saved again', async () => {
      const store = await harness.make();
      const first = await store.save(otherDeck(), 'draft');
      const second = await store.save(otherDeck(), 'published');

      assert.equal(second.createdAt, first.createdAt, 'editing a deck reset its creation time');
      assert.equal(second.status, 'published', 'publishing did not take effect');
    });

    it('removes a deck', async () => {
      const store = await harness.make();
      await store.save(otherDeck(), 'draft');
      await store.remove('fire-safety');

      assert.equal(await store.get('fire-safety'), undefined);
      assert.equal((await store.list()).length, 1);
    });

    it('does not re-seed a store whose deck was deliberately deleted', async () => {
      // A persisted marker is what makes this work. An emptiness check cannot: empty
      // is exactly the state a delete leaves behind, so the deck came straight back.
      const store = await harness.make();
      await store.remove('isms');
      assert.deepEqual(await store.list(), []);
      assert.equal(await store.get('isms'), undefined);
    });

    it('refuses an unusable deck id', async () => {
      const store = await harness.make();
      await assert.rejects(() => store.get('../escape'), DeckStoreError);
    });
  });
}

// ===========================================================================
// Store-specific behaviour
// ===========================================================================

describe('the blob store lays keys out as a prefix per deck', () => {
  it('writes deck.json and meta.json under the deck id', async () => {
    const client = fakeBlobClient();
    const store = new BlobDeckStore(client, TEST_DECK_BASE);
    await store.list();

    assert.deepEqual(
      [...client.objects.keys()].sort(),
      // The marker and the index both sit beside the decks rather than inside one,
      // so they survive a deck being deleted, which is the whole point of the marker.
      [
        `${TEST_DECK_BASE}/.seeded`,
        `${TEST_DECK_BASE}/index.json`,
        `${TEST_DECK_BASE}/isms/deck.json`,
        `${TEST_DECK_BASE}/isms/meta.json`,
      ],
    );
  });

  it('only counts a deck as present once deck.json exists', async () => {
    // A half-finished upload should be invisible rather than a broken library entry.
    const client = fakeBlobClient();
    const store = new BlobDeckStore(client, TEST_DECK_BASE);
    await store.list();
    client.objects.delete(`${TEST_DECK_BASE}/isms/deck.json`);

    assert.deepEqual(await store.list(), []);
  });

  it('seeds once, not on every call', async () => {
    const client = fakeBlobClient();
    const store = new BlobDeckStore(client, TEST_DECK_BASE);
    await store.list();
    const afterFirst = client.puts;
    await store.list();
    await store.get('isms');

    assert.equal(client.puts, afterFirst, 'the store re-seeded on a later call');
  });

  it('reports why a corrupt deck cannot be opened', async () => {
    const client = fakeBlobClient();
    const store = new BlobDeckStore(client, TEST_DECK_BASE);
    await store.list();
    client.objects.set(`${TEST_DECK_BASE}/isms/deck.json`, '{"version":1,"record":{"meta":{}}}');

    await assert.rejects(() => store.get('isms'), DeckInvalidError);
  });

  it('keeps the library usable when one deck is corrupt', async () => {
    const client = fakeBlobClient();
    const store = new BlobDeckStore(client, TEST_DECK_BASE);
    await store.list();
    await store.save(otherDeck(), 'published');
    client.objects.set(`${TEST_DECK_BASE}/isms/deck.json`, 'not json at all');

    const decks = await store.list();
    assert.deepEqual(
      decks.map((deck) => deck.id),
      ['fire-safety'],
    );
  });

  it('survives meta.json being unreadable, and reads the deck as a draft', async () => {
    // This asserted `published` until accounts landed, on the reasoning that a deck
    // with content and no metadata is better readable than not. That was right while
    // published was a label on a review screen. It is wrong once published decides
    // who may be taught from a deck, because save() writes deck.json first and
    // meta.json second: a failure between the two would otherwise promote an
    // unreviewed, model-generated deck to published and put it in front of a trainee.
    const client = fakeBlobClient();
    const store = new BlobDeckStore(client, TEST_DECK_BASE);
    await store.list();
    client.objects.set(`${TEST_DECK_BASE}/isms/meta.json`, 'not json');

    const stored = await store.get('isms');
    assert.ok(stored);
    assert.equal(stored.status, 'draft');
    assert.equal(stored.metaMissing, true);
  });

  it('reads a deck whose meta.json is missing entirely as a draft too', async () => {
    const client = fakeBlobClient();
    const store = new BlobDeckStore(client, TEST_DECK_BASE);
    await store.list();
    client.objects.delete(`${TEST_DECK_BASE}/isms/meta.json`);

    const stored = await store.get('isms');
    assert.ok(stored);
    assert.equal(stored.status, 'draft');
    assert.equal(stored.metaMissing, true);
  });
});

describe('the filesystem store', () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'deck-fs-'));
    tempRoots.push(root);
  });

  it('reports why a corrupt deck cannot be opened', async () => {
    const store = new FilesystemDeckStore(root);
    await store.list();
    await writeFile(join(root, 'isms', 'deck.json'), '{"record":{"slides":"nope"}}', 'utf8');

    await assert.rejects(() => store.get('isms'), DeckInvalidError);
  });

  it('reads a deck with unreadable meta.json as a draft, exactly as the blob store does', async () => {
    // These two used to disagree. The blob store caught the JSON parse failure and
    // carried on as published; this one let the error escape get() entirely, so the
    // deck vanished from the library and 404d when opened. One failed open, the other
    // failed closed by accident. Both now go through readStoredMeta.
    const other = await mkdtemp(join(tmpdir(), 'deck-fs-meta-'));
    tempRoots.push(other);
    const store = new FilesystemDeckStore(other);
    await store.list();
    await writeFile(join(other, 'isms', 'meta.json'), 'not json', 'utf8');

    const stored = await store.get('isms');
    assert.ok(stored, 'a corrupt meta.json must not make the deck unreadable');
    assert.equal(stored.status, 'draft');
    assert.equal(stored.metaMissing, true);
  });

  it('ignores a directory that holds no deck', async () => {
    const other = await mkdtemp(join(tmpdir(), 'deck-fs2-'));
    tempRoots.push(other);
    const store = new FilesystemDeckStore(other);
    await store.list();
    await mkdir(join(other, 'stray'), { recursive: true });

    const decks = await store.list();
    assert.deepEqual(
      decks.map((deck) => deck.id),
      ['isms'],
    );
  });

  it('writes readable JSON, so a deck can be inspected by hand', async () => {
    const other = await mkdtemp(join(tmpdir(), 'deck-fs3-'));
    tempRoots.push(other);
    const store = new FilesystemDeckStore(other);
    await store.list();

    const text = await readFile(join(other, 'isms', 'deck.json'), 'utf8');
    assert.ok(text.includes('\n  '), 'the stored deck is not indented');
    assert.ok(parseDeck(text).ok);
  });
});

describe('the seeded store', () => {
  it('presents the built-in deck as read-only', async () => {
    const store = new SeededDeckStore();
    const decks = await store.list();
    assert.equal(decks.length, 1);
    assert.equal(decks[0].readOnly, true);
    assert.equal(store.writable, false);
  });

  it('explains what to configure rather than failing obscurely', async () => {
    // Through the interface, which is how the app uses it.
    const store: DeckStore = new SeededDeckStore();
    await assert.rejects(() => store.save(ISMS_DECK, 'draft'), /BLOB_READ_WRITE_TOKEN/);
  });

  it('gives a stable timestamp, so a listing does not change every request', async () => {
    const first = await new SeededDeckStore().list();
    const second = await new SeededDeckStore().list();
    assert.equal(first[0].updatedAt, second[0].updatedAt);
  });
});

/**
 * Readiness is asked at publish, not at parse.
 *
 * These are the checks that decide whether a deck can be put in front of a trainee,
 * as opposed to whether it is structurally a deck at all. An uploaded deck passes
 * the second and fails the first until it has been analysed.
 */
describe('publish readiness', () => {
  it('passes the hand-authored deck', () => {
    assert.deepEqual(checkReadyToPublish(ISMS_DECK), []);
  });

  it('refuses a deck with no expertise, which could only be read aloud', () => {
    const bare = { ...ISMS_DECK, topics: [] };
    const problems = checkReadyToPublish(bare);
    assert.ok(problems.some((p) => p.includes('no expertise behind it')));
  });

  it('names the specific slide that has nothing to teach from', () => {
    const gap: DeckRecord = {
      ...ISMS_DECK,
      topics: ISMS_DECK.topics.filter((topic) => !topic.slideIds.includes(2)),
    };
    const problems = checkReadyToPublish(gap);
    assert.ok(problems.some((p) => p.includes('slide 2 teaches but has no expertise')));
  });

  it('does not require expertise for a slide that teaches nothing', () => {
    // Slide 1 is a title card, and its single topic is not needed to publish.
    const gap: DeckRecord = {
      ...ISMS_DECK,
      topics: ISMS_DECK.topics.filter((topic) => !topic.slideIds.includes(1)),
    };
    assert.deepEqual(
      checkReadyToPublish(gap).filter((p) => p.includes('slide 1')),
      [],
    );
  });

  it('refuses a deck where nothing teaches', () => {
    const silent: DeckRecord = {
      ...ISMS_DECK,
      slides: ISMS_DECK.slides.map((slide) => ({ ...slide, teaches: false })),
    };
    assert.ok(checkReadyToPublish(silent).some((p) => p.includes('no slide in this deck teaches')));
  });
});

/**
 * A store emptied underneath a running process has to recover on its own.
 *
 * The seeded flag is a cache of "the marker was there", and treating it as proof that
 * the decks still are cost three measurement runs in one afternoon: every request
 * reported "No such deck" until the server was restarted, with nothing to say why.
 * The same would happen to anyone who cleared blob storage on a live deployment.
 *
 * The distinction that has to survive: a deliberate delete leaves the marker in place
 * and must stay deleted, while a wipe takes the marker too and should re-seed.
 */
describe('recovering from a store emptied underneath the process', () => {
  it('re-seeds when everything including the marker has gone', async () => {
    const client = fakeBlobClient();
    const store = new BlobDeckStore(client, TEST_DECK_BASE);
    await store.list();
    assert.ok(await store.get('isms'));

    // A wipe, not a delete: the marker goes too.
    client.objects.clear();

    const recovered = await store.get('isms');
    assert.ok(recovered, 'an emptied store did not heal itself');
    assert.equal(recovered.record.meta.id, 'isms');
  });

  it('still leaves a deliberately deleted deck deleted', async () => {
    // remove() leaves the marker, so this must not come back.
    const client = fakeBlobClient();
    const store = new BlobDeckStore(client, TEST_DECK_BASE);
    await store.list();
    await store.remove('isms');

    assert.equal(await store.get('isms'), undefined);
    assert.deepEqual(await store.list(), []);
  });

  it('does the same on the filesystem', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deck-wipe-'));
    tempRoots.push(root);
    const store = new FilesystemDeckStore(root);
    await store.list();
    assert.ok(await store.get('isms'));

    await rm(root, { recursive: true, force: true });

    const recovered = await store.get('isms');
    assert.ok(recovered, 'an emptied filesystem store did not heal itself');
  });
});

/**
 * What actually made the deployed app feel slow.
 *
 * Every read used to be addressed by URL, and the only way to learn a URL was to
 * list the prefix first, so a single deck cost a listing plus two reads and the
 * library did that once per deck, sequentially. Nothing was wrong with the results,
 * which is why every other test passed while the front page took three seconds.
 */
describe('what a blob read costs in round trips', () => {
  it('reads a deck without listing anything', async () => {
    const client = fakeBlobClient();
    const store = new BlobDeckStore(client, TEST_DECK_BASE);
    await store.save(ISMS_DECK, 'published');

    client.lists = 0;
    await store.get(ISMS_DECK.meta.id);
    assert.equal(client.lists, 0);
  });

  it('does not ask the API for the library at all once the index exists', async () => {
    const client = fakeBlobClient();
    const store = new BlobDeckStore(client, TEST_DECK_BASE);
    for (const id of ['alpha', 'beta', 'gamma', 'delta']) {
      await store.save({ ...ISMS_DECK, meta: { ...ISMS_DECK.meta, id } }, 'published');
    }

    client.lists = 0;
    const listed = await store.list();
    assert.ok(listed.length >= 4);

    // Zero, not one per deck and not one overall. Listing a prefix is a control-plane
    // call that does not run in the store's region, and it was the entire remaining
    // cost of the front page.
    assert.equal(client.lists, 0);
  });

  it('does not re-read the seed marker on every call', async () => {
    // The marker check is cached per process. Without that, each request paid for it
    // again before doing any of its own work.
    const client = fakeBlobClient();
    const store = new BlobDeckStore(client, TEST_DECK_BASE);
    await store.list();

    const before = client.reads;
    await store.list();
    await store.list();

    // Two listings of a one-deck library: the index, then deck.json and meta.json,
    // each time. Six. Re-reading the seed marker would make it eight.
    assert.equal(client.reads - before, 6);
  });

  it('falls back to the API when the index is missing, and writes it back', async () => {
    const client = fakeBlobClient();
    const store = new BlobDeckStore(client, TEST_DECK_BASE);
    await store.save(ISMS_DECK, 'published');
    client.objects.delete(`${TEST_DECK_BASE}/index.json`);

    client.lists = 0;
    const listed = await store.list();

    assert.equal(listed.length, 1);
    assert.equal(client.lists, 1, 'should have asked the API once');
    assert.ok(client.objects.has(`${TEST_DECK_BASE}/index.json`), 'should have rebuilt the index');
  });

  it('falls back to the API when the index is not readable as JSON', async () => {
    const client = fakeBlobClient();
    const store = new BlobDeckStore(client, TEST_DECK_BASE);
    await store.save(ISMS_DECK, 'published');
    client.objects.set(`${TEST_DECK_BASE}/index.json`, 'not json at all');

    const listed = await store.list();
    assert.equal(listed.length, 1);
  });

  it('drops a deleted deck from the index', async () => {
    const client = fakeBlobClient();
    const store = new BlobDeckStore(client, TEST_DECK_BASE);
    await store.save({ ...ISMS_DECK, meta: { ...ISMS_DECK.meta, id: 'temp' } }, 'published');
    await store.remove('temp');

    const index = JSON.parse(client.objects.get(`${TEST_DECK_BASE}/index.json`) ?? '{}') as {
      ids: string[];
    };
    assert.ok(!index.ids.includes('temp'));
  });
});
