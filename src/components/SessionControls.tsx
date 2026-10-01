'use client';

import { useState } from 'react';

import { useDeck } from '@/lib/deck-context';
import type { MicState, SessionPhase } from '@/lib/types';

interface SessionControlsProps {
  phase: SessionPhase;
  micState: MicState;
  slideId: number;
  trainerSpeaking: boolean;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
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
const WITH_ICON = 'inline-flex items-center gap-1.5';

// Drawn rather than typed. The text characters for these render as coloured emoji on
// iOS, which is the wrong look for a control bar and differs from every other device.
function PlayIcon() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
      <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
      <rect x="2" y="1.5" width="3" height="9" rx="0.5" fill="currentColor" />
      <rect x="7" y="1.5" width="3" height="9" rx="0.5" fill="currentColor" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
      <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}

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
  paused,
  onPause,
  onResume,
  onPrevious,
  onNext,
  onRepeat,
  onQuiz,
  onInterrupt,
  onEnd,
  onAskByText,
}: SessionControlsProps) {
  const deck = useDeck();
  const [draft, setDraft] = useState('');
  const ended = phase === 'ended';
  const canPause = !ended && phase !== 'connecting' && phase !== 'idle';

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
   *
   * So is a pause. Every one of these starts a new turn, and a new turn would play
   * over a session the trainee has just asked to hold. Play first, then move.
   */
  const locked = phase === 'connecting' || ended || paused;

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
        {/*
          Play, pause and stop, grouped and drawn as a player's controls so they read
          as one thing.

          Stop is what End session was, under the name a player uses for it. It sits
          apart from "Stop talking" on purpose: that one hands the floor back to the
          trainee and keeps the session going, and two buttons both reading Stop side
          by side invite the click that ends a session somebody only meant to interrupt.
        */}
        <div
          role="group"
          aria-label="Session playback"
          className="border-charcoal-line mr-1 flex items-center gap-1.5 border-r pr-3"
        >
          {paused ? (
            <button
              type="button"
              className={`${PRIMARY} ${WITH_ICON}`}
              onClick={onResume}
              aria-label="Play, carrying on from where you paused"
            >
              <PlayIcon />
              Play
            </button>
          ) : (
            <button
              type="button"
              className={`${SECONDARY} ${WITH_ICON}`}
              onClick={onPause}
              disabled={!canPause}
              aria-label="Pause the session"
            >
              <PauseIcon />
              Pause
            </button>
          )}
          <button
            type="button"
            className={`${SECONDARY} ${WITH_ICON}`}
            onClick={onEnd}
            disabled={ended}
            title="Stop the session. Every slide already taught is kept."
            aria-label="Stop the session"
          >
            <StopIcon />
            Stop
          </button>
        </div>

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
          {slideId >= deck.totalSlides ? 'Wrap up' : 'Next slide'}
        </button>

        {/* Hidden while paused: the trainer is held mid-word, not talking. */}
        {trainerSpeaking && !paused && (
          <button type="button" className={SECONDARY} onClick={onInterrupt}>
            Stop talking
          </button>
        )}

        <span className="grow" />

        <button type="button" className={SECONDARY} onClick={onQuiz} disabled={locked}>
          Test me
        </button>
      </div>

      <div className="border-charcoal-line flex flex-wrap items-center gap-3 border-t pt-3">
        {/* Not "Just speak" once it is over: the microphone is off, and inviting
            somebody to talk to a session that has stopped listening is simply wrong. */}
        {ended ? (
          <p className="text-muted text-xs">This session has ended, and your microphone is off.</p>
        ) : paused ? (
          <p className="text-mist text-sm">
            <span className="font-semibold">Paused.</span> Your microphone is off. Press Play to
            carry on from the same word.
          </p>
        ) : micUnavailable ? (
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
