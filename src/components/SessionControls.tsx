'use client';

import { useState } from 'react';

import { TOTAL_SLIDES } from '@/lib/deck';
import type { MicState, SessionPhase } from '@/lib/types';

interface SessionControlsProps {
  phase: SessionPhase;
  micState: MicState;
  slideId: number;
  trainerSpeaking: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onRepeat: () => void;
  onQuiz: () => void;
  onInterrupt: () => void;
  onEnd: () => void;
  onAskByText: (question: string) => void;
}

const BUTTON =
  'rounded-md px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40';
const SECONDARY = `${BUTTON} bg-charcoal-soft text-mist hover:bg-charcoal-line`;
const PRIMARY = `${BUTTON} bg-azure text-mist hover:bg-teal hover:text-charcoal`;

/**
 * Session controls, plus a typed fallback for asking a question.
 *
 * The microphone is always open while the session runs. There was a listening
 * mode toggle offering push to talk as an alternative, which was removed at the
 * client's request: the two-way choice is a decision the trainee should not have
 * to make, and hands free was already the default. Push to talk is recoverable
 * from git history if a noisy room ever makes it worth having back.
 */
export function SessionControls({
  phase,
  micState,
  slideId,
  trainerSpeaking,
  onPrevious,
  onNext,
  onRepeat,
  onQuiz,
  onInterrupt,
  onEnd,
  onAskByText,
}: SessionControlsProps) {
  const [draft, setDraft] = useState('');
  const ended = phase === 'ended';

  /**
   * Navigation stays live while a turn is generating.
   *
   * It used to be locked for the whole ten seconds a narration takes to come
   * back, so pressing Next mid-generation did nothing at all and the controls felt
   * broken. Moving the deck already interrupts playback and aborts the request in
   * flight, and turns carry a sequence token so a superseded one cannot alter
   * state, which makes an early press safe rather than merely tolerated.
   *
   * Connecting is different: there is no session to navigate yet.
   */
  const locked = phase === 'connecting' || ended;

  // A blocked or broken microphone is a standing condition, not a passing error,
  // so it stays on screen rather than living in the dismissible banner.
  const micUnavailable = micState === 'denied' || micState === 'error';

  const submitDraft = () => {
    const question = draft.trim();
    if (!question) return;
    setDraft('');
    onAskByText(question);
  };

  return (
    <section className="border-charcoal-line bg-charcoal-soft space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={SECONDARY}
          onClick={onPrevious}
          disabled={locked || slideId <= 1}
        >
          Previous
        </button>
        <button type="button" className={SECONDARY} onClick={onRepeat} disabled={locked}>
          Explain again
        </button>
        <button type="button" className={PRIMARY} onClick={onNext} disabled={locked}>
          {slideId >= TOTAL_SLIDES ? 'Wrap up' : 'Next slide'}
        </button>

        {trainerSpeaking && (
          <button type="button" className={SECONDARY} onClick={onInterrupt}>
            Stop talking
          </button>
        )}

        <span className="grow" />

        <button type="button" className={SECONDARY} onClick={onQuiz} disabled={locked}>
          Test me
        </button>
        <button
          type="button"
          className={`${BUTTON} text-muted ring-charcoal-line hover:text-mist bg-transparent ring-1 ring-inset`}
          onClick={onEnd}
          disabled={ended}
        >
          End session
        </button>
      </div>

      <div className="border-charcoal-line flex flex-wrap items-center gap-3 border-t pt-3">
        {micUnavailable ? (
          <p className="text-mist text-sm">
            <span className="text-logo-red font-semibold">Microphone unavailable.</span>{' '}
            {micState === 'denied'
              ? 'Allow microphone access in your browser and start the session again, or carry on by typing your questions below.'
              : 'Voice input could not start. You can carry on by typing your questions below.'}
          </p>
        ) : (
          <p className="text-muted text-xs">
            Just speak. Interrupting is fine. Headphones keep the trainer&apos;s voice out of your
            microphone.
          </p>
        )}
      </div>

      <div className="border-charcoal-line flex gap-2 border-t pt-3">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitDraft();
          }}
          placeholder="Or type a question"
          aria-label="Type a question"
          className="bg-charcoal text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal min-w-0 flex-1 rounded-md px-3 py-2 text-sm ring-1 ring-inset"
        />
        <button
          type="button"
          className={PRIMARY}
          onClick={submitDraft}
          disabled={!draft.trim() || locked}
        >
          Ask
        </button>
      </div>
    </section>
  );
}
