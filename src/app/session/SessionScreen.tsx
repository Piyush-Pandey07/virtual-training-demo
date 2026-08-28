'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { BrandHeader } from '@/components/BrandHeader';
import { SessionControls } from '@/components/SessionControls';
import { SlideRail } from '@/components/SlideRail';
import { SlideStage } from '@/components/SlideStage';
import { TrainerPanel } from '@/components/TrainerPanel';
import { useTrainingSession, type ResumeState } from '@/hooks/useTrainingSession';
import { getClientSlide } from '@/lib/deck';
import { useDeck } from '@/lib/deck-context';
import { TRAINER_NAME } from '@/lib/trainer';

interface HealthState {
  ready: boolean;
  missing: string[];
}

/** Pre-session screen. Collects an optional name and unlocks audio on the click. */
function Lobby({
  onStart,
  connecting,
  resume,
}: {
  onStart: (name: string) => void;
  connecting: boolean;
  resume: ResumeState | null;
}) {
  const deck = useDeck();
  const [name, setName] = useState('');
  const [health, setHealth] = useState<HealthState | null>(null);

  // Checked before the trainee is asked for their microphone. On a fresh
  // deployment with an environment variable missing, the alternative is granting
  // microphone access and only then being told the session cannot start.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((response) => (response.ok ? response.json() : null))
      .then((body: HealthState | null) => {
        if (!cancelled && body) setHealth(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const blocked = health !== null && !health.ready;

  return (
    <div className="mx-auto w-full max-w-lg px-5 py-16">
      <Link
        href="/"
        className="text-muted hover:text-teal mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <span aria-hidden="true">&larr;</span> Back
      </Link>

      <h1 className="text-3xl font-bold">{deck.meta.title}</h1>
      <p className="text-muted mt-3 leading-relaxed">
        {TRAINER_NAME} will present {deck.totalSlides} slides and answer anything you ask along the
        way. Around {deck.estimatedMinutes} minutes, plus your questions.
      </p>

      {resume && resume.percent > 0 && (
        <div className="border-charcoal-line bg-charcoal-soft mt-6 rounded-xl border p-4">
          <p className="text-mist text-sm font-semibold">
            You are {resume.percent}% through this session.
          </p>
          <p className="text-muted mt-1 text-sm leading-relaxed">
            {resume.coveredSlideIds.length} of {deck.totalSlides} slides have been taught. Picking
            up from the first one you have not heard.
          </p>
        </div>
      )}

      <label htmlFor="trainee-name" className="mt-8 block text-sm font-semibold">
        Your first name
        <span className="text-muted ml-2 font-normal">optional</span>
      </label>
      <input
        id="trainee-name"
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !connecting) onStart(name);
        }}
        placeholder="So the trainer can address you"
        className="bg-charcoal-soft text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal mt-2 w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
      />

      {blocked && (
        <div
          role="alert"
          className="border-logo-red/40 bg-logo-red/10 mt-6 rounded-md border p-4 text-sm"
        >
          <p className="font-semibold">This deployment is not configured yet.</p>
          <p className="text-muted mt-1">
            Missing {health?.missing.join(' and ')}. Whoever deployed this needs to add{' '}
            {health?.missing.length === 1 ? 'it' : 'them'} to the environment variables and
            redeploy.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => onStart(name)}
        disabled={connecting || blocked}
        className="bg-azure text-mist hover:bg-teal hover:text-charcoal mt-6 w-full rounded-md px-6 py-3 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        {connecting
          ? 'Connecting'
          : resume && resume.percent > 0
            ? 'Resume the session'
            : 'Start the session'}
      </button>

      <p className="text-muted mt-4 text-sm">
        Your browser will ask for microphone access. Headphones are recommended, otherwise the
        trainer&apos;s voice can carry into your microphone. If you would rather not use a
        microphone, start anyway and type your questions instead.
      </p>
    </div>
  );
}

/**
 * The session itself.
 *
 * Split out of the route so the route can be a server component: it loads the
 * deck, narrows it to what the browser may see, and hands that down. This half
 * never sees a presenter note.
 */
