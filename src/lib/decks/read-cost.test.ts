import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryDocumentStore } from '../roster/documents';
import { ISMS_DECK } from './isms';
import { DocumentDeckStore } from './store-documents';

/**
 * What loading a deck costs in database reads.
 *
 * Every chat turn loads its deck. Reading every slide and topic each time used up the
 * project's daily read allowance in a day of testing, and Firestore then refused
 * everybody's sign-in. A deck's slides and topics only change when it is saved, under a
 * new generation, so they are read once per generation.
 */

class CountingStore extends InMemoryDocumentStore {
  reads = 0;
  override async get<T>(collection: string, id: string): Promise<T | undefined> {
    this.reads += 1;
    return super.get<T>(collection, id);
  }
  override async all<T>(collection: string): Promise<T[]> {
    const found = await super.all<T>(collection);
    this.reads += Math.max(1, found.length);
    return found;
  }
}

const deck = (title: string) => ({
  ...ISMS_DECK,
  meta: { ...ISMS_DECK.meta, id: 'read-cost-deck', title, origin: 'uploaded' as const },
});

describe('loading a deck', () => {
  it('reads its slides and topics once, then only the deck document', async () => {
    const store = new CountingStore();
    const decks = new DocumentDeckStore(store);
    await decks.save(deck('First'), 'published');

    await decks.get('read-cost-deck');
    const before = store.reads;
    const again = await decks.get('read-cost-deck');
    assert.equal(store.reads - before, 1, 'only the deck document is read the second time');
    assert.equal(again?.record.slides.length, ISMS_DECK.slides.length);
  });

  it('sees a save at once, since a save writes a new generation', async () => {
    const store = new CountingStore();
    const decks = new DocumentDeckStore(store);
    await decks.save(deck('First'), 'published');
    await decks.get('read-cost-deck');

    const edited = deck('Second');
    edited.slides = edited.slides.map((slide, index) =>
      index === 0 ? { ...slide, title: 'Changed slide' } : slide,
    );
    await decks.save(edited, 'published');
    const after = await decks.get('read-cost-deck');
    assert.equal(after?.record.meta.title, 'Second');
    assert.equal(after?.record.slides[0]?.title, 'Changed slide');
  });
});
