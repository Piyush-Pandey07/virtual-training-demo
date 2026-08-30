/**
 * Showing the analysis what a slide actually looks like.
 *
 * Every pass used to attach a thumbnail only when a page carried fewer than a dozen
 * words, on the reasoning that text which speaks for itself does not need a picture
 * and attaching every one of them multiplies the cost of reading a deck. That was a
 * cost decision, and it was the wrong shape of compromise: what it actually decided
 * was that a diagram with a fifteen-word caption gets analysed from the caption.
 *
 * Decks are mostly pictures. An architecture diagram, a process flow, a comparison
 * table, a screenshot with two labels — every one of those is a slide whose meaning
 * is in the image, and every one of them cleared the threshold and was analysed
 * blind. The trainer then taught from the caption, and nobody could see why it was
 * thin, because the text it had really was all it was given.
 *
 * So the default is now to send every page, at the resolution the trainee sees.
 * `ANALYSIS_IMAGES=sparse` restores the old behaviour for a deployment that is
 * paying per token and would rather have the cheaper deck.
 */

import 'server-only';

import type { Part } from '@google/genai';

import type { DeckRecord, DeckSlide } from '../deck-types';
import { pageAssetName } from '../decks/asset-paths';
import { assetStore } from '../decks/registry';

/** Below this many words, a page's text does not say what the page is. */
const WORDS_BEFORE_IMAGE_HELPS = 12;

function wordsOn(slide: DeckSlide): number {
  return slide.bullets.reduce((total, line) => total + line.split(/\s+/).filter(Boolean).length, 0);
}

/** Every page, or only the ones whose text says nothing. Every page by default. */
function everyPage(): boolean {
  return (process.env.ANALYSIS_IMAGES ?? 'all').trim().toLowerCase() !== 'sparse';
}

/**
 * Which render to send.
 *
 * The full one by default. The thumbnail is 768 across, which is one image tile and
 * enough to recognise a page; it is not enough to read the axis labels on a chart or
 * the small print in a table, which is exactly the content that has no text to fall
 * back on. `ANALYSIS_IMAGE_SIZE=thumb` takes the cheaper one.
 */
function assetName(slideId: number): string {
  const size = (process.env.ANALYSIS_IMAGE_SIZE ?? 'full').trim().toLowerCase();
  return pageAssetName(slideId, size === 'thumb' ? 'thumb' : 'full');
}

/**
 * The image parts for a batch of pages, in page order.
 *
 * Each is labelled with its page number, because a model handed several pictures and
 * several page numbers will otherwise pair them up by guessing.
 */
export async function slideImageParts(deck: DeckRecord, pages: DeckSlide[]): Promise<Part[]> {
  const store = assetStore();
  const parts: Part[] = [];
  const all = everyPage();

  for (const slide of pages) {
    if (!all && wordsOn(slide) >= WORDS_BEFORE_IMAGE_HELPS) continue;

    const asset = await store.get(deck.meta.id, assetName(slide.id)).catch(() => null);
    if (!asset) continue;

    parts.push({ text: `Image of page ${slide.id}:` });
    parts.push({
      inlineData: {
        mimeType: asset.contentType,
        data: Buffer.from(asset.bytes).toString('base64'),
      },
    });
  }

  return parts;
}

/**
 * What to tell the model about the pictures it has been given.
 *
 * Worth saying explicitly. Handed a page's text and a picture of the same page, a
 * model tends to work from the text and treat the image as decoration, which
 * reproduces the blindness this was meant to remove.
 */
export const IMAGE_INSTRUCTION = `You have been given a picture of each page as well as the text printed on it.

Read the pictures. The text extracted from a page is only the text: a diagram, a chart, a table, a screenshot or a photograph carries meaning that is not in it, and on many pages that is where the meaning is. Where the two disagree, the picture is what the trainee will be looking at.

Describe what is actually shown rather than what a page with that heading usually contains. A flow with four boxes has four steps, and you can see what they say.`;