export function SessionScreen({
  reviewed,
  resume = null,
}: {
  reviewed: boolean;
  resume?: ResumeState | null;
}) {
  const deck = useDeck();
  const session = useTrainingSession(resume);
  const slide = getClientSlide(deck, session.slideId);
  const showLobby = session.phase === 'idle';
  const busy = session.phase === 'thinking' || session.phase === 'connecting';

  /**
   * The slide rail was gated on `busy`, which is the wrong condition twice over.
   *
   * It left the chips live in the `ended` phase, so clicking one restarted the
   * trainer on a session whose microphone had already been torn down: the
   * "Session complete" card vanished and the trainer talked on with no way to
   * hear anyone. It also disabled the chips for the whole ten seconds a turn
   * takes, which contradicts Previous and Next right beside them.
   *
   * `busy` is still right for dimming the slide, which is exactly what it means.
   */
  const navLocked = session.phase === 'connecting' || session.phase === 'ended';

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        {!showLobby && (
          <Link href="/" className="text-muted hover:text-teal text-sm transition-colors">
            Leave session
          </Link>
        )}
      </BrandHeader>

      {!reviewed && (
        <div className="border-charcoal-line bg-charcoal-soft border-b px-5 py-2.5 sm:px-8">
          <p className="text-muted text-sm">
            <span className="text-mist font-semibold">This deck is a draft.</span> Nobody has
            checked what the trainer says about it yet, so treat anything it tells you as
            unverified.
          </p>
        </div>
      )}

      {session.error && (
        <div
          role="alert"
          className="border-logo-red/40 bg-logo-red/10 flex items-start gap-3 border-b px-5 py-3 sm:px-8"
        >
          <p className="text-mist flex-1 text-sm">{session.error}</p>
          <button
            type="button"
            onClick={session.dismissError}
            className="text-muted hover:text-mist shrink-0 text-sm font-semibold transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {showLobby ? (
        <main className="flex-1">
          <Lobby
            connecting={session.phase === 'connecting'}
            onStart={(name) => void session.startSession(name)}
            resume={resume}
          />
        </main>
      ) : (
        // No transcript. The session reads as a presentation rather than a chat
        // window, so the slide takes the room the conversation log used to.
        <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-5 py-5 sm:px-8">
          {slide && <SlideStage slide={slide} dimmed={busy} />}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex min-w-0 flex-col gap-4">
              <SlideRail
                currentId={session.slideId}
                coveredIds={session.coveredSlideIds}
                onSelect={session.goToSlide}
                disabled={navLocked}
              />

              <SessionControls
                phase={session.phase}
                micState={session.micState}
                slideId={session.slideId}
                trainerSpeaking={session.trainerSpeaking}
                onPrevious={session.previousSlide}
                onNext={session.nextSlide}
                onRepeat={session.repeatSlide}
                onQuiz={session.askQuiz}
                onInterrupt={session.interruptTrainer}
                onEnd={session.endSession}
                onAskByText={session.askByText}
              />
            </div>

            <aside className="flex flex-col gap-4">
              <TrainerPanel
                phase={session.phase}
                micState={session.micState}
                micLevel={session.micLevel}
                speaking={session.trainerSpeaking}
                transcribing={session.transcribing}
                transport={session.sttTransport}
                heard={session.interim}
              />

              {session.phase === 'ended' && (
                <div className="border-charcoal-line bg-charcoal-soft rounded-xl border p-4">
                  <p className="text-sm font-semibold">Session complete</p>
                  <p className="text-muted mt-1 text-sm">
                    You covered {session.coveredSlideIds.length} of {deck.totalSlides} slides.
                  </p>
                  <Link
                    href="/"
                    className="bg-azure text-mist hover:bg-teal hover:text-charcoal mt-3 inline-block rounded-md px-4 py-2 text-sm font-semibold transition-colors"
                  >
                    Back to the start
                  </Link>
                </div>
              )}
            </aside>
          </div>
        </main>
      )}
    </div>
  );
}
