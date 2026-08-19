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
import type { ChatEvent, HistoryTurn, SessionPhase, TranscriptEntry, TurnKind } from '@/lib/types';

import { useSpeechInput, type SttTransport } from './useSpeechInput';
import { useTtsPlayer } from './useTtsPlayer';

export type ListeningMode = 'hands-free' | 'push-to-talk';

/**
 * A barge-in needs more than one stray syllable, or the trainer gets cut off by
 * a cough or by its own voice leaking through the speakers.
 */
const BARGE_IN_MIN_WORDS = 2;

/** Phrases that mean "carry on" rather than "answer a question". */
const ADVANCE_PATTERNS = [
  /\bnext slide\b/i,
  /\b(?:move|carry|go) on\b/i,
  /\bkeep going\b/i,
  /\bcontinue\b/i,
  /\bwhat'?s next\b/i,
  /\b(?:i'?m |i am )?(?:all )?(?:good|done|clear|fine)(?: with (?:that|this))?\b/i,
  /\bno (?:more )?questions\b/i,
  /\bnothing(?: else)?(?: for now)?\b/i,
  /\bunderstood\b/i,
  /\bmakes sense\b/i,
];

function looksLikeAdvance(text: string): boolean {
  const trimmed = text.trim();
  // A question is never a request to move on, whatever else it contains.
  if (trimmed.includes('?')) return false;
  // Long utterances are almost always substantive, not a nudge to continue.
  if (trimmed.split(/\s+/).length > 8) return false;
  return ADVANCE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

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
  /** Trainer text as it streams in, before playback finishes. */
  streamingReply: string;
  coveredSlideIds: number[];
  error: string | null;
  micState: ReturnType<typeof useSpeechInput>['state'];
  micLevel: number;
  /** Which speech to text transport is live. Null before the session starts. */
  sttTransport: SttTransport | null;
  /** True while a batch utterance is being transcribed. */
  transcribing: boolean;
  trainerSpeaking: boolean;
  listeningMode: ListeningMode;
  pushToTalkActive: boolean;

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
  setListeningMode: (mode: ListeningMode) => void;
  setPushToTalkActive: (active: boolean) => void;
  dismissError: () => void;
}

export function useTrainingSession(): UseTrainingSessionResult {
  const [phase, setPhase] = useState<SessionPhase>('idle');
  const [slideId, setSlideId] = useState(1);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [streamingReply, setStreamingReply] = useState('');
  const [coveredSlideIds, setCoveredSlideIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [listeningMode, setListeningMode] = useState<ListeningMode>('hands-free');
  const [pushToTalkActive, setPushToTalkActive] = useState(false);
  const [traineeName, setTraineeName] = useState<string | undefined>();

  /** Refs mirror state that async callbacks need to read without going stale. */
  const slideIdRef = useRef(1);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const coveredRef = useRef<number[]>([]);
  const traineeNameRef = useRef<string | undefined>(undefined);
  const phaseRef = useRef<SessionPhase>('idle');
  const turnAbortRef = useRef<AbortController | null>(null);
  /** Set while a turn is being generated, so overlapping requests are dropped. */
  const busyRef = useRef(false);
  const listeningModeRef = useRef<ListeningMode>('hands-free');
  const pushToTalkRef = useRef(false);

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
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    listeningModeRef.current = listeningMode;
  }, [listeningMode]);
  useEffect(() => {
    pushToTalkRef.current = pushToTalkActive;
  }, [pushToTalkActive]);
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

      turnAbortRef.current?.abort();
      const controller = new AbortController();
      turnAbortRef.current = controller;

      setStreamingReply('');
      setPhase('thinking');

      let spoken = '';
      let sawText = false;

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
              setStreamingReply(spoken);
              player.push(event.delta);
            } else if (event.type === 'nav') {
              const next = clampSlideId(event.slideId);
              setSlideId(next);
              slideIdRef.current = next;
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          }
        }

        player.flush();
        await player.waitUntilDone();

        const finalText = spoken.trim();
        if (finalText) {
          appendEntry(makeEntry('trainer', finalText, targetSlide));
        }

        if (kind === 'narrate' && !coveredRef.current.includes(targetSlide)) {
          const next = [...coveredRef.current, targetSlide].sort((a, b) => a - b);
          coveredRef.current = next;
          setCoveredSlideIds(next);
        }

        setStreamingReply('');
        setPhase(kind === 'recap' ? 'ended' : 'listening');
      } catch (caught) {
        if ((caught as Error).name !== 'AbortError') {
          setError((caught as Error).message);
          setPhase('error');
        }
      } finally {
        busyRef.current = false;
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
      // In push to talk, only speech captured while the key is held counts.
      if (listeningModeRef.current === 'push-to-talk' && !pushToTalkRef.current) return;

      appendEntry(makeEntry('trainee', clean, slideIdRef.current));

      if (looksLikeAdvance(clean)) {
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

      void runTurn('answer', { question: clean });
    },
    [appendEntry, runTurn],
  );

  /** Cuts the trainer off when the trainee starts talking over it. */
  const handleSpeechStart = useCallback(() => {
    if (listeningModeRef.current === 'push-to-talk' && !pushToTalkRef.current) return;
    if (!ttsRef.current.speaking) return;
    ttsRef.current.interrupt();
    turnAbortRef.current?.abort();
    busyRef.current = false;
    setStreamingReply('');
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
    onError: setError,
  });
  const sttRef = useRef(stt);
  useEffect(() => {
    sttRef.current = stt;
  }, [stt]);

  // In push to talk, the microphone stays muted unless the key is held.
  useEffect(() => {
    if (listeningMode === 'push-to-talk') {
      stt.setMuted(!pushToTalkActive);
    } else {
      stt.setMuted(false);
    }
  }, [listeningMode, pushToTalkActive, stt]);

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

      await runTurn('narrate', { slideId: 1 });
    },
    [runTurn],
  );

  const endSession = useCallback(() => {
    turnAbortRef.current?.abort();
    busyRef.current = false;
    ttsRef.current.interrupt();
    sttRef.current.stop();
    setStreamingReply('');
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
    (question: string) => {
      const clean = question.trim();
      if (!clean) return;
      ttsRef.current.interrupt();
      turnAbortRef.current?.abort();
      busyRef.current = false;
      appendEntry(makeEntry('trainee', clean, slideIdRef.current));
      void runTurn('answer', { question: clean });
    },
    [appendEntry, runTurn],
  );

  const interruptTrainer = useCallback(() => {
    ttsRef.current.interrupt();
    turnAbortRef.current?.abort();
    busyRef.current = false;
    setStreamingReply('');
    if (phaseRef.current !== 'ended') setPhase('listening');
  }, []);

  const slideIndex = useMemo(() => SLIDES.findIndex((slide) => slide.id === slideId), [slideId]);

  return {
    phase,
    slideId,
    slideIndex,
    transcript,
    interim: stt.interim,
    streamingReply,
    coveredSlideIds,
    error,
    micState: stt.state,
    micLevel: stt.level,
    sttTransport: stt.transport,
    transcribing: stt.transcribing,
    trainerSpeaking: tts.speaking,
    listeningMode,
    pushToTalkActive,
    startSession,
    endSession,
    nextSlide,
    previousSlide,
    goToSlide,
    repeatSlide,
    askQuiz,
    askByText,
    interruptTrainer,
    setListeningMode,
    setPushToTalkActive,
    dismissError: () => setError(null),
  };
}
