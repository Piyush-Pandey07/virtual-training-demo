'use client';

/**
 * Speech playback for the trainer.
 *
 * The trainer's reply arrives from Gemini as a token stream. Waiting for the
 * whole reply before speaking would add seconds of dead air, so text is cut into
 * sentences and each sentence is sent for synthesis as soon as it is complete.
 * Audio is scheduled back to back on a single AudioContext timeline, which keeps
 * the joins between sentences inaudible.
 *
 * Because it is raw PCM on a shared timeline, a barge-in is exact: stop the
 * scheduled sources, drop the queue, and abort any synthesis still in flight.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { AUDIO_SAMPLE_RATE } from '@/lib/config';
import { sanitiseForSpeech } from '@/lib/speech';

/** Below this, a fragment is too short to be worth its own request. */
const MIN_CHUNK_CHARS = 60;

/** Above this we flush regardless, so a long clause never stalls playback. */
const MAX_CHUNK_CHARS = 320;

/** Small lead time so the first buffer is queued before the clock reaches it. */
const SCHEDULE_LEAD_SECONDS = 0.08;

export interface UseTtsPlayerResult {
  /** True from the first scheduled buffer until the last one finishes. */
  speaking: boolean;
  /** Feed streamed text in. Complete sentences are spoken as they appear. */
  push: (text: string) => void;
  /** Speak whatever is left in the buffer, then stop. */
  flush: () => void;
  /** Cut playback off immediately and discard everything pending. */
  interrupt: () => void;
  /** Resolves once everything queued has finished playing. */
  waitUntilDone: () => Promise<void>;
  /** Unlocks audio playback. Must be called from a user gesture. */
  unlock: () => Promise<void>;
  error: string | null;
}

interface Options {
  onError?: (message: string) => void;
}

