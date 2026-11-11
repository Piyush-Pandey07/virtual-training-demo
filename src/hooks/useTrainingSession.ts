'use client';

/**
 * The session orchestrator.
 *
 * Holds the one authoritative view of what is happening: which slide is up, who
 * is talking, what has been said, and what happens next. The two audio hooks and
 * the chat route are the moving parts; this decides when each one runs.
 *
 * The loop is: teach a slide, hand over, listen. A question is answered and then
 * control returns to the trainee rather than ploughing on, so the trainee sets
 * the pace. Advancing is deliberate, either the trainee asking to move on or the
 * Next control being used.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { clampSlideId, firstSlideId, totalSlides } from '@/lib/deck';
import { useDeck } from '@/lib/deck-context';
import { classifyUtterance } from '@/lib/intent';
import { reportProgress } from '@/lib/progress-client';
import { sanitiseForSpeech } from '@/lib/speech';
import { detectAnswerStyle } from '@/lib/intent';
import {
  CONNECTION_LOST_MID_TURN,
  FAILURE_MESSAGES,
  connectionFailure,
  describeFailure,
  readFailure,
  type Failure,
} from '@/lib/failures/codes';
import { reportFailure } from '@/lib/failures/report-client';
import type {
  ChatEvent,
  HistoryTurn,
  LearnerProfile,
  SessionLanguage,
  SessionPhase,
  TranscriptEntry,
  TurnKind,
} from '@/lib/types';

import { useSpeechInput, type SttTransport } from './useSpeechInput';
import { useTtsPlayer } from './useTtsPlayer';

/**
 * A barge-in needs more than one stray syllable, or the trainer gets cut off by
 * a cough or by its own voice leaking through the speakers.
 */
const BARGE_IN_MIN_WORDS = 2;

/**
 * How many times a turn is asked for before the trainee is told, when nothing of it has
 * been heard yet.
 *
 * Asking again is safe only until the first words arrive: from then on the trainee has
 * heard part of the turn, and a second request would start it again from the top, which
 * is the very thing trainees complained of. Before that, a retry is invisible.
 */
const CHAT_ATTEMPTS = 3;
/** How long a narration fetched ahead may take before it is given up (AI-44). */
const PREFETCH_LIMIT_MS = 30_000;

/**
 * How long a turn may go without sending anything before it is treated as lost.
 *
 * Gemini takes three to eight seconds to start a turn and then streams steadily, so
 * twenty seconds of nothing, before or during a turn, is a connection that has gone
 * rather than a model that is thinking.
 */
const CHAT_SILENCE_MS = 20_000;

