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

import { clampSlideId, SLIDES, TOTAL_SLIDES } from '@/lib/deck';
import { classifyUtterance } from '@/lib/intent';
import { detectAnswerStyle } from '@/lib/trainer-prompt';
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

export function useTrainingSession(): UseTrainingSessionResult {
  const [phase, setPhase] = useState<SessionPhase>('idle');
  const [slideId, setSlideId] = useState(1);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [coveredSlideIds, setCoveredSlideIds] = useState<number[]>([]);
  const [learner, setLearner] = useState<LearnerProfile>(EMPTY_LEARNER);
  const [error, setError] = useState<string | null>(null);
  const [traineeName, setTraineeName] = useState<string | undefined>();

  /** Refs mirror state that async callbacks need to read without going stale. */
  const slideIdRef = useRef(1);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const coveredRef = useRef<number[]>([]);
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
      busyRef.current = true;

      const targetSlide = clampSlideId(opts.slideId ?? slideIdRef.current);
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
              const next = clampSlideId(event.slideId);
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
        const finalText = spoken.trim();
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
        }

        setPhase(kind === 'recap' ? 'ended' : 'listening');
      } catch (caught) {
        if ((caught as Error).name !== 'AbortError' && isCurrent()) {
          setError((caught as Error).message);
          setPhase('error');
        }
      } finally {
        // Only the turn that still holds the floor may release it.
        if (isCurrent()) busyRef.current = false;
      }
    },
    [appendEntry, buildHistory],
  );

  /** A trainee utterance: either a nudge to continue, or a question to answer. */
  const handleUtterance = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      if (phaseRef.current === 'ended') return;

      appendEntry(makeEntry('trainee', clean, slideIdRef.current));

      // Routing on intent is what stops "please move to the next topic" being
      // treated as a question, answered with "right, let's move on", and leaving
      // the next slide on screen with nobody teaching it.
      const intent = classifyUtterance(clean);

      if (intent === 'advance') {
        const next = slideIdRef.current + 1;
        if (next > TOTAL_SLIDES) {
          void runTurn('recap');
          return;
        }
        setSlideId(next);
        slideIdRef.current = next;
        void runTurn('narrate', { slideId: next });
        return;
      }

      if (intent === 'back') {
        const previous = clampSlideId(slideIdRef.current - 1);
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
    [appendEntry, noteQuestion, runTurn],
  );

  /** Cuts the trainer off when the trainee starts talking over it. */
  const handleSpeechStart = useCallback(() => {
    if (!ttsRef.current.speaking) return;
    ttsRef.current.interrupt();
    turnAbortRef.current?.abort();
    busyRef.current = false;
    setPhase('listening');
  }, []);

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

      setSlideId(1);
      slideIdRef.current = 1;
      setTranscript([]);
      transcriptRef.current = [];
      setCoveredSlideIds([]);
      coveredRef.current = [];
      setLearner(EMPTY_LEARNER);
      learnerRef.current = EMPTY_LEARNER;

      await runTurn('narrate', { slideId: 1 });
    },
    [runTurn],
  );

  const endSession = useCallback(() => {
    turnAbortRef.current?.abort();
    busyRef.current = false;
    ttsRef.current.interrupt();
    sttRef.current.stop();
    setPhase('ended');
  }, []);

  const goToSlide = useCallback(
    (id: number) => {
      const next = clampSlideId(id);
      ttsRef.current.interrupt();
      turnAbortRef.current?.abort();
      busyRef.current = false;
      setSlideId(next);
      slideIdRef.current = next;
      void runTurn('narrate', { slideId: next });
    },
    [runTurn],
  );

  const nextSlide = useCallback(() => {
    const next = slideIdRef.current + 1;
    if (next > TOTAL_SLIDES) {
      ttsRef.current.interrupt();
      turnAbortRef.current?.abort();
      busyRef.current = false;
      void runTurn('recap');
      return;
    }
    goToSlide(next);
  }, [goToSlide, runTurn]);

  const previousSlide = useCallback(() => {
    goToSlide(slideIdRef.current - 1);
  }, [goToSlide]);

  const repeatSlide = useCallback(() => {
    goToSlide(slideIdRef.current);
  }, [goToSlide]);

  const askQuiz = useCallback(() => {
    ttsRef.current.interrupt();
    turnAbortRef.current?.abort();
    busyRef.current = false;
    void runTurn('quiz');
  }, [runTurn]);

  const askByText = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      ttsRef.current.interrupt();
      turnAbortRef.current?.abort();
      busyRef.current = false;
      appendEntry(makeEntry('trainee', clean, slideIdRef.current));

      // Typing "next slide" should do what saying it does, so this goes through
      // the same intent routing rather than always being treated as a question.
      const intent = classifyUtterance(clean);

      if (intent === 'advance') {
        const next = slideIdRef.current + 1;
        if (next > TOTAL_SLIDES) {
          void runTurn('recap');
          return;
        }
        setSlideId(next);
        slideIdRef.current = next;
        void runTurn('narrate', { slideId: next });
        return;
      }
      if (intent === 'back') {
        const previous = clampSlideId(slideIdRef.current - 1);
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
    [appendEntry, noteQuestion, runTurn],
  );

  const interruptTrainer = useCallback(() => {
    ttsRef.current.interrupt();
    turnAbortRef.current?.abort();
    busyRef.current = false;
    if (phaseRef.current !== 'ended') setPhase('listening');
  }, []);

  const slideIndex = useMemo(() => SLIDES.findIndex((slide) => slide.id === slideId), [slideId]);

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
