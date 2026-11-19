import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DeckRecord } from '../deck-types';
import { InMemoryDocumentStore } from '../roster/documents';
import { ISMS_DECK } from './isms';
import { parseDeck, serialiseDeck } from './serialise';
import { DocumentDeckStore } from './store-documents';

/**
 * What an administrator sets on the deck page has to come back out of the store.
 *
 * Every read of a stored deck is passed through `parseDeck`, which builds the meta from
 * a fixed list of fields. Course information, case studies and the completion point
 * were not on that list, so each was saved and then dropped on the way back: the page
 * said "Saved.", the audit history said "Edited", and a reload showed the old values
 * (UAT dry run of 18 November, D-01). The trainer never saw them either.
 */

const edited = (): DeckRecord => ({
  ...ISMS_DECK,
  meta: {
    ...ISMS_DECK.meta,
    id: 'meta-roundtrip-deck',
    origin: 'uploaded',
    topicInfo: 'For new joiners in operations. They should leave able to report an incident.',
    caseStudies: 'A colocation provider lost a hall to a failed chiller changeover.',
    completionPercent: 75,
  },
});

describe('what the deck page saves', () => {
  it('survives being written out and read back', () => {
    const parsed = parseDeck(serialiseDeck(edited()));
    assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('; '));
    assert.equal(parsed.record.meta.topicInfo, edited().meta.topicInfo);
    assert.equal(parsed.record.meta.caseStudies, edited().meta.caseStudies);
    assert.equal(parsed.record.meta.completionPercent, 75);
  });

  it('comes back from the document store, which is what the live site reads', async () => {
    const decks = new DocumentDeckStore(new InMemoryDocumentStore());
    await decks.save(edited(), 'published');

    const stored = await decks.get('meta-roundtrip-deck');
    assert.equal(stored?.record.meta.topicInfo, edited().meta.topicInfo);
    assert.equal(stored?.record.meta.caseStudies, edited().meta.caseStudies);
    assert.equal(stored?.record.meta.completionPercent, 75);
  });

  it('is kept by a later save of something else', async () => {
    const decks = new DocumentDeckStore(new InMemoryDocumentStore());
    await decks.save(edited(), 'draft');

    // A second save starts from what was read, as the edit route does. While the read
    // dropped these fields, the next save of anything at all wiped them for good.
    const read = await decks.get('meta-roundtrip-deck');
    assert.ok(read);
    await decks.save({ ...read.record, meta: { ...read.record.meta, title: 'Renamed' } }, 'draft');

    const after = await decks.get('meta-roundtrip-deck');
    assert.equal(after?.record.meta.title, 'Renamed');
    assert.equal(after?.record.meta.caseStudies, edited().meta.caseStudies);
    assert.equal(after?.record.meta.completionPercent, 75);
  });

  it('stays absent on a deck that never set them', () => {
    const parsed = parseDeck(serialiseDeck(ISMS_DECK));
    assert.ok(parsed.ok);
    assert.equal('topicInfo' in parsed.record.meta, false);
    assert.equal('caseStudies' in parsed.record.meta, false);
    assert.equal('completionPercent' in parsed.record.meta, false);
  });

  it('refuses a completion point outside 50 to 100, or one that is not a whole number', () => {
    for (const bad of [49, 101, 72.5, '80']) {
      const record = { ...edited(), meta: { ...edited().meta, completionPercent: bad } };
      const parsed = parseDeck(serialiseDeck(record as unknown as DeckRecord));
      assert.equal(parsed.ok, false, `${String(bad)} should be refused`);
    }
  });

  it('keeps every field of the meta type, so the next one added is not lost the same way', () => {
    // Every key a deck's meta can carry, set to something valid. A field added to
    // DeckMeta and to the edit route but not to parseMeta fails here, not in UAT.
    const full: Required<DeckRecord['meta']> = {
      ...edited().meta,
      origin: 'uploaded',
      topicInfo: 'About the course.',
      caseStudies: 'A case study.',
      completionPercent: 80,
      outlineAnalysedAt: '2026-11-18T10:00:00.000Z',
      outlinePromptVersion: 1,
    };
    const parsed = parseDeck(serialiseDeck({ ...edited(), meta: full }));
    assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('; '));
    assert.deepEqual(
      Object.keys(parsed.record.meta).sort(),
      Object.keys(full).sort(),
      'parseMeta dropped a field the meta type carries',
    );
  });
});
