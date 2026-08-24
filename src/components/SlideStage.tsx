'use client';

import Image from 'next/image';

import { useDeck } from '@/lib/deck-context';
import type { ClientSlide } from '@/lib/deck-types';

/**
 * The slide currently on screen.
 *
 * Slides are the exported renders of the client's PowerPoint rather than a
 * rebuild in HTML, so what the trainee sees is exactly what the approved deck
 * shows, down to the layout.
 *
 * Every slide is mounted once and revealed by opacity rather than swapping the
 * source of a single image. Keying one image on the slide id unmounted and
 * remounted it on every change, which restarted the loader and showed a blank
 * frame between slides. It was most obvious going backwards, where the trainee
 * expects an instant cut to something they have already seen. The whole deck is
 * about 600 kB and is needed within one session anyway, so holding all of it is
 * cheaper than the flicker.
 */
export function SlideStage({ slide, dimmed }: { slide: ClientSlide; dimmed: boolean }) {
  const deck = useDeck();

  return (
    <figure className="border-charcoal-line relative w-full overflow-hidden rounded-xl border bg-white shadow-lg shadow-black/30">
      {/* 16:9, matching the source deck. */}
      <div className="relative aspect-video w-full">
        {deck.slides.map((candidate) => {
          const showing = candidate.id === slide.id;
          return (
            <Image
              key={candidate.id}
              src={candidate.image}
              alt={showing ? `Slide ${candidate.id}: ${candidate.title}` : ''}
              aria-hidden={!showing}
              fill
              sizes="(max-width: 1024px) 100vw, 75vw"
              // The first two are preloaded because they are wanted immediately.
              // The rest are eager rather than lazy: they are technically in the
              // viewport at zero opacity, which is not enough to make the lazy
              // loader fetch them, so without this only two of seven were ever
              // decoded and the first jump to slide 3 still flashed. Eager fetches
              // them right after the first paint, during the opening narration.
              {...(candidate.id <= 2 ? { priority: true } : { loading: 'eager' as const })}
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
