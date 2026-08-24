/**
 * Where a deck's page renders live, as strings.
 *
 * Separate from assets.ts because both sides need these. The upload page builds the
 * URL it uploads to, and the server builds the URL it writes into a slide's
 * `image`; if the two ever disagreed, every slide in an uploaded deck would show a
 * broken image and nothing would say why.
 *
 * Pure string arithmetic, no imports, no `server-only`. That is the whole point:
 * assets.ts reads and writes storage and must never reach a browser, and a client
 * component that imported it for one path helper would fail the build.
 */

/** The stored name of a page render. */
export function pageAssetName(pageNumber: number, variant: 'full' | 'thumb'): string {
  return variant === 'thumb' ? `pages/${pageNumber}.thumb.webp` : `pages/${pageNumber}.webp`;
}

/**
 * The URL the browser uses for a page.
 *
 * An app route rather than a storage URL, deliberately. It means the deck record
 * reads the same whichever store wrote it, blob URLs never reach the browser, and
 * moving a deck between stores does not rewrite every slide's `image`.
 */
export function pageAssetUrl(
  deckId: string,
  pageNumber: number,
  variant: 'full' | 'thumb',
): string {
  return `/api/decks/${encodeURIComponent(deckId)}/assets/${pageAssetName(pageNumber, variant)}`;
}
