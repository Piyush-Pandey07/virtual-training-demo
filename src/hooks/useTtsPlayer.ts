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
 * Because every sentence becomes a Web Audio buffer on a shared timeline, a barge-in
 * is exact: stop the scheduled sources, drop the queue, and abort any synthesis still
 * in flight.
 *
 * Built for connections that do not hold (AI-10). Speech is fetched as MP3, about an
 * eighth of the size of raw PCM; English is fetched up to SPEECH_AHEAD sentences ahead
 * of the one playing; every request has a deadline and one quick retry; and a sentence
 * that still cannot be fetched pauses the trainer on that sentence instead of skipping
 * it. The pause shows as `stall`, retries on its own as the connection allows, and
 * carries on from the same sentence, word for word, with nothing generated again. A
 * turn is only finished, and so a slide only taught, once every sentence has played.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { AUDIO_SAMPLE_RATE } from '@/lib/config';
import type { Failure } from '@/lib/failures/codes';
import { reportFailure } from '@/lib/failures/report-client';
import { pcmToFloat } from '@/lib/pcm';
import { nextSpeechCut, sanitiseForSpeech } from '@/lib/speech';
import type { SessionLanguage } from '@/lib/types';
import { fetchSpeech, stallRetryDelayMs } from '@/lib/voice/fetch-speech';

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

/**
 * How many English sentences may be downloading at once.
 *
 * One at a time meant the next sentence only started downloading when the one before it
 * had arrived, so on a slow link any sentence that took longer to fetch than its
 * predecessor took to say was heard as a gap. Two in flight gives a sentence of slack.
 * Not more: synthesis is billed whether or not it is heard, and a trainee who presses
 * Next throws away whatever was fetched ahead.
 */
const SPEECH_AHEAD = 2;

/** A sentence waiting to be heard, and its audio once asked for. */
interface QueuedSpeech {
  text: string;
  generation: number;
  audio: Promise<LoadedSpeech> | null;
}

type LoadedSpeech =
  | { ok: true; buffer: AudioBuffer }
  | { ok: false; aborted: true }
  | { ok: false; aborted: false; failure: Failure; kind: string };

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
  /**
   * Set while the trainer is held on a sentence it could not fetch, with the standard
   * message to show. Null otherwise. See the comment at the top of this file.
   */
  stall: Failure | null;
  /** Tries the held sentence again now, from a click. Does nothing when not held. */
  carryOn: () => void;
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
  /** Named in reports to the developer log, so a dropout can be tied to a deck. */
  deckId?: string;
}

