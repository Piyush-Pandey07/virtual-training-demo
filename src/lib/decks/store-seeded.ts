/**
 * The decks compiled into the build.
 *
 * This is the fallback when nothing is configured, and it is why the deployed demo
 * keeps working without a storage token. It is also the seed: the filesystem and
 * blob stores copy these in the first time they are used, so a fresh deployment has
 * something to present rather than an empty library.
 *
 * Read-only on purpose. Editing a deck that lives in the build would be lost on the
 * next deploy, which is a worse outcome than refusing.
 */

import 'server-only';

import { ISMS_DECK } from './isms';
import {
  DeckStoreError,
  summarise,
  type DeckStatus,
  type DeckStore,
  type DeckSummary,
  type StoredDeck,
} from './store';

/**
 * A fixed timestamp, because a compiled-in deck has no meaningful creation time and
 * `new Date()` here would make every listing change on every request.
 */
const SEEDED_AT = '2025-01-01T00:00:00.000Z';

const SEEDED: StoredDeck[] = [
  {
    record: ISMS_DECK,
    status: 'published',
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    readOnly: true,
    metaMissing: false,
  },
];

export class SeededDeckStore implements DeckStore {
  readonly kind = 'seeded' as const;
  readonly writable = false;

  async list(): Promise<DeckSummary[]> {
    return SEEDED.map(summarise);
  }

  async get(id: string): Promise<StoredDeck | undefined> {
    return SEEDED.find((entry) => entry.record.meta.id === id);
  }

  async save(): Promise<DeckSummary> {
    throw new DeckStoreError(
      'This deployment has no deck storage configured, so decks cannot be saved. Set BLOB_READ_WRITE_TOKEN to enable uploads.',
    );
  }

  async remove(): Promise<void> {
    throw new DeckStoreError('The built-in deck cannot be removed.');
  }
}

/** The decks a fresh store starts with. */
export function seedDecks(): Array<{ record: StoredDeck['record']; status: DeckStatus }> {
  return SEEDED.map((entry) => ({ record: entry.record, status: entry.status }));
}
