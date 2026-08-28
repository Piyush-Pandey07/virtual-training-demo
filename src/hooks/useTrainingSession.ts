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
import type {
  ChatEvent,
  HistoryTurn,
  LearnerProfile,
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
  micState: ReturnType<typeof useSpeechInput>['state'];
  micLevel: number;
  /** Which speech to text transport is live. Null before the session starts. */
  sttTransport: SttTransport | null;
  /** True while a batch utterance is being transcribed. */
  transcribing: boolean;
  trainerSpeaking: boolean;

  startSession: (traineeName?: string) => Promise<void>;
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

  const tts = useTtsPlayer({ onError: setError });
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
  const runTurn = useCallback(
    async (kind: TurnKind, opts: { question?: string; slideId?: number } = {}) => {
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

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `The trainer could not reply (${response.status}).`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

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
              throw new Error(event.message);
            }
          }
        }

        player.flush();
        await player.waitUntilDone();

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
      } catch (caught) {
        // An interrupted turn still said something, and the model needs it as
        // context: without this the trainee's next question is answered as though
        // the last half-minute of narration never happened.
        const partial = sanitiseForSpeech(spoken);
        if ((caught as Error).name === 'AbortError' && partial) {
          appendEntry(makeEntry('trainer', partial, targetSlide));
        }
        if ((caught as Error).name !== 'AbortError' && isCurrent()) {
          setError((caught as Error).message);
          setPhase('error');
        }
      } finally {
        // Only the turn that still holds the floor may release it.
        if (isCurrent()) busyRef.current = false;
      }
    },
    [appendEntry, buildHistory, deck],
  );

  /** A trainee utterance: either a nudge to continue, or a question to answer. */
  const handleUtterance = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      if (phaseRef.current === 'ended') return;

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

  const startSession = useCallback(
    async (name?: string) => {
      setError(null);
      setPhase('connecting');
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