export function useTtsPlayer(options: Options = {}): UseTtsPlayerResult {
  const [speaking, setSpeaking] = useState(false);
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
  const [stall, setStall] = useState<Failure | null>(null);

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
  /** Cancels every download of the current generation at once. */
  const abortRef = useRef<AbortController | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  /** Incremented on every interrupt, so in-flight work knows it is stale. */
  const generationRef = useRef(0);
  const pendingCountRef = useRef(0);
  const doneWaitersRef = useRef<Array<() => void>>([]);
  /** Sentences enqueued and not yet scheduled, in order, for fetching ahead. */
  const queueRef = useRef<QueuedSpeech[]>([]);
  const inFlightRef = useRef(0);
  /**
   * How the current hold ends: `true` to try the sentence again, `false` because the turn
   * was interrupted. Null when nothing is held.
   *
   * There is only ever one hold. Sentences play in order, so the first that cannot be
   * fetched holds everything behind it, which is what keeps a slide from carrying on
   * with a gap in it.
   */
  const releaseStallRef = useRef<((retry: boolean) => void) | null>(null);
  /**
   * Whether to ask for MP3. Cleared for the rest of the session if a browser cannot
   * decode it, which no current browser should, but a silent session is the failure
   * this file exists to prevent, so raw PCM is kept as the way back.
   */
  const compressedRef = useRef(true);

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
    queueRef.current = [];
    inFlightRef.current = 0;

    abortRef.current?.abort();
    abortRef.current = null;

    // A held sentence belongs to the turn being thrown away, so the hold goes with it.
    releaseStallRef.current?.(false);
    releaseStallRef.current = null;
    setStall(null);

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

  /** The cancel switch for this generation's downloads, made on first use. */
  const downloadSignal = useCallback((): AbortSignal => {
    if (!abortRef.current || abortRef.current.signal.aborted) {
      abortRef.current = new AbortController();
    }
    return abortRef.current.signal;
  }, []);

  /** Fetches one sentence and turns it into a buffer the timeline can play. */
  const loadSpeech = useCallback(
    async (text: string, generation: number): Promise<LoadedSpeech> => {
      const voice = voiceRef.current;
      const compressed = compressedRef.current;
      const fetched = await fetchSpeech(
        {
          text,
          // No voice field at all when none was chosen, so the server's default applies
          // exactly as it did before there was a choice.
          ...(voice ? { voice } : {}),
          ...(compressed ? { format: 'mp3' as const } : {}),
        },
        downloadSignal(),
      );
      if (!fetched.ok) return fetched;
      if (generation !== generationRef.current) return { ok: false, aborted: true };

      const context = getContext();
      if (fetched.format === 'pcm') {
        // Convert signed 16-bit PCM into the float buffer Web Audio expects.
        const samples = pcmToFloat(fetched.bytes);
        const buffer = context.createBuffer(1, Math.max(1, samples.length), AUDIO_SAMPLE_RATE);
        buffer.copyToChannel(samples, 0);
        return { ok: true, buffer };
      }
      try {
        // Resampled to the context's rate as it is decoded, so it joins the timeline
        // exactly as PCM does.
        return { ok: true, buffer: await context.decodeAudioData(fetched.bytes) };
      } catch (error) {
        compressedRef.current = false;
        reportFailure({
          area: 'speech',
          kind: 'mp3-decode',
          code: 'unavailable',
          detail: `Could not decode MP3, so PCM from now on: ${(error as Error).message}`,
          deckId: optionsRef.current.deckId,
          language: languageRef.current,
        });
        return loadSpeech(text, generation);
      }
    },
    [downloadSignal, getContext],
  );

  /** Fetching ahead runs from a finished download, so it is reached through a ref. */
  const fetchAheadRef = useRef<() => void>(() => undefined);

  /** Starts a sentence downloading if it is not already, and returns its result. */
  const startLoading = useCallback(
    (item: QueuedSpeech): Promise<LoadedSpeech> => {
      if (item.audio) return item.audio;
      inFlightRef.current += 1;
      item.audio = loadSpeech(item.text, item.generation).finally(() => {
        // A download from a turn already thrown away was not counted in this one.
        if (item.generation === generationRef.current) {
          inFlightRef.current = Math.max(0, inFlightRef.current - 1);
        }
        fetchAheadRef.current();
      });
      return item.audio;
    },
    [loadSpeech],
  );

  /**
   * Starts English sentences downloading ahead of the one playing, up to SPEECH_AHEAD.
   *
   * Hindi never fetches ahead: it is paced to playback by waitForRoom to protect Sarvam's
   * prepaid credit, and its next sentence is asked for only when there is room for it.
   */
  const fetchAhead = useCallback(() => {
    if (languageRef.current === 'hi') return;
    for (const item of queueRef.current) {
      if (inFlightRef.current >= SPEECH_AHEAD) return;
      if (item.generation === generationRef.current && !item.audio) void startLoading(item);
    }
  }, [startLoading]);

  useEffect(() => {
    fetchAheadRef.current = fetchAhead;
  }, [fetchAhead]);

  /**
   * Holds the trainer on a sentence that could not be fetched, until it is worth trying
   * again: on a timer that backs off, the moment the browser says it is back online, or
   * when the trainee presses Try now. Resolves false if the turn is interrupted instead.
   */
  const holdOn = useCallback(
    (failure: Failure, generation: number, stalls: number): Promise<boolean> =>
      new Promise((resolve) => {
        if (generation !== generationRef.current) {
          resolve(false);
          return;
        }
        setStall(failure);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const release = (retry: boolean) => {
          clearTimeout(timer);
          window.removeEventListener('online', onOnline);
          if (releaseStallRef.current === release) releaseStallRef.current = null;
          resolve(retry);
        };
        const onOnline = () => release(true);
        releaseStallRef.current = release;
        window.addEventListener('online', onOnline);
        const delay = stallRetryDelayMs(stalls, failure);
        if (delay !== null) timer = setTimeout(() => release(true), delay);
      }),
    [],
  );

  const carryOn = useCallback(() => {
    releaseStallRef.current?.(true);
  }, []);

  /**
   * Gets one sentence's audio, holding on it until it arrives, and schedules it.
   *
   * Sentences reach here one at a time and in order, through the chain in enqueue, so
   * while one is held nothing behind it can play, and the turn does not finish. That is
   * what makes "taught" mean every sentence was heard.
   */
  const speakChunk = useCallback(
    async (item: QueuedSpeech) => {
      const { generation } = item;
      if (generation !== generationRef.current) return;

      // Hindi only, and see HINDI_LOOKAHEAD_SECONDS for why. English goes straight on.
      if (languageRef.current === 'hi') {
        await waitForRoom(generation);
        if (generation !== generationRef.current) return;
      }

      let loaded: LoadedSpeech;
      let stalls = 0;
      const startedAt = Date.now();
      for (;;) {
        loaded = await startLoading(item);
        if (generation !== generationRef.current) return;
        if (loaded.ok || loaded.aborted) break;

        if (stalls === 0) {
          // Reported when the hold starts, which is usually while the connection is
          // down, so the report waits in the browser and goes when it comes back.
          reportFailure({
            area: 'speech',
            kind: loaded.kind,
            code: loaded.failure.code,
            detail: `Held on a sentence of ${item.text.length} characters (${compressedRef.current ? 'MP3' : 'PCM'}).`,
            deckId: optionsRef.current.deckId,
            language: languageRef.current,
          });
        }
        const retry = await holdOn(loaded.failure, generation, stalls);
        stalls += 1;
        if (!retry || generation !== generationRef.current) return;
        item.audio = null;
      }
      if (!loaded.ok) return;

      if (stalls > 0) {
        setStall(null);
        const held = Math.round((Date.now() - startedAt) / 1000);
        reportFailure({
          area: 'speech',
          kind: 'recovered',
          code: 'connection',
          detail: `Carried on after ${held} s and ${stalls} ${stalls === 1 ? 'hold' : 'holds'}.`,
          deckId: optionsRef.current.deckId,
          language: languageRef.current,
        });
      }

      queueRef.current = queueRef.current.filter((queued) => queued !== item);
      fetchAhead();

      const context = getContext();
      // Checked before scheduling rather than after. Scheduling into a suspended
      // context is what produces the silent session, so the warning has to be raised
      // at the moment the audio would have been heard and was not.
      await ensureAudible();

      if (generation !== generationRef.current) return;

      const source = context.createBufferSource();
      source.buffer = loaded.buffer;
      source.connect(context.destination);

      // Never schedule in the past, or the browser drops the buffer silently.
      const startAt = Math.max(playheadRef.current, context.currentTime + SCHEDULE_LEAD_SECONDS);
      source.start(startAt);
      playheadRef.current = startAt + loaded.buffer.duration;

      sourcesRef.current.add(source);
      setSpeaking(true);

      source.onended = () => {
        sourcesRef.current.delete(source);
        source.disconnect();
        settleIfIdle();
      };
    },
    [ensureAudible, fetchAhead, getContext, holdOn, settleIfIdle, startLoading, waitForRoom],
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
      const item: QueuedSpeech = { text: trimmed, generation, audio: null };
      queueRef.current.push(item);
      pendingCountRef.current += 1;
      setSpeaking(true);
      fetchAhead();

      chainRef.current = chainRef.current
        .then(() => speakChunk(item))
        .catch(() => undefined)
        .finally(() => {
          if (generation === generationRef.current) {
            pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
            settleIfIdle();
          }
        });
    },
    [fetchAhead, speakChunk, settleIfIdle],
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
      releaseStallRef.current?.(false);
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
    // What `error` always meant, nothing to play, is now a hold with a message.
    error: stall?.message ?? null,
    inaudible,
    stall,
    carryOn,
    ensureAudible,
    pause,
    resume,
    setVoice,
    setLanguage,
  };
}
