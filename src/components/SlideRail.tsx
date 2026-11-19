'use client';

import { useDeck } from '@/lib/deck-context';

interface SlideRailProps {
  currentId: number;
  coveredIds: number[];
  onSelect: (id: number) => void;
  disabled: boolean;
}

/**
 * Progress through the deck, and a way to jump. Covered slides are marked so the
 * trainee can see how much is left and revisit anything already taught.
 */
export function SlideRail({ currentId, coveredIds, onSelect, disabled }: SlideRailProps) {
  const deck = useDeck();

  return (
    <nav aria-label="Slides" className="flex flex-wrap gap-1.5">
      {deck.slides.map((slide) => {
        const isCurrent = slide.id === currentId;
        const isCovered = coveredIds.includes(slide.id);

        return (
          <button
            key={slide.id}
            type="button"
            onClick={() => onSelect(slide.id)}
            disabled={disabled}
            aria-current={isCurrent ? 'true' : undefined}
            title={`Slide ${slide.id}: ${slide.title}`}
            // Taller and wider under a finger than under a mouse: at 28 pixels the chips
            // were under the size either phone platform asks of something to be tapped.
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:min-h-10 pointer-coarse:min-w-10 ${
              isCurrent
                ? 'bg-azure text-mist'
                : isCovered
                  ? 'bg-charcoal-soft text-teal hover:bg-charcoal-line'
                  : 'bg-charcoal-soft text-muted hover:bg-charcoal-line hover:text-mist'
            }`}
          >
            <span className="tabular-nums">{slide.id}</span>
            <span className="ml-1.5 hidden sm:inline">{slide.shortLabel}</span>
          </button>
        );
      })}
    </nav>
  );
}