/** A turn that failed, with what to tell the trainee and what to log. */
class TurnFailure extends Error {
  constructor(
    readonly failure: Failure,
    /** For the developer log: `network`, `timeout`, or `http-` and the status. */
    readonly kind: string,
  ) {
    super(failure.message);
    this.name = 'TurnFailure';
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

const EMPTY_LEARNER: LearnerProfile = {
  questionsAsked: 0,
  curiousAbout: [],
  prefersSimpler: false,
  prefersDepth: false,
  askedForStandard: false,
};

let entryCounter = 0;
function makeEntry(
  speaker: TranscriptEntry['speaker'],
  text: string,
  slideId: number,
): TranscriptEntry {
  entryCounter += 1;
  return { id: `${speaker}-${entryCounter}`, speaker, text, slideId, at: Date.now() };
}

export interface UseTrainingSessionResult {
  phase: SessionPhase;
  slideId: number;
  slideIndex: number;
  transcript: TranscriptEntry[];
  /** Live partial transcript of the trainee, shown as a caption. */
  interim: string;
  coveredSlideIds: number[];
  /** Running read on the trainee, sent to the model each turn. */
  learner: LearnerProfile;
  error: string | null;
  /**
   * The trainer is held on a sentence it could not fetch, usually because the
   * connection dropped. It tries again on its own; `carryOn` tries now.
   */
  speechHeld: Failure | null;
  carryOn: () => void;
  micState: ReturnType<typeof useSpeechInput>['state'];
  micLevel: number;
  /** Which speech to text transport is live. Null before the session starts. */
  sttTransport: SttTransport | null;
  /** True while a batch utterance is being transcribed. */
  transcribing: boolean;
  trainerSpeaking: boolean;
  /**
   * The trainer is speaking and the browser will not let it be heard.
   *
   * Worth surfacing rather than leaving to the trainee to work out, because every
   * other signal looks healthy: slides advance, the transcript fills, the trainer
   * reports itself as speaking. Only the sound is missing, and a slide is not marked
   * taught until its narration finishes, so the session also quietly records nothing.
   */
  audioInaudible: boolean;
  /** Retry playback. Must be called from a user gesture to have any chance. */
  retryAudio: () => Promise<boolean>;

  /**
   * Held by the trainee. Separate from `phase` rather than one of its values, because
   * a turn already in flight sets the phase itself: a pause pressed while the trainer
   * was thinking would be overwritten by 'speaking' the moment the first words landed.
   */
  paused: boolean;
  /** Freezes the trainer mid-word and closes the microphone. */
  pauseSession: () => Promise<void>;
  /** Carries on from the exact word. Call from the click, so the browser plays it. */
  resumeSession: () => Promise<void>;

  /**
   * Starts the session in the chosen voice and language, both then fixed for the rest
   * of it.
   *
   * There is deliberately no way to change the voice once started. Switching mid-session
   * would mean regenerating what is queued in the new voice, adding a pause where the
   * trainer goes quiet, which is the reason the to-do gave for ruling it out. The
   * language goes with the voice, since each voice speaks only one.
   */
  startSession: (traineeName?: string, voice?: string, language?: SessionLanguage) => Promise<void>;
  /** Stops the session. Every slide already taught is kept. */
  endSession: () => void;
  nextSlide: () => void;
  previousSlide: () => void;
  goToSlide: (id: number) => void;
  repeatSlide: () => void;
  askQuiz: () => void;
  /** Types a question instead of speaking it. Useful when there is no microphone. */
  askByText: (question: string) => void;
  interruptTrainer: () => void;
  dismissError: () => void;
}

/**
 * What a previous sitting left behind, loaded server-side and passed in.
 *
 * Slide ids and one percentage. Deliberately nothing about pacing: the weighting
 * that produced the percentage is server-only, and shipping it here to recompute the
 * same number would put it in the browser for no gain.
 */
export interface ResumeState {
  coveredSlideIds: number[];
  lastSlideId: number | null;
  percent: number;
}

export function useTrainingSession(resume?: ResumeState | null): UseTrainingSessionResult {
  const deck = useDeck();

  /**
   * Where this session begins.
   *
   * The first slide not yet taught, rather than wherever the trainee was standing
   * when they left. Somebody who walked out halfway through slide three never had it
   * taught, so it never counted as covered, and resuming at four would silently skip
   * it.
   */
  const resumeAt = (() => {
    const covered = new Set(resume?.coveredSlideIds ?? []);
    const uncovered = deck.slides.find((slide) => !covered.has(slide.id));
    return uncovered?.id ?? resume?.lastSlideId ?? firstSlideId(deck);
  })();

  const [phase, setPhase] = useState<SessionPhase>('idle');
  const [slideId, setSlideId] = useState(() => resumeAt);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [coveredSlideIds, setCoveredSlideIds] = useState<number[]>(
    () => resume?.coveredSlideIds ?? [],
  );
  const [learner, setLearner] = useState<LearnerProfile>(EMPTY_LEARNER);
  const [error, setError] = useState<string | null>(null);
  const [traineeName, setTraineeName] = useState<string | undefined>();
  const [paused, setPaused] = useState(false);

  /** Refs mirror state that async callbacks need to read without going stale. */
  // Seeded from the same values as the state above. This used to be `useRef(1)`
  // while the state beside it was `firstSlideId(deck)`, which disagreed for any deck
  // not numbered from one.
  const slideIdRef = useRef(resumeAt);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const coveredRef = useRef<number[]>(resume?.coveredSlideIds ?? []);
  const learnerRef = useRef<LearnerProfile>(EMPTY_LEARNER);
  const traineeNameRef = useRef<string | undefined>(undefined);
  const phaseRef = useRef<SessionPhase>('idle');
  /** Read by callbacks that must not act while the session is held. */
  const pausedRef = useRef(false);
  /**
   * What the trainer speaks in, and in which voice, sent with every turn. Set as the
   * session starts and never again: the chat route needs both because Hindi verbs agree
   * with the speaker, so the words have to be written for the voice that will say them.
   */
  const languageRef = useRef<SessionLanguage>('en');
  const chosenVoiceRef = useRef<string | undefined>(undefined);
  const turnAbortRef = useRef<AbortController | null>(null);
  /** Set while a turn is being generated, so overlapping requests are dropped. */
  const busyRef = useRef(false);
  /** Increments on every turn, so a superseded one knows not to change state. */
  const turnSeqRef = useRef(0);

  useEffect(() => {
    slideIdRef.current = slideId;
  }, [slideId]);
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);
  useEffect(() => {
    coveredRef.current = coveredSlideIds;
  }, [coveredSlideIds]);
  useEffect(() => {
    learnerRef.current = learner;
  }, [learner]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    traineeNameRef.current = traineeName;
  }, [traineeName]);

