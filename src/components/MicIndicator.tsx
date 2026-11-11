'use client';

import { TRAINER_NAME } from '@/lib/trainer';
import type { MicState } from '@/lib/types';

/**
 * Whether this device's microphone is open (AI-45).
 *
 * Driven by the capture state, which is set only once the browser has handed over a live
 * track and cleared the moment the track is stopped, rather than by whose turn it is. So
 * it cannot say "off" while the microphone is live, or "on" after it has closed.
 *
 * In words and announced, not shown by colour alone: the dot is decoration, and the text
 * is what a screen reader hears and what somebody who cannot tell red from grey reads.
 */
export function MicIndicator({ state, className = '' }: { state: MicState; className?: string }) {
  const on = state === 'live';
  const label = on
    ? `Microphone on: ${TRAINER_NAME} is listening`
    : state === 'requesting'
      ? 'Opening the microphone'
      : 'Microphone off';

  return (
    <p
      role="status"
      aria-live="polite"
      data-microphone={on ? 'on' : 'off'}
      className={`flex items-center gap-2 text-sm ${on ? 'text-mist font-semibold' : 'text-muted'} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
          on ? 'bg-logo-red motion-safe:animate-pulse' : 'bg-charcoal-line'
        }`}
      />
      {label}
    </p>
  );
}
