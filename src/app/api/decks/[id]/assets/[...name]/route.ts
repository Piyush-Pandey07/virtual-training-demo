/**
 * GET and PUT /api/decks/{id}/assets/{name}
 *
 * Slide renders, in and out. Going through the app rather than exposing storage
 * URLs means the deck record reads identically whichever store wrote it, blob URLs
 * never reach the browser, and moving a deck between stores does not rewrite every
 * slide's `image`.
 *
 * One page per request. A single webp is a couple of hundred kilobytes, comfortably
 * inside the platform's 4.5 MB body limit, and one request per page gives the
 * upload page something honest to report progress against.
 */

import { createHash } from 'node:crypto';

import { assertUsableAssetName, contentTypeFor } from '@/lib/decks/assets';
import { assetStore, deckStore } from '@/lib/decks/registry';
import { DeckStoreError } from '@/lib/decks/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** A rendered page. Well clear of the platform's 4.5 MB request cap. */
const MAX_ASSET_BYTES = 4 * 1024 * 1024;

const ALLOWED_TYPES = new Set(['image/webp', 'image/png', 'image/jpeg']);

interface RouteContext {
  params: Promise<{ id: string; name: string[] }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  const { id, name } = await params;
  const assetName = name.join('/');

  try {
    assertUsableAssetName(assetName);
  } catch {
    return Response.json({ error: 'Not a usable asset name.' }, { status: 400 });
  }

  let asset;
  try {
    asset = await assetStore().get(id, assetName);
  } catch (error) {
    if (error instanceof DeckStoreError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  if (!asset) return new Response('Not found', { status: 404 });

  // A strong ETag from the bytes, so revisiting a slide gets a 304 rather than the
  // image again. A 60-page deck is several megabytes of renders and the trainee
  // moves back and forth through it constantly.
  const digest = createHash('sha256').update(asset.bytes).digest('base64url').slice(0, 27);
  const etag = '"' + digest + '"';

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(asset.bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': asset.contentType,
      'Content-Length': String(asset.bytes.byteLength),
      ETag: etag,
      // Revalidate every time, and let the ETag make that cheap.
      //
      // This used to be `private, max-age=300, stale-while-revalidate=86400`, on the
      // reasoning that a deck is several megabytes of renders and a trainee moves
      // back and forth constantly. The reasoning was right about the cost and wrong
      // about `private`, which excludes shared caches but not the browser's own disk
      // cache, which is keyed on the URL alone. On a shared machine — the normal case
      // for company training — the next person to sign in and open the same URL would
      // be served from disk, and the request would never reach the server, so no
      // access check could run.
      //
      // The strong ETag above means revalidating costs a 304 rather than the image,
      // so almost all of the saving survives.
      'Cache-Control': 'private, no-cache, must-revalidate',
    },
  });
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { id, name } = await params;
  const assetName = name.join('/');

  const store = assetStore();
  if (!store.writable) {
    return Response.json(
      {
        error:
          'This deployment has no deck storage configured, so slide images cannot be uploaded. Set BLOB_READ_WRITE_TOKEN to enable them.',
      },
      { status: 503 },
    );
  }

  // The deck has to exist first. Otherwise a stray request could scatter images
  // under an id nobody owns, and nothing would ever clean them up.
  const deck = await deckStore()
    .get(id)
    .catch(() => undefined);
  if (!deck) return Response.json({ error: 'No such deck.' }, { status: 404 });

  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!ALLOWED_TYPES.has(contentType)) {
    return Response.json({ error: 'Send an image.' }, { status: 415 });
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0) return Response.json({ error: 'Empty body.' }, { status: 400 });
  if (body.byteLength > MAX_ASSET_BYTES) {
    return Response.json({ error: 'That page render is too large.' }, { status: 413 });
  }

  try {
    assertUsableAssetName(assetName);
    await store.put(id, assetName, body, contentTypeFor(assetName));
  } catch (error) {
    if (error instanceof DeckStoreError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  return Response.json({ stored: assetName, bytes: body.byteLength }, { status: 201 });
}