  const tts = useTtsPlayer({ deckId: deck.meta.id });
  const ttsRef = useRef(tts);
  useEffect(() => {
    ttsRef.current = tts;
  }, [tts]);

  const appendEntry = useCallback((entry: TranscriptEntry) => {
    setTranscript((current) => [...current, entry]);
  }, []);

  /**
   * Folds one question into the running read on the trainee. Kept in a single
   * place so a spoken question and a typed one update it identically.
   */
  const noteQuestion = useCallback((question: string, slideId: number) => {
    const style = detectAnswerStyle(question);
    setLearner((current) => {
      const next: LearnerProfile = {
        questionsAsked: current.questionsAsked + 1,
        curiousAbout: current.curiousAbout.includes(slideId)
          ? current.curiousAbout
          : [...current.curiousAbout, slideId].sort((a, b) => a - b),
        prefersSimpler: current.prefersSimpler || style === 'simpler',
        prefersDepth: current.prefersDepth || style === 'deeper',
        askedForStandard: current.askedForStandard || style === 'standard',
      };
      learnerRef.current = next;
      return next;
    });
  }, []);

  /**
   * Takes the floor from whatever turn currently holds it.
   *
   * Every caller repeated these four lines, and one of them getting it wrong is
   * what made End session fail: it cleared busyRef and aborted, but left the turn
   * token intact, so the cancelled turn resumed a microtask later, appended its
   * entry and set the phase back to 'listening'. The "Session complete" panel
   * appeared and then vanished, and the trainee had to press End twice on a
   * session whose microphone was already gone.
   *
   * Bumping the token is the piece that matters: a turn that no longer holds the
   * floor must not touch phase, coveredSlideIds or busyRef when it unwinds.
   */
  const cancelCurrentTurn = useCallback(() => {
    turnSeqRef.current += 1;
    turnAbortRef.current?.abort();
    busyRef.current = false;
    ttsRef.current.interrupt();
  }, []);

  const buildHistory = useCallback(
    (): HistoryTurn[] =>
      transcriptRef.current.map((entry) => ({
        speaker: entry.speaker,
        text: entry.text,
        slideId: entry.slideId,
      })),
    [],
  );

  /**
   * Runs one trainer turn: streams from Gemini, speaks it as it arrives, and
   * records it once playback has finished.
   */
  /**
   * The next slide's narration, asked for while this slide plays (AI-44).
   *
   * Measured on the live site, a slide start took a median of 4.3 seconds to the first
   * sound, against a target of 3, and almost half of it was the model writing the first
   * sentence. Fetching it ahead takes that out of the wait. It is the text only: no
   * speech is synthesised until the slide is actually taught, so a trainee who asks a
   * question instead wastes one model call and nothing billed by the second.
   */
  const prefetchRef = useRef<{
    slideId: number;
    transcriptLength: number;
    controller: AbortController;
    text: Promise<string | null>;
    /** The narration once it has arrived whole; undefined while it is still coming. */
    settled?: string | null;
  } | null>(null);

