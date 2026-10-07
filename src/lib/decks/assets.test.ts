import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deckPrefix } from '../orgs/scope';
import { BlobAssetStore, pageAssetName, type BinaryBlobClient } from './assets';

/**
 * The blob tier for slide images, against a stand-in for blob storage.
 *
 * Written after the production check of 7 October found that deleting a deck left its
 * slide images behind. `put` and `get` used the customer's prefix and `removeAll` did
 * not, so it listed a folder nothing was ever written to and deleted nothing, while the
 * delete reported success. Nothing tested this tier at all, which is how it survived the
 * move to one prefix per customer.
 */

/** Blob storage as a map from pathname to bytes, with the SDK's prefix listing. */
function memoryBlobs(): BinaryBlobClient & { paths: () => string[] } {
  const stored = new Map<string, Uint8Array>();
  const url = (pathname: string) => `https://blob.invalid/${pathname}`;
  return {
    async put(pathname, bytes) {
      stored.set(pathname, bytes);
      return { url: url(pathname) };
    },
    async list(prefix) {
      return [...stored.keys()]
        .filter((pathname) => pathname.startsWith(prefix))
        .map((pathname) => ({ pathname, url: url(pathname) }));
    },
    async remove(urls) {
      for (const each of urls) stored.delete(each.replace('https://blob.invalid/', ''));
    },
    async readBytes(key) {
      return stored.get(key.replace('https://blob.invalid/', '')) ?? null;
    },
    paths: () => [...stored.keys()].sort(),
  };
}

const PNG = new Uint8Array([1, 2, 3]);

describe('slide images in blob storage', () => {
  const base = deckPrefix('acme');

  it('reads back what it wrote, under the customer prefix', async () => {
    const blobs = memoryBlobs();
    const store = new BlobAssetStore(blobs, base);
    await store.put('deck-a-abc123', pageAssetName(1, 'full'), PNG, 'image/webp');
    assert.deepEqual(blobs.paths(), ['orgs/acme/decks/deck-a-abc123/pages/1.webp']);
    assert.deepEqual((await store.get('deck-a-abc123', pageAssetName(1, 'full')))?.bytes, PNG);
  });

  it("removes every image of the deck being deleted, and nobody else's", async () => {
    const blobs = memoryBlobs();
    const store = new BlobAssetStore(blobs, base);
    for (const page of [1, 2]) {
      await store.put('deck-a-abc123', pageAssetName(page, 'full'), PNG, 'image/webp');
      await store.put('deck-a-abc123', pageAssetName(page, 'thumb'), PNG, 'image/webp');
    }
    // A deck whose id starts the same way, another customer's deck with the same id,
    // and the deck's own record, which a blob deck store keeps in the same folder and
    // removes separately.
    await store.put('deck-a-abc1234', pageAssetName(1, 'full'), PNG, 'image/webp');
    await new BlobAssetStore(blobs, deckPrefix('other')).put(
      'deck-a-abc123',
      pageAssetName(1, 'full'),
      PNG,
      'image/webp',
    );
    await blobs.put(`${base}/deck-a-abc123/deck.json`, PNG, 'application/json');

    await store.removeAll('deck-a-abc123');

    assert.deepEqual(blobs.paths(), [
      'orgs/acme/decks/deck-a-abc123/deck.json',
      'orgs/acme/decks/deck-a-abc1234/pages/1.webp',
      'orgs/other/decks/deck-a-abc123/pages/1.webp',
    ]);
    assert.equal(await store.get('deck-a-abc123', pageAssetName(1, 'thumb')), undefined);
  });

  it('is a no-op for a deck with no images', async () => {
    const blobs = memoryBlobs();
    await new BlobAssetStore(blobs, base).removeAll('deck-b-xyz789');
    assert.deepEqual(blobs.paths(), []);
  });
});
