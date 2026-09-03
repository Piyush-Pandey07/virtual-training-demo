import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ISMS_DECK } from './isms';
import { scopedDocuments } from '../orgs/scope';
import { InMemoryDocumentStore } from '../roster/documents';
import { DocumentDeckStore } from './store-documents';
import type { DeckRecord } from '../deck-types';

/**
 * Two people saving the same deck at the same moment.
 *
 * The obvious way to replace a deck's slides is to delete the old ones and write the
 * new ones. It is correct alone and wrong together: both saves clear, both write, and
 * the collection ends up holding some slides from each. The deck document then counts
 * a number that does not match what is actually there, and reading the deck produces a
 * blend of two people's work with no error anywhere.
 *
 * Generations fix it by never deleting on the way in. Each save writes a complete set
 * under its own name and then points the deck at it with one document write, so a
 * reader sees one whole set or the other and never a mixture.
 */

/** A deck of a given size, so two saves can be told apart by what they contain. */
function deckOf(slideCount: number, marker: string): DeckRecord {
  const slides = Array.from({ length: slideCount }, (_, index) => ({
    ...ISMS_DECK.slides[0]!,
    id: index + 1,
    title: `${marker} ${index + 1}`,
  }));

  return {
    meta: { ...ISMS_DECK.meta, id: 'contested' },
    slides,
    topics: ISMS_DECK.topics.slice(0, slideCount).map((topic) => ({
      ...topic,
      title: `${marker} ${topic.title}`,
      slideIds: [1],
    })),
  };
}

function store() {
  return new DocumentDeckStore(scopedDocuments(new InMemoryDocumentStore(), 'test-org'));
}

describe('decks written before generations existed', () => {
  it('still read, and take the new shape when saved', async () => {
    // Parts used to hold their content under `slide` and `topic` rather than a common
    // `value`. Changing that silently broke every deck already in the database: the
    // read found no content, and the deck failed validation with "slides[0] must be an
    // object" rather than anything resembling the cause.
    const documents = new InMemoryDocumentStore();
    const scoped = scopedDocuments(documents, 'test-org');

    // Written by hand in the old shape: no generation anywhere, content under its own
    // field name, addressed by a bare ordinal.
    await scoped.set('decks', 'legacy', {
      id: 'legacy',
      status: 'published',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      meta: ISMS_DECK.meta,
      slideCount: ISMS_DECK.slides.length,
      totalSeconds: ISMS_DECK.slides.reduce((n, slide) => n + slide.targetSeconds, 0),
    });
    for (const slide of ISMS_DECK.slides) {
      await scoped.set('decks/legacy/slides', String(slide.id).padStart(4, '0'), {
        id: slide.id,
        slide,
      });
    }
    for (const [index, topic] of ISMS_DECK.topics.entries()) {
      await scoped.set('decks/legacy/topics', String(index).padStart(4, '0'), {
        id: index,
        topic,
      });
    }

    const decks = new DocumentDeckStore(scoped);
    const before = await decks.get('legacy');
    assert.ok(before, 'a deck written in the old shape became unreadable');
    assert.equal(before.record.slides.length, ISMS_DECK.slides.length);
    assert.equal(before.record.topics.length, ISMS_DECK.topics.length);

    // And saving it moves it forward without losing anything.
    await decks.save(before.record, before.status);
    const after = await decks.get('legacy');
    assert.equal(after!.record.slides.length, ISMS_DECK.slides.length);
    assert.equal(after!.record.topics.length, ISMS_DECK.topics.length);
  });
});

describe('two saves of one deck at the same time', () => {
  it('leaves the deck as exactly one of them, never a blend', async () => {
    const decks = store();
    await decks.list();

    const wide = deckOf(9, 'wide');
    const narrow = deckOf(4, 'narrow');

    // Started together and awaited together, which is the only way to interleave the
    // reads and writes inside each.
    await Promise.all([decks.save(wide, 'draft'), decks.save(narrow, 'draft')]);

    const stored = await decks.get('contested');
    assert.ok(stored, 'the deck vanished');

    const titles = stored.record.slides.map((slide) => slide.title);
    const markers = new Set(titles.map((title) => title.split(' ')[0]));

    assert.equal(
      markers.size,
      1,
      `the deck holds slides from both saves: ${[...markers].join(' and ')}`,
    );

    const winner = [...markers][0];
    assert.equal(
      stored.record.slides.length,
      winner === 'wide' ? 9 : 4,
      'the deck has a different number of slides than the save that won wrote',
    );
  });

  it('counts in the deck what is actually stored under it', async () => {
    // The count lives on the deck document and the slides live beside it. A save that
    // half-replaced the slides would leave the two disagreeing, and the library would
    // report a length no screen could show.
    const decks = store();
    await decks.list();

    await Promise.all([
      decks.save(deckOf(9, 'wide'), 'draft'),
      decks.save(deckOf(4, 'narrow'), 'draft'),
      decks.save(deckOf(6, 'middle'), 'draft'),
    ]);

    const listed = (await decks.list()).find((deck) => deck.id === 'contested');
    const stored = await decks.get('contested');

    assert.ok(listed && stored);
    assert.equal(
      listed.slideCount,
      stored.record.slides.length,
      'the listing counts a different number of slides than the deck holds',
    );
  });

  it('serves a complete deck throughout a save', async () => {
    // Nothing may point at a half-written set. A reader arriving mid-save sees the
    // previous deck whole, which is the property that lets this work without a
    // transaction.
    const decks = store();
    await decks.list();
    await decks.save(deckOf(9, 'wide'), 'published');

    const saving = decks.save(deckOf(4, 'narrow'), 'published');
    const during = await decks.get('contested');
    await saving;

    assert.ok(during, 'the deck was unreadable while being saved');
    assert.ok(
      during.record.slides.length === 9 || during.record.slides.length === 4,
      `read a partial deck of ${during.record.slides.length} slides`,
    );
    assert.equal(
      new Set(during.record.slides.map((slide) => slide.title.split(' ')[0])).size,
      1,
      'a read during a save returned slides from two different saves',
    );
  });

  it('does not leave the losing save behind', async () => {
    // Parts nobody points at cost storage and confuse anybody reading the database. The
    // winner sweeps them, after the switchover rather than before.
    const decks = store();
    await decks.list();

    await Promise.all([
      decks.save(deckOf(9, 'wide'), 'draft'),
      decks.save(deckOf(4, 'narrow'), 'draft'),
    ]);

    const stored = await decks.get('contested');
    const kept = stored!.record.slides.length;

    // Saving once more settles anything the concurrent pair left, then the collection
    // should hold that one generation and nothing else.
    await decks.save(deckOf(kept, 'final'), 'draft');

    const after = await decks.get('contested');
    assert.equal(after!.record.slides.length, kept);
    assert.ok(after!.record.slides.every((slide) => slide.title.startsWith('final')));
  });
});
