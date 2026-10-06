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
import { pcmToFloat } from '@/lib/pcm';
import { nextSpeechCut, sanitiseForSpeech } from '@/lib/speech';
import type { SessionLanguage } from '@/lib/types';

/** Small lead time so the first buffer is queued before the clock reaches it. */
const SCHEDULE_LEAD_SECONDS = 0.08;

/**
 * How far ahead of the listener Hindi is synthesised, in seconds of audio.
 *
 * English is synthesised as fast as the text arrives, as it always was. Hindi is held
 * back until what is already queued runs this low, for two reasons that both come from
 * Sarvam's account rather than from the audio:
 *
 * Sarvam bills every character it speaks, heard or not, from a small prepaid credit.
 * Synthesising a whole slide up front meant that a trainee pressing Next ten seconds in
 * paid for the other eighty seconds of narration all the same. Held to this margin, an
 * interruption wastes at most the sentence playing and the one after it.
 *
 * And its starter plan allows thirty requests a minute. Paced by playback, a session
 * makes a handful.
 *
 * Six seconds is comfortably more than Sarvam takes to answer for one sentence, so the
 * pacing is never heard as a gap.
 */
const HINDI_LOOKAHEAD_SECONDS = 6;

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
  /**
   * True when audio has been scheduled that the trainee cannot hear.
   *
   * Distinct from `error`, which means synthesis failed and there is nothing to play.
   * This means speech arrived and the browser will not let it out, which is worse
   * because everything else looks normal.
   */
  inaudible: boolean;
  /** Retries playback from a user gesture. Resolves true if audio can now be heard. */
  ensureAudible: () => Promise<boolean>;
  /**
   * Freezes playback exactly where it is, mid-word if need be. Nothing queued is
   * dropped or synthesised again, and speech that arrives while paused waits behind it.
   */
  pause: () => Promise<void>;
  /**
   * Carries on from exactly where `pause` stopped. Call it from the click that asked,
   * since that click is the gesture a browser wants before it will play anything.
   */
  resume: () => Promise<boolean>;
  /**
   * The voice every sentence from here on is spoken in, as an id from /api/voices.
   * Undefined speaks in the deployment's default.
   */
  setVoice: (voice: string | undefined) => void;
  /** The language being spoken, which decides how far ahead speech is synthesised. */
  setLanguage: (language: SessionLanguage) => void;
}

interface Options {
  onError?: (message: string) => void;
}

