'use client';

import Image from 'next/image';

import { useDeck } from '@/lib/deck-context';
import type { ClientSlide } from '@/lib/deck-types';

/**
 * The slide currently on screen.
 *
 * Slides are rendered images of the approved deck rather than a rebuild in HTML, so
 * what the trainee sees is exactly what the deck shows, down to the layout.
 *
 * The slide either side of the current one is mounted too, and the change is a
 * cross-fade rather than a swap of one image's source. Keying a single image on the
 * slide id unmounted and remounted it on every change, which restarted the loader
 * and showed a blank frame between slides. It was most obvious going backwards,
 * where the trainee expects an instant cut to something they have already seen.
 *
 * It used to mount every slide in the deck, which was justified on this deck being
 * seven slides and 600 kB. An uploaded deck can be sixty pages and nine megabytes,
 * and eagerly fetching all of it before the trainer finishes the first sentence is
 * not a trade worth making. A window of one either side keeps the cross-fade in the
 * cases it exists for, Next and Previous, at a fixed cost.
 */

/** Slides kept mounted either side of the current one. */
const WINDOW = 1;

/** 16:9, which is what a PowerPoint export is. Only used when a deck predates sizes. */
const DEFAULT_ASPECT = 16 / 9;

function aspectOf(slide: ClientSlide): number {
  return slide.width && slide.height ? slide.width / slide.height : DEFAULT_ASPECT;
}

export function SlideStage({ slide, dimmed }: { slide: ClientSlide; dimmed: boolean }) {
  const deck = useDeck();

  const index = deck.slides.findIndex((candidate) => candidate.id === slide.id);
  const nearby = deck.slides.filter(
    (_, candidateIndex) => Math.abs(candidateIndex - index) <= WINDOW,
  );

  return (
    <figure className="border-charcoal-line relative w-full overflow-hidden rounded-xl border bg-white shadow-lg shadow-black/30">
      {/*
        Sized to the page rather than assumed. An uploaded deck is as likely to be A4
        as 16:9, and assuming widescreen either letterboxes it or stretches it.
      */}
      {/*
        Capped in height as well as sized by ratio. A 16:9 export fits a viewport
        comfortably; an A4 portrait page at full width came out 1700 pixels tall, so
        the trainee had to scroll to see the slide they were being taught. The images
        are object-contain, so a capped box letterboxes at the sides rather than
        cropping anything.
      */}
      <div
        className="relative mx-auto w-full"
        style={{ aspectRatio: aspectOf(slide), maxHeight: '72vh' }}
      >
        {nearby.map((candidate) => {
          const showing = candidate.id === slide.id;
          // Stored renders are already webp at display size, so putting them through
          // the image optimiser adds a round trip and buys nothing. Slides committed
          // under /public are PNGs and still worth optimising.
          const stored = candidate.image.startsWith('/api/');

          return (
            <Image
              key={candidate.id}
              src={candidate.image}
              alt={showing ? `Slide ${candidate.id}: ${candidate.title}` : ''}
              aria-hidden={!showing}
              fill
              sizes="(max-width: 1024px) 100vw, 75vw"
              unoptimized={stored}
              // The one on screen is wanted now. Its neighbours are wanted the moment
              // someone presses Next or Previous, which is soon enough to fetch them
              // eagerly and early enough that the cross-fade has something to fade to.
              {...(showing ? { priority: true } : { loading: 'eager' as const })}
              className={`object-contain transition-opacity duration-300 ${
                showing ? (dimmed ? 'opacity-60' : 'opacity-100') : 'pointer-events-none opacity-0'
              }`}
            />
          );
        })}
      </div>

      <figcaption className="border-charcoal-line bg-charcoal-soft flex items-center justify-between gap-3 border-t px-4 py-2.5">
        <span className="text-mist truncate text-sm font-semibold">{slide.title}</span>
        <span className="text-muted shrink-0 text-xs tabular-nums">
          Slide {slide.id} of {deck.totalSlides}
        </span>
      </figcaption>
    </figure>
  );
}