export function useTtsPlayer(options: Options = {}): UseTtsPlayerResult {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contextRef = useRef<AudioContext | null>(null);
  /** Next free moment on the audio timeline. */
  const playheadRef = useRef(0);
  /** Text received but not yet sent for synthesis. */
  const bufferRef = useRef('');
  /** Serialises synthesis so sentences are spoken in order. */
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const abortRef = useRef<AbortController | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  /** Incremented on every interrupt, so in-flight work knows it is stale. */
  const generationRef = useRef(0);
  const pendingCountRef = useRef(0);
  const doneWaitersRef = useRef<Array<() => void>>([]);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const getContext = useCallback(() => {
    if (!contextRef.current || contextRef.current.state === 'closed') {
      contextRef.current = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
      playheadRef.current = 0;
    }
    return contextRef.current;
  }, []);

  const unlock = useCallback(async () => {
    const context = getContext();
    if (context.state === 'suspended') {
      await context.resume().catch(() => undefined);
    }
  }, [getContext]);

  const settleIfIdle = useCallback(() => {
    if (pendingCountRef.current > 0 || sourcesRef.current.size > 0) return;
    setSpeaking(false);
    const waiters = doneWaitersRef.current;
    doneWaitersRef.current = [];
    waiters.forEach((resolve) => resolve());
  }, []);

  const interrupt = useCallback(() => {
    generationRef.current += 1;
    pendingCountRef.current = 0;
    bufferRef.current = '';
    chainRef.current = Promise.resolve();

    abortRef.current?.abort();
    abortRef.current = null;

    sourcesRef.current.forEach((source) => {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already finished. Nothing to stop.
      }
      source.disconnect();
    });
    sourcesRef.current.clear();

    const context = contextRef.current;
    playheadRef.current = context ? context.currentTime : 0;

    setSpeaking(false);
    const waiters = doneWaitersRef.current;
    doneWaitersRef.current = [];
    waiters.forEach((resolve) => resolve());
  }, []);

  /** Fetches audio for one fragment and schedules it on the timeline. */
  const speakChunk = useCallback(
    async (text: string, generation: number) => {
      if (generation !== generationRef.current) return;

      const controller = new AbortController();
      abortRef.current = controller;

      let pcm: ArrayBuffer;
      try {
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Text to speech failed with ${response.status}.`);
        }

        pcm = await response.arrayBuffer();
      } catch (caught) {
        if ((caught as Error).name === 'AbortError') return;
        const message = (caught as Error).message;
        setError(message);
        optionsRef.current.onError?.(message);
        return;
      }

      // The listener interrupted while this was downloading.
      if (generation !== generationRef.current) return;
      if (pcm.byteLength < 2) return;

      const context = getContext();
      if (context.state === 'suspended') {
        await context.resume().catch(() => undefined);
      }

      // Convert signed 16-bit PCM into the float buffer Web Audio expects.
      const samples = new Int16Array(pcm, 0, Math.floor(pcm.byteLength / 2));
      const audioBuffer = context.createBuffer(1, samples.length, AUDIO_SAMPLE_RATE);
      const channel = audioBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) {
        channel[i] = samples[i] / 0x8000;
      }

      if (generation !== generationRef.current) return;

      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(context.destination);

      // Never schedule in the past, or the browser drops the buffer silently.
      const startAt = Math.max(playheadRef.current, context.currentTime + SCHEDULE_LEAD_SECONDS);
      source.start(startAt);
      playheadRef.current = startAt + audioBuffer.duration;

      sourcesRef.current.add(source);
      setSpeaking(true);

      source.onended = () => {
        sourcesRef.current.delete(source);
        source.disconnect();
        settleIfIdle();
      };
    },
    [getContext, settleIfIdle],
  );

  const enqueue = useCallback(
    (text: string) => {
      /**
       * The last gate before text becomes audio.
       *
       * Sanitising used to happen only on the server, into a `done` event the
       * client never read, so every markdown asterisk and stray dash the model
       * produced was spoken aloud. Doing it here catches both paths into the
       * queue, and it happens after drain() has assembled a whole clause, so the
       * line-anchored and space-sensitive rules see the context they need.
       */
      const trimmed = sanitiseForSpeech(text);
      if (!trimmed) return;

      const generation = generationRef.current;
      pendingCountRef.current += 1;
      setSpeaking(true);

      chainRef.current = chainRef.current
        .then(() => speakChunk(trimmed, generation))
        .catch(() => undefined)
        .finally(() => {
          if (generation === generationRef.current) {
            pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
            settleIfIdle();
          }
        });
    },
    [speakChunk, settleIfIdle],
  );

  /**
   * Pulls complete fragments off the buffer. Splits on sentence endings, and
   * falls back to a clause break once a fragment grows too long to hold.
   */
  const drain = useCallback(() => {
    for (;;) {
      const buffer = bufferRef.current;
      if (buffer.length < MIN_CHUNK_CHARS) return;

      // A sentence ending followed by whitespace is a safe split point.
      const sentenceEnd = /[.!?](?=\s)/g;
      let cut = -1;
      let match: RegExpExecArray | null;
      while ((match = sentenceEnd.exec(buffer)) !== null) {
        if (match.index + 1 >= MIN_CHUNK_CHARS) {
          cut = match.index + 1;
          break;
        }
      }

      // Nothing to split on yet, but the fragment is long enough that waiting
      // would be audible. Break at the last comma instead.
      if (cut === -1 && buffer.length >= MAX_CHUNK_CHARS) {
        const comma = buffer.lastIndexOf(', ', MAX_CHUNK_CHARS);
        cut = comma > MIN_CHUNK_CHARS ? comma + 1 : MAX_CHUNK_CHARS;
      }

      if (cut === -1) return;

      enqueue(buffer.slice(0, cut));
      bufferRef.current = buffer.slice(cut).trimStart();
    }
  }, [enqueue]);

  const push = useCallback(
    (text: string) => {
      if (!text) return;
      bufferRef.current += text;
      drain();
    },
    [drain],
  );

  const flush = useCallback(() => {
    const remaining = bufferRef.current.trim();
    bufferRef.current = '';
    if (remaining) enqueue(remaining);
  }, [enqueue]);

  const waitUntilDone = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (pendingCountRef.current === 0 && sourcesRef.current.size === 0) {
          resolve();
          return;
        }
        doneWaitersRef.current.push(resolve);
      }),
    [],
  );

  useEffect(
    () => () => {
      generationRef.current += 1;
      abortRef.current?.abort();
      sourcesRef.current.forEach((source) => {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      });
      sourcesRef.current.clear();
      void contextRef.current?.close().catch(() => undefined);
      contextRef.current = null;
    },
    [],
  );

  return { speaking, push, flush, interrupt, waitUntilDone, unlock, error };
}