  const prefetchNarration = useCallback(
    /**
     * `pending` is the narration still playing, asked for as soon as its text is whole:
     * the slide then plays for half a minute or more, which is when the next one can be
     * written, rather than after it, which left the model no time before Next (measured
     * locally, every Next still waited on a fresh request). It is sent as though already
     * recorded and taught, which it will be by the time the prefetch is used.
     */
    (slideId: number, pending?: { text: string; slideId: number }) => {
      prefetchRef.current?.controller.abort();
      const controller = new AbortController();
      const history = buildHistory();
      const covered = coveredRef.current;
      const body = JSON.stringify({
        deckId: deck.meta.id,
        kind: 'narrate',
        slideId,
        history: pending
          ? [...history, { speaker: 'trainer', text: pending.text, slideId: pending.slideId }]
          : history,
        traineeName: traineeNameRef.current,
        coveredSlideIds:
          pending && !covered.includes(pending.slideId)
            ? [...covered, pending.slideId].sort((a, b) => a - b)
            : covered,
        learner: learnerRef.current,
        language: languageRef.current,
        voice: chosenVoiceRef.current,
      });
      const text = (async (): Promise<string | null> => {
        try {
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: controller.signal,
          });
          if (!response.ok || !response.body) return null;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let pending = '';
          let spoken = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            const frames = pending.split('\n\n');
            pending = frames.pop() ?? '';
            for (const frame of frames) {
              const line = frame.split('\n').find((entry) => entry.startsWith('data: '));
              if (!line) continue;
              const event = JSON.parse(line.slice(6)) as ChatEvent;
              // A turn that moved the deck or failed is not one to replay.
              if (event.type === 'error' || event.type === 'nav') return null;
              if (event.type === 'text') spoken += event.delta;
            }
          }
          return spoken.trim() || null;
        } catch {
          return null;
        }
      })();
      // A stalled connection is given up rather than held open.
      const limit = setTimeout(() => controller.abort(), PREFETCH_LIMIT_MS);
      const entry: NonNullable<typeof prefetchRef.current> = {
        slideId,
        // Pending, the narration is recorded before this is used, so the transcript is one
        // longer by then; anything else said in between makes it stale.
        transcriptLength: transcriptRef.current.length + (pending ? 1 : 0),
        controller,
        text,
      };
      void text.then((result) => {
        clearTimeout(limit);
        entry.settled = result;
      });
      prefetchRef.current = entry;
    },
    [buildHistory, deck.meta.id],
  );

  const runTurn = useCallback(
    async (kind: TurnKind, opts: { question?: string; slideId?: number } = {}) => {
      // Before anything else, and in particular before player.interrupt() below, which
      // ends a pause. A turn begun while paused would unfreeze the audio underneath a
      // screen still saying Paused. The controls are locked while paused, so this is
      // the backstop for whatever path is added next.
      if (pausedRef.current) return;
      if (busyRef.current) return;
      // An ended session stays ended. Without this, any control that reaches
      // runTurn could restart the trainer after the microphone had been torn
      // down, leaving a session that looks live but cannot hear.
      if (phaseRef.current === 'ended' && kind !== 'recap') return;
      busyRef.current = true;

      const targetSlide = clampSlideId(deck, opts.slideId ?? slideIdRef.current);
      const player = ttsRef.current;

      // Silence whatever is still playing before queueing anything new. The button
      // handlers each did this themselves, but the voice path did not, so it
      // depended on barge-in having fired. A single-word "next" is below the
      // barge-in threshold, and the new turn's audio would then be scheduled
      // behind the old turn's rather than replacing it.
      player.interrupt();

      turnAbortRef.current?.abort();
      const controller = new AbortController();
      turnAbortRef.current = controller;

      /**
       * Identifies this turn for the rest of its life.
       *
       * Interrupting a turn resolves its pending waitUntilDone, so its completion
       * path runs a moment later, after the replacing turn has already set itself
       * up. Without this token the old turn would then overwrite the new turn's
       * phase and clear busyRef while it was still running, letting a third turn
       * start on top of it.
       */
      turnSeqRef.current += 1;
      const turnId = turnSeqRef.current;
      const isCurrent = () => turnSeqRef.current === turnId;

      setPhase('thinking');

      let spoken = '';
      let sawText = false;
      /** Set when the model moved the deck during this turn. */
      let navigatedTo: number | null = null;

      // The narration fetched ahead for this slide, if nothing has been said since it
      // was asked for. Anything else, a question in between above all, and it is dropped.
      const ahead = prefetchRef.current;
      prefetchRef.current = null;
      // Only once it has arrived whole: waiting for the rest of it would be slower than
      // streaming the turn afresh, which speaks from its first sentence.
      const usable =
        kind === 'narrate' &&
        ahead !== null &&
        ahead.settled &&
        ahead.slideId === targetSlide &&
        ahead.transcriptLength === transcriptRef.current.length
          ? ahead
          : null;
      if (ahead && !usable) ahead.controller.abort();

      const body = JSON.stringify({
        // Named explicitly. The server loads a deck per request, and without
        // this a session on an uploaded deck would be narrated from the
        // default one: the right slides on screen, the wrong script.
        deckId: deck.meta.id,
        kind,
        slideId: targetSlide,
        question: opts.question,
        history: buildHistory(),
        traineeName: traineeNameRef.current,
        coveredSlideIds: coveredRef.current,
        learner: learnerRef.current,
        language: languageRef.current,
        voice: chosenVoiceRef.current,
      });

      /**
       * One request for the turn, read to the end.
       *
       * Bounded by CHAT_SILENCE_MS of nothing arriving, so a connection that died
       * without closing does not leave the trainee watching "thinking" for ever.
       * Every failure leaves as a TurnFailure carrying the standard message.
       */
      const streamTurn = async () => {
        const attempt = new AbortController();
        const cancel = () => attempt.abort();
        controller.signal.addEventListener('abort', cancel, { once: true });
        let silent = false;
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        const heard = () => {
          clearTimeout(watchdog);
          watchdog = setTimeout(() => {
            silent = true;
            attempt.abort();
          }, CHAT_SILENCE_MS);
        };

        try {
          heard();
          let response: Response;
          try {
            response = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
              signal: attempt.signal,
            });
          } catch (caught) {
            if (controller.signal.aborted) throw caught;
            throw new TurnFailure(connectionFailure(), silent ? 'timeout' : 'network');
          }

          if (!response.ok || !response.body) {
            throw new TurnFailure(await readFailure(response), `http-${response.status}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let pending = '';

          for (;;) {
            let chunk: ReadableStreamReadResult<Uint8Array>;
            try {
              chunk = await reader.read();
            } catch (caught) {
              if (controller.signal.aborted) throw caught;
              throw new TurnFailure(connectionFailure(), silent ? 'timeout' : 'network');
            }
            const { done, value } = chunk;
            if (done) break;
            heard();

            pending += decoder.decode(value, { stream: true });
            const frames = pending.split('\n\n');
            pending = frames.pop() ?? '';

            for (const frame of frames) {
              const line = frame.split('\n').find((l) => l.startsWith('data: '));
              if (!line) continue;

              let event: ChatEvent;
              try {
                event = JSON.parse(line.slice(6)) as ChatEvent;
              } catch {
                continue;
              }

              if (event.type === 'text') {
                if (!sawText) {
                  sawText = true;
                  setPhase('speaking');
                }
                spoken += event.delta;
                player.push(event.delta);
              } else if (event.type === 'nav') {
                const next = clampSlideId(deck, event.slideId);
                navigatedTo = next;
                setSlideId(next);
                slideIdRef.current = next;
              } else if (event.type === 'error') {
                throw new TurnFailure(
                  {
                    code: event.code ?? 'unavailable',
                    message: event.message,
                    retry: event.retry !== false,
                    ref: event.ref,
                  },
                  'stream-error',
                );
              }
            }
          }
        } finally {
          clearTimeout(watchdog);
          controller.signal.removeEventListener('abort', cancel);
        }
      };

      try {
        // Already whole, so taken at once rather than awaited.
        const fetchedAhead = usable?.settled ?? null;
        if (fetchedAhead && isCurrent()) {
          // Spoken straight away: the trainer starts as soon as the first chunk is
          // synthesised, instead of first waiting for the model (AI-44).
          sawText = true;
          setPhase('speaking');
          spoken = fetchedAhead;
          player.push(fetchedAhead);
        }
        for (let tries = 1; !fetchedAhead; tries += 1) {
          try {
            await streamTurn();
            break;
          } catch (caught) {
            const retryable =
              caught instanceof TurnFailure &&
              caught.failure.retry &&
              !sawText &&
              tries < CHAT_ATTEMPTS &&
              isCurrent();
            if (!retryable) throw caught;
            const wait = caught.failure.retryAfter
              ? caught.failure.retryAfter * 1000
              : tries * 1500;
            await pause(wait, controller.signal);
          }
        }

        // The narration's text is whole: the next slide's is asked for now, while this one
        // plays, so it is ready by the time the trainee presses Next (AI-44). Not where the
        // server moved the deck, since the next slide is then a different one.
        const written = sanitiseForSpeech(spoken);
        if (kind === 'narrate' && navigatedTo === null && written && isCurrent()) {
          const index = deck.slides.findIndex((entry) => entry.id === targetSlide);
          const upcoming = deck.slides[index + 1];
          if (upcoming && !coveredRef.current.includes(upcoming.id)) {
            prefetchNarration(upcoming.id, { text: written, slideId: targetSlide });
          }
        }

        // A turn superseded meanwhile leaves the player to the turn that replaced it,
        // whose half-buffered sentence would otherwise be spoken as a fragment.
        if (isCurrent()) {
          player.flush();
          await player.waitUntilDone();
        }

        // Recorded even if this turn has been superseded, because it was
        // generated and at least partly heard, and the model needs it as context.
        // Cleaned before it becomes history, so markdown the model slipped in does
        // not come back to it as an example of how it writes.
        const finalText = sanitiseForSpeech(spoken);
        if (finalText) {
          appendEntry(makeEntry('trainer', finalText, targetSlide));
        }

        // Everything below belongs to whichever turn currently holds the floor.
        if (!isCurrent()) return;

        // Where the server moved the deck, that slide is the one that was taught.
        const taughtSlide = navigatedTo ?? targetSlide;
        if (kind === 'narrate' && !coveredRef.current.includes(taughtSlide)) {
          const next = [...coveredRef.current, taughtSlide].sort((a, b) => a - b);
          coveredRef.current = next;
          setCoveredSlideIds(next);
          // The only place progress is reported, because this is the only place a
          // slide is known to have been taught: the audio finished, and the turn was
          // not superseded. At most one call per slide, off the rendering path.
          void reportProgress({ deckId: deck.meta.id, kind: 'covered', slideId: taughtSlide });
        }

        setPhase(kind === 'recap' ? 'ended' : 'listening');

        // Where the server moved the deck mid-turn, the next slide is only known now, so
        // that one is asked for here instead. Only for a slide not yet taught; a question in
        // between makes it stale and it is dropped.
        if (kind === 'narrate' && navigatedTo !== null && !prefetchRef.current) {
          const index = deck.slides.findIndex((entry) => entry.id === taughtSlide);
          const next = deck.slides[index + 1];
          if (next && !coveredRef.current.includes(next.id)) prefetchNarration(next.id);
        }
      } catch (caught) {
        // An interrupted turn still said something, and the model needs it as
        // context: without this the trainee's next question is answered as though
        // the last half-minute of narration never happened.
        const partial = sanitiseForSpeech(spoken);
        if ((caught as Error).name === 'AbortError' && partial) {
          appendEntry(makeEntry('trainer', partial, targetSlide));
        }
        if ((caught as Error).name !== 'AbortError' && isCurrent()) {
          if (caught instanceof TurnFailure) {
            // The server logs what providers said; only the browser knows when the
            // connection itself went, so that is the part it reports.
            if (caught.kind === 'network' || caught.kind === 'timeout') {
              reportFailure({
                area: 'narration',
                kind: caught.kind,
                code: 'connection',
                detail: `A ${kind} turn ${partial ? 'broke off partway' : 'never arrived'}.`,
                deckId: deck.meta.id,
                language: languageRef.current,
              });
            }
            // Part of the turn was heard, so it cannot pick up from the same sentence.
            // The trainee is told how to hear the rest rather than promised it.
            setError(
              partial && caught.failure.code === 'connection'
                ? CONNECTION_LOST_MID_TURN
                : describeFailure(caught.failure),
            );
          } else {
            setError(FAILURE_MESSAGES.unavailable);
          }
          setPhase('error');
        }
      } finally {
        // Only the turn that still holds the floor may release it.
        if (isCurrent()) busyRef.current = false;
      }
    },
    [appendEntry, buildHistory, deck, prefetchNarration],
  );

  /** A trainee utterance: either a nudge to continue, or a question to answer. */
  const handleUtterance = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      if (phaseRef.current === 'ended') return;
      // The microphone is closed while paused, so nothing should arrive. If something
      // does, cancelling the turn below would end the pause from underneath the screen.
      if (pausedRef.current) return;

      /**
       * Take the floor before routing, exactly as the typed path already did.
       *
       * Without this, anything said while a turn was generating hit the busyRef
       * guard in runTurn and was thrown away in silence. Barge-in did not save it,
       * because barge-in only fires while audio is actually playing and there is
       * none during the three to eight seconds Gemini takes. Asking a question in
       * that window simply lost it, and with the transcript panel gone there was
       * no trace at all. The advance case was worse: the deck moved to the next
       * slide and the narration for it was dropped, which is the stalled session
       * that started this whole line of work.
       */
      cancelCurrentTurn();

      appendEntry(makeEntry('trainee', clean, slideIdRef.current));

      // Routing on intent is what stops "please move to the next topic" being
      // treated as a question, answered with "right, let's move on", and leaving
      // the next slide on screen with nobody teaching it.
      const intent = classifyUtterance(clean);

      if (intent === 'advance') {
        const next = slideIdRef.current + 1;
        if (next > totalSlides(deck)) {
          void runTurn('recap');
          return;
        }
        setSlideId(next);
        slideIdRef.current = next;
        void runTurn('narrate', { slideId: next });
        return;
      }

      if (intent === 'back') {
        const previous = clampSlideId(deck, slideIdRef.current - 1);
        setSlideId(previous);
        slideIdRef.current = previous;
        void runTurn('narrate', { slideId: previous });
        return;
      }

      if (intent === 'repeat') {
        void runTurn('narrate', { slideId: slideIdRef.current });
        return;
      }

      noteQuestion(clean, slideIdRef.current);
      void runTurn('answer', { question: clean });
    },
    [appendEntry, cancelCurrentTurn, deck, noteQuestion, runTurn],
  );

  /** Cuts the trainer off when the trainee starts talking over it. */
  const handleSpeechStart = useCallback(() => {
    if (pausedRef.current) return;
    if (!ttsRef.current.speaking) return;
    cancelCurrentTurn();
    setPhase('listening');
  }, [cancelCurrentTurn]);

  const handleInterim = useCallback(
    (text: string) => {
      // Only treat sustained speech as a barge-in, so a cough does not stop the
      // trainer mid-sentence.
      if (!ttsRef.current.speaking) return;
      if (text.trim().split(/\s+/).length < BARGE_IN_MIN_WORDS) return;
      handleSpeechStart();
    },
    [handleSpeechStart],
  );

  const stt = useSpeechInput({
    onUtterance: handleUtterance,
    onInterim: handleInterim,
    // Without this, barge-in only worked on the streaming transport, which is the
    // one that needs a Deepgram key with Member permissions. On the batch
    // transport there are no interim results, so onInterim never fires and the
    // trainer could not be interrupted at all.
    onSpeechStart: handleSpeechStart,
    onError: setError,
  });
  const sttRef = useRef(stt);
  useEffect(() => {
    sttRef.current = stt;
  }, [stt]);

  /**
   * Holds the session exactly where it is.
   *
   * The audio timeline is suspended rather than the turn cancelled, so the trainer
   * stops mid-word and carries on from the same word: nothing is thrown away, nothing
   * is generated again, and nothing is billed twice. A turn still generating when the
   * pause lands finishes in the background and queues behind it.
   *
   * The microphone is closed outright rather than muted. A held session should not be
   * listening, should not keep the browser's recording light on, and should not keep
   * a socket open to Deepgram, which is billed for every second of audio it is sent.
   *
   * A slide interrupted by a pause is not yet taught, and needs nothing extra to stay
   * that way: it is marked only when its narration finishes playing, which a pause
   * delays and a Stop prevents.
   */
  const pauseSession = useCallback(async () => {
    const phase = phaseRef.current;
    if (pausedRef.current) return;
    // Nothing to hold before the session is up, or once it is over.
    if (phase === 'idle' || phase === 'connecting' || phase === 'ended') return;

    pausedRef.current = true;
    setPaused(true);
    sttRef.current.stop();
    await ttsRef.current.pause();
  }, []);

  const resumeSession = useCallback(async () => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    setPaused(false);
    // Sound first, while this is still the click the browser will accept it from.
    // The microphone follows; it needs permission, which was granted at the start,
    // not a gesture.
    await ttsRef.current.resume();
    await sttRef.current.start();
  }, []);

  const startSession = useCallback(
    async (name?: string, voice?: string, language: SessionLanguage = 'en') => {
      setError(null);
      setPhase('connecting');
      // The one place the voice is set. Fixed from here: nothing in this hook exposes a
      // way to change it, and the picker lives only on the lobby, which is gone once
      // the session is up. The language is set beside it, for the same reasons, in each
      // of the three places that need it: what the trainer writes, how far ahead it is
      // spoken, and what the microphone listens for.
      ttsRef.current.setVoice(voice);
      ttsRef.current.setLanguage(language);
      sttRef.current.setLanguage(language);
      sttRef.current.setKeyterms(deck.listenFor ?? []);
      languageRef.current = language;
      chosenVoiceRef.current = voice;
      const trimmed = name?.trim();
      setTraineeName(trimmed || undefined);
      traineeNameRef.current = trimmed || undefined;

      // Playback must be unlocked from the user gesture that started the session.
      await ttsRef.current.unlock();
      await sttRef.current.start();

      setSlideId(resumeAt);
      slideIdRef.current = resumeAt;
      // The transcript and the learner profile do start again. Progress is what
      // carries across a sitting; the conversation does not, and pretending the
      // trainer remembers a chat from last week would be worse than it not doing so.
      setTranscript([]);
      transcriptRef.current = [];
      const already = resume?.coveredSlideIds ?? [];
      setCoveredSlideIds(already);
      coveredRef.current = already;
      setLearner(EMPTY_LEARNER);
      learnerRef.current = EMPTY_LEARNER;

      void reportProgress({ deckId: deck.meta.id, kind: 'start' });
      await runTurn('narrate', { slideId: resumeAt });
    },
    [deck, resume, resumeAt, runTurn],
  );

  const endSession = useCallback(() => {
    // Stop works from a pause. Cancelling the turn ends the player's half of it, since
    // interrupt() discards what the pause was holding; this ends the screen's half.
    pausedRef.current = false;
    setPaused(false);
    cancelCurrentTurn();
    sttRef.current.stop();
    setPhase('ended');
    // Where they stopped, so the lobby can say so next time. Every slide already
    // taught is durable on its own, so losing this costs only the exact resume point.
    void reportProgress({
      deckId: deck.meta.id,
      kind: 'end',
      slideId: slideIdRef.current,
    });
  }, [cancelCurrentTurn, deck]);

  const goToSlide = useCallback(
    (id: number) => {
      const next = clampSlideId(deck, id);
      cancelCurrentTurn();
      setSlideId(next);
      slideIdRef.current = next;
      void runTurn('narrate', { slideId: next });
    },
    [cancelCurrentTurn, deck, runTurn],
  );

  const nextSlide = useCallback(() => {
    const next = slideIdRef.current + 1;
    if (next > totalSlides(deck)) {
      cancelCurrentTurn();
      void runTurn('recap');
      return;
    }
    goToSlide(next);
  }, [cancelCurrentTurn, deck, goToSlide, runTurn]);

  const previousSlide = useCallback(() => {
    goToSlide(slideIdRef.current - 1);
  }, [goToSlide]);

  const repeatSlide = useCallback(() => {
    goToSlide(slideIdRef.current);
  }, [goToSlide]);

  const askQuiz = useCallback(() => {
    cancelCurrentTurn();
    void runTurn('quiz');
  }, [cancelCurrentTurn, runTurn]);

  const askByText = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      cancelCurrentTurn();
      appendEntry(makeEntry('trainee', clean, slideIdRef.current));

      // Typing "next slide" should do what saying it does, so this goes through
      // the same intent routing rather than always being treated as a question.
      const intent = classifyUtterance(clean);

      if (intent === 'advance') {
        const next = slideIdRef.current + 1;
        if (next > totalSlides(deck)) {
          void runTurn('recap');
          return;
        }
        setSlideId(next);
        slideIdRef.current = next;
        void runTurn('narrate', { slideId: next });
        return;
      }
      if (intent === 'back') {
        const previous = clampSlideId(deck, slideIdRef.current - 1);
        setSlideId(previous);
        slideIdRef.current = previous;
        void runTurn('narrate', { slideId: previous });
        return;
      }
      if (intent === 'repeat') {
        void runTurn('narrate', { slideId: slideIdRef.current });
        return;
      }

      noteQuestion(clean, slideIdRef.current);
      void runTurn('answer', { question: clean });
    },
    [appendEntry, cancelCurrentTurn, deck, noteQuestion, runTurn],
  );

  const interruptTrainer = useCallback(() => {
    cancelCurrentTurn();
    if (phaseRef.current !== 'ended') setPhase('listening');
  }, [cancelCurrentTurn]);

  const slideIndex = useMemo(
    () => deck.slides.findIndex((slide) => slide.id === slideId),
    [deck, slideId],
  );

  return {
    phase,
    slideId,
    slideIndex,
    transcript,
    interim: stt.interim,
    coveredSlideIds,
    learner,
    error,
    micState: stt.state,
    micLevel: stt.level,
    sttTransport: stt.transport,
    transcribing: stt.transcribing,
    trainerSpeaking: tts.speaking,
    audioInaudible: tts.inaudible,
    retryAudio: tts.ensureAudible,
    speechHeld: tts.stall,
    carryOn: tts.carryOn,
    paused,
    pauseSession,
    resumeSession,
    startSession,
    endSession,
    nextSlide,
    previousSlide,
    goToSlide,
    repeatSlide,
    askQuiz,
    askByText,
    interruptTrainer,
    dismissError: () => setError(null),
  };
}