export function useTtsPlayer(options: Options = {}): UseTtsPlayerResult {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * True when audio was scheduled that nobody can hear.
   *
   * A suspended AudioContext accepts everything: `createBufferSource`, `start`, the
   * whole timeline. It simply never advances, so no `onended` ever fires, and a slide
   * is only marked taught once its narration finishes. The trainee watches slides in
   * silence, the deck bills for speech that was synthesised, and their progress stays
   * at zero with nothing on screen saying why.
   *
   * Two real sessions ended that way before this existed. The cause is usually a
   * browser refusing playback without a gesture it recognises, which is why the fix is
   * a button: a click is the gesture, and resuming on one works.
   */
  const [inaudible, setInaudible] = useState(false);

  /**
   * Suspended because the trainee asked, as opposed to held back by the browser.
   *
   * Both look identical from inside: the context reports `suspended` either way. The
   * difference matters in exactly one place, `ensureAudible`, which runs before every
   * sentence is scheduled. Without this it would see a paused timeline and either
   * resume it, undoing the pause from inside the playback loop, or fail to and raise
   * "You will not hear the trainer" over a session that is quiet on purpose.
   */
  const pausedRef = useRef(false);

  /** Read by every synthesis request. Set by the session, once, as it starts. */
  const voiceRef = useRef<string | undefined>(undefined);
  const setVoice = useCallback((voice: string | undefined) => {
    voiceRef.current = voice;
  }, []);

  /** Set with the voice, once, as the session starts. */
  const languageRef = useRef<SessionLanguage>('en');
  const setLanguage = useCallback((language: SessionLanguage) => {
    languageRef.current = language;
  }, []);

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

  /**
   * Brings the audio timeline up, and reports whether it actually came up.
   *
   * `resume()` rejecting is not the only failure: it can resolve while the context
   * stays suspended, so the state is read afterwards rather than the promise trusted.
   */
  const ensureAudible = useCallback(async (): Promise<boolean> => {
    // A deliberate pause is not a failure to be heard. Leave the timeline frozen and
    // the warning down: anything scheduled now waits behind the pause and plays the
    // moment the trainee carries on.
    if (pausedRef.current) return false;

    const context = getContext();
    if (context.state === 'suspended') {
      await context.resume().catch(() => undefined);
    }
    const running = context.state === 'running';
    setInaudible(!running);
    return running;
  }, [getContext]);

  const unlock = useCallback(async () => {
    await ensureAudible();
  }, [ensureAudible]);

  /**
   * Pause and resume, one at a time.
   *
   * `suspend()` is asynchronous. Without this, Pause then Play pressed quickly let the
   * resume run while the suspend was still pending; the suspend then landed second and
   * froze a timeline the player believed was running. At the end of a slide nothing
   * else comes along to restart it, so the session simply stopped.
   */
  const transitionRef = useRef<Promise<unknown>>(Promise.resolve());

  const pause = useCallback((): Promise<void> => {
    // Set now rather than in turn, so a sentence scheduled during the transition is
    // already treated as held.
    pausedRef.current = true;
    // Whatever the browser was doing before, the silence from here on is chosen. A
    // warning left up across a pause would tell the trainee their sound is broken
    // while they are the one who turned it off.
    setInaudible(false);
    const next = transitionRef.current.then(async () => {
      const context = contextRef.current;
      if (pausedRef.current && context && context.state === 'running') {
        await context.suspend().catch(() => undefined);
      }
    });
    transitionRef.current = next.catch(() => undefined);
    return next;
  }, []);

  const resume = useCallback((): Promise<boolean> => {
    const next = transitionRef.current.then(() => {
      pausedRef.current = false;
      // Through ensureAudible rather than around it, so that if the browser refuses to
      // come back, the trainee is told, exactly as for any other silence.
      return ensureAudible();
    });
    transitionRef.current = next.catch(() => undefined);
    return next;
  }, [ensureAudible]);

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

    // Everything a pause was holding has just been thrown away, so the pause goes
    // with it. The empty timeline is restarted quietly rather than through
    // ensureAudible: there is nothing to hear, so nothing to warn about, and a session
    // stopped while paused must not end on "You will not hear the trainer".
    if (pausedRef.current) {
      pausedRef.current = false;
      void context?.resume().catch(() => undefined);
    }

    setSpeaking(false);
    const waiters = doneWaitersRef.current;
    doneWaitersRef.current = [];
    waiters.forEach((resolve) => resolve());
  }, []);

  /**
   * Waits until the audio already queued has run down to the lookahead.
   *
   * Polls rather than computing one delay, because the clock it reads stops while the
   * session is paused and starts again on Play, and because an interruption has to end
   * the wait as promptly as it ends everything else.
   */
  const waitForRoom = useCallback(async (generation: number) => {
    for (;;) {
      if (generation !== generationRef.current) return;
      const context = contextRef.current;
      const ahead = context ? playheadRef.current - context.currentTime : 0;
      if (ahead <= HINDI_LOOKAHEAD_SECONDS) return;
      const ms = Math.min(1000, (ahead - HINDI_LOOKAHEAD_SECONDS) * 1000 + 50);
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
  }, []);

  /** Fetches audio for one fragment and schedules it on the timeline. */
  const speakChunk = useCallback(
    async (text: string, generation: number) => {
      if (generation !== generationRef.current) return;

      // Hindi only, and see HINDI_LOOKAHEAD_SECONDS for why. English goes straight on.
      if (languageRef.current === 'hi') {
        await waitForRoom(generation);
        if (generation !== generationRef.current) return;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      let pcm: ArrayBuffer;
      try {
        const voice = voiceRef.current;
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // No voice field at all when none was chosen, so the server's default applies
          // exactly as it did before there was a choice.
          body: JSON.stringify(voice ? { text, voice } : { text }),
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
      // Checked before scheduling rather than after. Scheduling into a suspended
      // context is what produces the silent session, so the warning has to be raised
      // at the moment the audio would have been heard and was not.
      await ensureAudible();

      // Convert signed 16-bit PCM into the float buffer Web Audio expects.
      const samples = pcmToFloat(pcm);
      const audioBuffer = context.createBuffer(1, samples.length, AUDIO_SAMPLE_RATE);
      audioBuffer.copyToChannel(samples, 0);

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
    [ensureAudible, getContext, settleIfIdle, waitForRoom],
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
      const cut = nextSpeechCut(buffer);
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

  return {
    speaking,
    push,
    flush,
    interrupt,
    waitUntilDone,
    unlock,
    error,
    inaudible,
    ensureAudible,
    pause,
    resume,
    setVoice,
    setLanguage,
  };
}
