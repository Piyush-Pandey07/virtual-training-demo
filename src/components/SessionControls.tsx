'use client';

import { useEffect, useState } from 'react';

import type { ListeningMode } from '@/hooks/useTrainingSession';
import { TOTAL_SLIDES } from '@/lib/deck';
import type { MicState, SessionPhase } from '@/lib/types';

interface SessionControlsProps {
  phase: SessionPhase;
  micState: MicState;
  slideId: number;
  trainerSpeaking: boolean;
  listeningMode: ListeningMode;
  pushToTalkActive: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onRepeat: () => void;
  onQuiz: () => void;
  onInterrupt: () => void;
  onEnd: () => void;
  onAskByText: (question: string) => void;
  onListeningModeChange: (mode: ListeningMode) => void;
  onPushToTalkChange: (active: boolean) => void;
}

const BUTTON =
  'rounded-md px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40';
const SECONDARY = `${BUTTON} bg-charcoal-soft text-mist hover:bg-charcoal-line`;
const PRIMARY = `${BUTTON} bg-azure text-mist hover:bg-teal hover:text-charcoal`;

/**
 * Session controls, plus a typed fallback for asking a question.
 *
 * Push to talk exists because a live demo is often given in a room with other
 * people talking, or on speakers where the trainer's own voice can leak into the
 * microphone. Holding a key removes both problems.
 */
export function SessionControls({
  phase,
  micState,
  slideId,
  trainerSpeaking,
  listeningMode,
  pushToTalkActive,
  onPrevious,
  onNext,
  onRepeat,
  onQuiz,
  onInterrupt,
  onEnd,
  onAskByText,
  onListeningModeChange,
  onPushToTalkChange,
}: SessionControlsProps) {
  const [draft, setDraft] = useState('');
  const busy = phase === 'thinking' || phase === 'connecting';
  const ended = phase === 'ended';
  // Nothing that teaches should still be clickable after the wrap-up.
  const locked = busy || ended;
  // A blocked or broken microphone is a standing condition, not a passing error,
  // so it stays on screen rather than living in the dismissible banner.
  const micUnavailable = micState === 'denied' || micState === 'error';

  // Space holds the microphone open in push to talk. Ignored while typing.
  useEffect(() => {
    if (listeningMode !== 'push-to-talk') return;

    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || isTypingTarget(event.target)) return;
      event.preventDefault();
      onPushToTalkChange(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isTypingTarget(event.target)) return;
      event.preventDefault();
      onPushToTalkChange(false);
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [listeningMode, onPushToTalkChange]);

  // Leaving push to talk must not strand the microphone in the held state.
  useEffect(() => {
    if (listeningMode !== 'push-to-talk' && pushToTalkActive) onPushToTalkChange(false);
  }, [listeningMode, pushToTalkActive, onPushToTalkChange]);

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
          <>
            <div
              className="ring-charcoal-line inline-flex overflow-hidden rounded-md ring-1 ring-inset"
              role="group"
              aria-label="Listening mode"
            >
              {(['hands-free', 'push-to-talk'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onListeningModeChange(mode)}
                  aria-pressed={listeningMode === mode}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                    listeningMode === mode
                      ? 'bg-azure text-mist'
                      : 'text-muted hover:text-mist bg-transparent'
                  }`}
                >
                  {mode === 'hands-free' ? 'Hands free' : 'Push to talk'}
                </button>
              ))}
            </div>

            {listeningMode === 'push-to-talk' ? (
              <button
                type="button"
                onMouseDown={() => onPushToTalkChange(true)}
                onMouseUp={() => onPushToTalkChange(false)}
                onMouseLeave={() => pushToTalkActive && onPushToTalkChange(false)}
                onTouchStart={(event) => {
                  event.preventDefault();
                  onPushToTalkChange(true);
                }}
                onTouchEnd={() => onPushToTalkChange(false)}
                className={`${BUTTON} ${
                  pushToTalkActive
                    ? 'bg-teal text-charcoal'
                    : 'bg-charcoal text-mist hover:bg-charcoal-line'
                }`}
              >
                {pushToTalkActive
                  ? 'Listening, release when done'
                  : 'Hold to talk, or hold the space bar'}
              </button>
            ) : (
              <p className="text-muted text-xs">
                Just speak. Interrupting is fine. Headphones keep the trainer&apos;s voice out of
                your microphone.
              </p>
            )}
          </>
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
