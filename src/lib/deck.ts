/**
 * Working with a deck.
 *
 * Everything here takes the deck as an argument. It used to close over a single
 * compiled-in deck, which is why `TOTAL_SLIDES` could be a module constant and
 * `clampSlideId` could know the slide count without being told. Neither is true
 * once a trainer uploads their own.
 *
 * This file is safe on both sides of the wire. It holds no deck content and no
 * server dependencies, so the browser can call `clampSlideId` on the projection it
 * has without dragging the knowledge base in behind it.
 */

import type { ClientSlide, DeckClientView, DeckRecord, DeckSlide } from './deck-types';

export type { ClientSlide, DeckClientView, DeckMeta, DeckRecord, DeckSlide } from './deck-types';

/** Anything with numbered slides. Lets one helper serve the deck and its projection. */
interface SlideSet {
  slides: Array<{ id: number }>;
}

export function totalSlides(deck: SlideSet): number {
  return deck.slides.length;
}

export function getSlide(deck: DeckRecord, id: number): DeckSlide | undefined {
  return deck.slides.find((slide) => slide.id === id);
}

export function getClientSlide(deck: DeckClientView, id: number): ClientSlide | undefined {
  return deck.slides.find((slide) => slide.id === id);
}

/**
 * Clamps an arbitrary number to a valid slide id.
 *
 * Slide ids are 1-based and contiguous today. They are read off the deck rather
 * than assumed, so a deck whose first slide is not 1 still clamps into range.
 */
export function clampSlideId(deck: SlideSet, id: number): number {
  const ids = deck.slides.map((slide) => slide.id);
  const lowest = ids.length > 0 ? Math.min(...ids) : 1;
  const highest = ids.length > 0 ? Math.max(...ids) : 1;
  if (!Number.isFinite(id)) return lowest;
  return Math.min(Math.max(Math.round(id), lowest), highest);
}

/** The first slide of the deck, which is where a session starts. */
export function firstSlideId(deck: SlideSet): number {
  return deck.slides.length > 0 ? Math.min(...deck.slides.map((s) => s.id)) : 1;
}

/** The last slide, which is where the trainer closes the session. */
export function lastSlideId(deck: SlideSet): number {
  return deck.slides.length > 0 ? Math.max(...deck.slides.map((s) => s.id)) : 1;
}

/** Estimated full run time of the narration, in minutes. */
export function estimatedMinutes(deck: DeckRecord): number {
  return Math.round(deck.slides.reduce((total, slide) => total + slide.targetSeconds, 0) / 60);
}

/**
 * Narrows a deck to what the browser is allowed to have.
 *
 * This is the whole reason the two shapes exist. Listing the kept fields
 * explicitly, rather than deleting the unwanted ones, means a field added to
 * `DeckSlide` later is excluded by default instead of quietly shipping to the
 * trainee. Presenter notes and author-only notes must never cross this line.
 */
export function toClientView(deck: DeckRecord): DeckClientView {
  return {
    meta: deck.meta,
    slides: deck.slides.map((slide) => ({
      id: slide.id,
      title: slide.title,
      shortLabel: slide.shortLabel,
      summary: slide.summary,
      image: slide.image,
    })),
    totalSlides: deck.slides.length,
    estimatedMinutes: estimatedMinutes(deck),
  };
}
