'use client';

import Image from 'next/image';

import type { DeckSlide } from '@/lib/deck';
import { TOTAL_SLIDES } from '@/lib/deck';

/**
 * The slide currently on screen.
 *
 * Slides are the exported renders of the client's PowerPoint rather than a
 * rebuild in HTML, so what the trainee sees is exactly what the approved deck
 * shows, down to the layout.
 */
export function SlideStage({ slide, dimmed }: { slide: DeckSlide; dimmed: boolean }) {
  return (
    <figure className="border-charcoal-line relative w-full overflow-hidden rounded-xl border bg-white shadow-lg shadow-black/30">
      {/* 16:9, matching the source deck. */}
      <div className="relative aspect-video w-full">
        <Image
          key={slide.id}
          src={slide.image}
          alt={`Slide ${slide.id}: ${slide.title}`}
          fill
          sizes="(max-width: 1024px) 100vw, 66vw"
          priority={slide.id === 1}
          className={`object-contain transition-opacity duration-300 ${
            dimmed ? 'opacity-60' : 'opacity-100'
          }`}
        />
      </div>

      <figcaption className="border-charcoal-line bg-charcoal-soft flex items-center justify-between gap-3 border-t px-4 py-2.5">
        <span className="text-mist truncate text-sm font-semibold">{slide.title}</span>
        <span className="text-muted shrink-0 text-xs tabular-nums">
          Slide {slide.id} of {TOTAL_SLIDES}
        </span>
      </figcaption>
    </figure>
  );
}
