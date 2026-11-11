'use client';

/**
 * Speech to text, over whichever transport the Deepgram key supports.
 *
 * `stream` is preferred. The browser opens a WebSocket straight to Deepgram
 * using a short-lived token minted by the server, which gives live partial
 * transcripts as the trainee speaks.
 *
 * `batch` is the fallback for keys that cannot mint those tokens, which needs no
 * extra permissions beyond speech itself. The end of an utterance is detected
 * locally, then the buffered audio is posted to /api/stt. There are no partial
 * transcripts, and the transcript lands a moment after the trainee stops
 * speaking, but the account key never leaves the server either way.
 *
 * The transport is chosen once, on start, by asking the server for a token.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { CAPTURE_SAMPLE_RATE } from '@/lib/config';
import { LISTENING_LOST, describeFailure, readFailure } from '@/lib/failures/codes';
import { reportFailure } from '@/lib/failures/report-client';
import { listeningLanguage } from '@/lib/language';
import type { DeepgramTokenResponse, MicState, SessionLanguage } from '@/lib/types';

import { CHUNK_MS, useMicCapture, type MicChunk } from './useMicCapture';

export type SttTransport = 'stream' | 'batch';

/** Deepgram closes an idle socket, so keep it warm well inside that window. */
const KEEPALIVE_MS = 8_000;

/** Silence in milliseconds before Deepgram finalises an utterance. */
const ENDPOINTING_MS = 400;

/** How long Deepgram waits before emitting UtteranceEnd. */
const UTTERANCE_END_MS = 1_000;

/**
 * How often live audio is reported to usage metering while the socket stays open.
 *
 * It is also reported whenever the socket closes, which covers pausing, stopping and
 * leaving. This is the backstop for a tab that dies without closing anything.
 */
const STREAM_REPORT_MS = 60_000;

// ---------------------------------------------------------------------------
// Voice activity detection, used by the batch transport only.
// ---------------------------------------------------------------------------

/** Loudness above which a chunk counts as speech. */
const VAD_SPEECH_RMS = 0.02;

/** Silence after speech before the utterance is considered finished. */
const VAD_HANGOVER_MS = 700;

/** Audio kept before the onset, so the first sound is not clipped. */
const VAD_PREROLL_CHUNKS = 5;

/** Discard anything shorter than this once trimmed. */
const VAD_MIN_SPEECH_MS = 250;

/**
 * Consecutive speech chunks before speech is declared. Rejects clicks and coughs.
 *
 * Derived from the floor above rather than set independently, because declaring
 * speech is what cuts the trainer off mid-sentence. These were 3 chunks (192 ms)
 * against a 250 ms floor, leaving a 58 ms window where a throat clear was loud
 * enough to stop the narration and then too short to be transcribed, so the
 * trainee lost the rest of the slide and got nothing in return. Deriving one from
 * the other means any onset that interrupts is always long enough to be sent.
 */
const VAD_ONSET_CHUNKS = Math.ceil(VAD_MIN_SPEECH_MS / CHUNK_MS);

/** Flush regardless past this length, so a stuck detector cannot buffer forever. */
const VAD_MAX_UTTERANCE_MS = 30_000;

/** One quick retry for an utterance that did not reach the server. */
const STT_RETRY_DELAY_MS = 1000;

/**
 * How long after falling back to short bursts the live connection is tried again.
 *
 * Bursts work, but every utterance waits for the whole of itself to upload and there
 * are no live captions, so live transcription is worth getting back once whatever broke
 * it has passed. A few attempts only: a key that cannot mint browser tokens fails the
 * same way every time.
 */
const STREAM_REOPEN_MS = 20_000;
const MAX_STREAM_REOPENS = 3;

export interface UseSpeechInputOptions {
  /** Called with a complete utterance once the speaker has stopped. */
  onUtterance: (text: string) => void;
  /** Called on every partial result. Streaming transport only. */
  onInterim?: (text: string) => void;
  /** Called as soon as speech is detected, so the trainer can be cut off. */
  onSpeechStart?: () => void;
  onError?: (message: string) => void;
}

export interface UseSpeechInputResult {
  state: MicState;
  level: number;
  interim: string;
  /** Which transport is in use. Null until the session starts. */
  transport: SttTransport | null;
  /** True while a batch utterance is being transcribed. */
  transcribing: boolean;
  /** Resolves true once the microphone is open, and false if it did not open. */
  start: () => Promise<boolean>;
  stop: () => void;
  setMuted: (muted: boolean) => void;
  /** What the trainee is expected to speak. Set once, before the session first starts. */
  setLanguage: (language: SessionLanguage) => void;
  /** Words to listen hard for, such as the deck's acronyms. Set before the session starts. */
  setKeyterms: (terms: string[]) => void;
}

interface DeepgramTranscriptMessage {
  type?: string;
  channel?: { alternatives?: Array<{ transcript?: string }> };
  is_final?: boolean;
  speech_final?: boolean;
}

export function useSpeechInput(options: UseSpeechInputOptions): UseSpeechInputResult {
  const [interim, setInterim] = useState('');
  const [transport, setTransport] = useState<SttTransport | null>(null);
  const [transcribing, setTranscribing] = useState(false);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const transportRef = useRef<SttTransport | null>(null);
  const stoppingRef = useRef(false);

  /** Read each time a transport opens, so Play after a pause listens the same way. */
  const languageRef = useRef<SessionLanguage>('en');
  const setLanguage = useCallback((language: SessionLanguage) => {
    languageRef.current = language;
  }, []);

  /**
   * Words to listen hard for: the deck's glossary acronyms. Deepgram's keyterm prompting
   * turned "CRY units", "RDA" and "LOTTO" into CRAH, RDHx and LOTO on the same recording.
   */
  const keytermsRef = useRef<string[]>([]);
  const setKeyterms = useCallback((terms: string[]) => {
    keytermsRef.current = terms;
  }, []);

  // Streaming transport state.
  const socketRef = useRef<WebSocket | null>(null);
  const keepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reportTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Samples sent to Deepgram on the live socket and not yet reported.
   *
   * Counted from what was actually sent rather than how long the socket was open,
   * because sent audio is what Deepgram bills. Keepalives cost nothing and are not
   * counted; muted chunks are never sent, so they are not counted either.
   */
  const unreportedSamplesRef = useRef(0);
  const pendingRef = useRef('');
  const speakingRef = useRef(false);

  // Batch transport state.
  const bufferRef = useRef<Int16Array[]>([]);
  const prerollRef = useRef<Int16Array[]>([]);
  const onsetCountRef = useRef(0);
  const silenceMsRef = useRef(0);
  const speechMsRef = useRef(0);
  const inSpeechRef = useRef(false);
  const sttAbortRef = useRef<AbortController | null>(null);
  const reopenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reopensRef = useRef(0);
  /** Set below, once openSocket exists, so a fallback can schedule its own way back. */
  const reopenStreamRef = useRef<() => void>(() => undefined);

  const resetBatchState = useCallback(() => {
    bufferRef.current = [];
    prerollRef.current = [];
    onsetCountRef.current = 0;
    silenceMsRef.current = 0;
    speechMsRef.current = 0;
    inSpeechRef.current = false;
  }, []);

  /** Posts one buffered utterance for transcription. */
  const transcribeBuffer = useCallback(async () => {
    const chunks = bufferRef.current;
    const speechMs = speechMsRef.current;
    resetBatchState();

    if (chunks.length === 0 || speechMs < VAD_MIN_SPEECH_MS) return;

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Int16Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    sttAbortRef.current?.abort();
    const controller = new AbortController();
    sttAbortRef.current = controller;
    setTranscribing(true);

    const params = new URLSearchParams({ language: languageRef.current });
    for (const term of keytermsRef.current) params.append('keyterm', term);
    const send = () =>
      fetch(`/api/stt?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: merged.buffer as ArrayBuffer,
        signal: controller.signal,
      });

    try {
      let response: Response;
      try {
        response = await send();
      } catch (error) {
        if (controller.signal.aborted) throw error;
        // The connection blinked. The audio is still here, so it is sent once more
        // rather than the trainee being asked to repeat themselves.
        await new Promise((resolve) => setTimeout(resolve, STT_RETRY_DELAY_MS));
        if (controller.signal.aborted) return;
        response = await send();
      }

      if (!response.ok) {
        optionsRef.current.onError?.(describeFailure(await readFailure(response)));
        return;
      }

      const { transcript } = (await response.json()) as { transcript?: string };
      const text = transcript?.trim();
      if (text) optionsRef.current.onUtterance(text);
    } catch (error) {
      if ((error as Error).name !== 'AbortError' && !controller.signal.aborted) {
        reportFailure({
          area: 'listening',
          kind: 'network',
          code: 'connection',
          detail: `An utterance of ${Math.round(speechMs / 100) / 10} s could not be sent.`,
          language: languageRef.current,
        });
        optionsRef.current.onError?.(LISTENING_LOST);
      }
    } finally {
      setTranscribing(false);
    }
  }, [resetBatchState]);

  /**
   * Batch transport chunk handler. Runs a simple energy gate with an onset
   * count, a pre-roll ring, and a hangover, which is enough to segment
   * conversational speech reliably without a model.
   */
  const handleBatchChunk = useCallback(
    (chunk: MicChunk) => {
      if (chunk.muted) {
        // Mid-utterance mute, as when a push to talk key is released, should send
        // what was captured rather than throw it away.
        if (inSpeechRef.current) void transcribeBuffer();
        else resetBatchState();
        return;
      }

      const isSpeech = chunk.rms >= VAD_SPEECH_RMS;

      if (!inSpeechRef.current) {
        // Keep a short rolling pre-roll so the onset is not clipped.
        prerollRef.current.push(chunk.pcm);
        if (prerollRef.current.length > VAD_PREROLL_CHUNKS) prerollRef.current.shift();

        if (!isSpeech) {
          onsetCountRef.current = 0;
          return;
        }

        onsetCountRef.current += 1;
        if (onsetCountRef.current < VAD_ONSET_CHUNKS) return;

        inSpeechRef.current = true;
        silenceMsRef.current = 0;
        speechMsRef.current = onsetCountRef.current * CHUNK_MS;
        bufferRef.current = [...prerollRef.current];
        prerollRef.current = [];
        optionsRef.current.onSpeechStart?.();
        return;
      }

      bufferRef.current.push(chunk.pcm);

      if (isSpeech) {
        speechMsRef.current += CHUNK_MS;
        silenceMsRef.current = 0;
      } else {
        silenceMsRef.current += CHUNK_MS;
      }

      const bufferedMs = bufferRef.current.length * CHUNK_MS;
      if (silenceMsRef.current >= VAD_HANGOVER_MS || bufferedMs >= VAD_MAX_UTTERANCE_MS) {
        void transcribeBuffer();
      }
    },
    [resetBatchState, transcribeBuffer],
  );

  /** Streaming transport chunk handler. Straight to the socket. */
  const handleStreamChunk = useCallback((chunk: MicChunk) => {
    if (chunk.muted) return;
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(chunk.pcm.buffer as ArrayBuffer);
      unreportedSamplesRef.current += chunk.pcm.length;
    }
  }, []);

  /**
   * Tells usage metering how much live audio went to Deepgram since the last report.
   *
   * The batch transport is metered on the server, which receives the audio. This one
   * never touches the server, so until now its minutes were not recorded at all, and
   * a customer's usage under-reported the line on the bill that grows with session
   * length. `keepalive` lets the last report survive the page being closed.
   */
  const reportStreamedAudio = useCallback(() => {
    const samples = unreportedSamplesRef.current;
    unreportedSamplesRef.current = 0;
    if (samples <= 0) return;
    void fetch('/api/usage/stt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds: samples / CAPTURE_SAMPLE_RATE }),
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  const handleChunk = useCallback(
    (chunk: MicChunk) => {
      if (transportRef.current === 'batch') handleBatchChunk(chunk);
      else if (transportRef.current === 'stream') handleStreamChunk(chunk);
    },
    [handleBatchChunk, handleStreamChunk],
  );

  const mic = useMicCapture({
    onChunk: handleChunk,
    onError: (message) => optionsRef.current.onError?.(message),
  });
  const micRef = useRef(mic);
  useEffect(() => {
    micRef.current = mic;
  }, [mic]);

  const teardownSocket = useCallback(() => {
    if (keepaliveRef.current) {
      clearInterval(keepaliveRef.current);
      keepaliveRef.current = null;
    }
    if (reportTimerRef.current) {
      clearInterval(reportTimerRef.current);
      reportTimerRef.current = null;
    }
    // Every way the socket closes comes through here: pausing, stopping, falling back
    // to batch, and leaving the page. So does every report that was still owed.
    reportStreamedAudio();
    const socket = socketRef.current;
    socketRef.current = null;
    if (!socket) return;

    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {
        // Already going down.
      }
    }
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.close();
  }, [reportStreamedAudio]);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    sttAbortRef.current?.abort();
    if (reopenTimerRef.current) clearTimeout(reopenTimerRef.current);
    reopenTimerRef.current = null;
    teardownSocket();
    micRef.current.stop();
    resetBatchState();
    pendingRef.current = '';
    speakingRef.current = false;
    transportRef.current = null;
    setTransport(null);
    setInterim('');
    setTranscribing(false);
  }, [resetBatchState, teardownSocket]);

  const openSocket = useCallback(
    (credentials: DeepgramTokenResponse) => {
      const url = new URL('wss://api.deepgram.com/v1/listen');
      url.searchParams.set('model', credentials.model);
      url.searchParams.set('encoding', 'linear16');
      url.searchParams.set('sample_rate', String(CAPTURE_SAMPLE_RATE));
      url.searchParams.set('channels', '1');
      url.searchParams.set('interim_results', 'true');
      url.searchParams.set('smart_format', 'true');
      url.searchParams.set('punctuate', 'true');
      url.searchParams.set('endpointing', String(ENDPOINTING_MS));
      // Not kept by Deepgram for model training (AI-45), unless the server says otherwise.
      if (credentials.mipOptOut !== false) url.searchParams.set('mip_opt_out', 'true');
      url.searchParams.set('utterance_end_ms', String(UTTERANCE_END_MS));
      url.searchParams.set('vad_events', 'true');
      url.searchParams.set('language', listeningLanguage(languageRef.current));
      for (const term of keytermsRef.current) url.searchParams.append('keyterm', term);

      const socket = new WebSocket(url, [credentials.scheme, credentials.token]);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      const flushPending = () => {
        const text = pendingRef.current.trim();
        pendingRef.current = '';
        speakingRef.current = false;
        setInterim('');
        if (text) optionsRef.current.onUtterance(text);
      };

      socket.onopen = () => {
        keepaliveRef.current = setInterval(() => {
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, KEEPALIVE_MS);
        reportTimerRef.current = setInterval(reportStreamedAudio, STREAM_REPORT_MS);
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return;

        let message: DeepgramTranscriptMessage;
        try {
          message = JSON.parse(event.data) as DeepgramTranscriptMessage;
        } catch {
          return;
        }

        if (message.type === 'UtteranceEnd') {
          flushPending();
          return;
        }
        if (message.type !== 'Results') return;

        const transcript = message.channel?.alternatives?.[0]?.transcript?.trim() ?? '';
        if (!transcript) return;

        if (!speakingRef.current) {
          speakingRef.current = true;
          optionsRef.current.onSpeechStart?.();
        }

        if (message.is_final) {
          pendingRef.current = `${pendingRef.current} ${transcript}`.trim();
          setInterim('');
          if (message.speech_final) flushPending();
        } else {
          const live = `${pendingRef.current} ${transcript}`.trim();
          setInterim(live);
          optionsRef.current.onInterim?.(live);
        }
      };

      /**
       * Losing the socket used to be terminal.
       *
       * It no longer raises a message either. Bursts work as well for the trainee, so
       * telling them about the switch only worried them about something they did not
       * need to act on. It goes to the developer log instead, and the live connection
       * is tried again in a little while.
       *
       * The dead socket stayed in socketRef, the keepalive kept ticking, and every
       * chunk was dropped silently because readyState was not OPEN. The microphone
       * stayed live and the interface still said "Listening, go ahead", so the
       * trainee carried on talking to a session that could no longer hear them.
       * start() could not recover it either, since it returns early while
       * transportRef is set, and nothing sets phase back to idle to reach the lobby.
       *
       * Falling back in place is better than reconnecting: the microphone is already
       * open and independent of the socket, and /api/stt transcribes with the same
       * key, so voice input keeps working with a beat more latency and no partials.
       */
      const fallBackToBatch = (reason: string) => {
        if (stoppingRef.current) return;
        if (transportRef.current !== 'stream') return;

        teardownSocket();
        pendingRef.current = '';
        speakingRef.current = false;
        setInterim('');
        resetBatchState();

        transportRef.current = 'batch';
        setTransport('batch');

        reportFailure({
          area: 'live-listening',
          kind: reason,
          code: 'connection',
          detail: 'Live transcription closed; switched to short bursts.',
          language: languageRef.current,
        });
        reopenStreamRef.current();
      };

      socket.onerror = () => {
        fallBackToBatch('socket-error');
      };

      socket.onclose = (event) => {
        if (stoppingRef.current) return;
        // 1000 and 1005 are ordinary closes, which happen when we hang up.
        if (event.code === 1000 || event.code === 1005) return;

        // 1006 at the start of a session usually means the key cannot mint browser
        // tokens; later in one, that the connection went.
        fallBackToBatch(`socket-close-${event.code}`);
      };
    },
    [reportStreamedAudio, resetBatchState, teardownSocket],
  );

  const start = useCallback(async () => {
    // Already listening, or on the way to it.
    if (transportRef.current) return true;
    stoppingRef.current = false;
    reopensRef.current = 0;
    resetBatchState();

    // Decide the transport before opening the microphone, so a chunk never
    // arrives with no transport set.
    let credentials: DeepgramTokenResponse | null = null;
    try {
      const response = await fetch('/api/deepgram/token', { method: 'POST' });
      if (response.ok) {
        credentials = (await response.json()) as DeepgramTokenResponse;
      } else {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          fatal?: boolean;
        };
        // A missing key is fatal for both transports, so report it rather than
        // silently falling back to a route that will fail the same way. The server
        // decides which failures those are, and says so with `fatal`.
        if (body.fatal === true) {
          optionsRef.current.onError?.(body.error ?? LISTENING_LOST);
          return false;
        }
        // Anything else, most often a key without permission to mint tokens,
        // just means the batch transport is the one to use.
      }
    } catch {
      // Network failure reaching our own server. Batch will surface it properly.
    }

    // The token fetch is an await, so the session may have ended meanwhile.
    // Without this the continuation reopens the microphone and a billed socket
    // after the trainee pressed End session, with no control left to close them.
    if (stoppingRef.current) return false;

    const chosen: SttTransport = credentials ? 'stream' : 'batch';
    transportRef.current = chosen;
    setTransport(chosen);

    const opened = await micRef.current.start();
    if (!opened || stoppingRef.current) {
      // Release the microphone this call opened. The earlier stop() ran before
      // the stream existed, so nothing else will.
      if (opened) micRef.current.stop();
      transportRef.current = null;
      setTransport(null);
      return false;
    }

    if (credentials) openSocket(credentials);
    return true;
  }, [openSocket, resetBatchState]);

  /**
   * Tries to get live transcription back after a fallback to bursts.
   *
   * Waits STREAM_REOPEN_MS, or for the browser to say it is back online, whichever comes
   * first, and never mid-utterance: switching then would drop what was being said.
   */
  const reopenStream = useCallback(() => {
    if (reopensRef.current >= MAX_STREAM_REOPENS) return;
    if (reopenTimerRef.current) clearTimeout(reopenTimerRef.current);

    const attempt = async () => {
      reopenTimerRef.current = null;
      window.removeEventListener('online', onOnline);
      if (stoppingRef.current || transportRef.current !== 'batch') return;
      if (inSpeechRef.current) {
        reopenTimerRef.current = setTimeout(() => void attempt(), 2000);
        return;
      }
      reopensRef.current += 1;
      try {
        const response = await fetch('/api/deepgram/token', { method: 'POST' });
        if (!response.ok) return;
        const credentials = (await response.json()) as DeepgramTokenResponse;
        if (stoppingRef.current || transportRef.current !== 'batch' || inSpeechRef.current) return;
        resetBatchState();
        transportRef.current = 'stream';
        setTransport('stream');
        openSocket(credentials);
      } catch {
        // Still offline. The next fallback, or the next online event, tries again.
      }
    };
    const onOnline = () => {
      if (reopenTimerRef.current) clearTimeout(reopenTimerRef.current);
      void attempt();
    };
    window.addEventListener('online', onOnline, { once: true });
    reopenTimerRef.current = setTimeout(() => void attempt(), STREAM_REOPEN_MS);
  }, [openSocket, resetBatchState]);

  useEffect(() => {
    reopenStreamRef.current = reopenStream;
  }, [reopenStream]);

  const setMuted = useCallback((muted: boolean) => {
    micRef.current.setMuted(muted);
    if (muted) {
      pendingRef.current = '';
      speakingRef.current = false;
      setInterim('');
    }
  }, []);

  // Closing the tab does not reliably unmount anything, so the clean-up below cannot
  // be counted on to report. pagehide fires on the way out, and the report's keepalive
  // flag lets it finish after the page is gone.
  useEffect(() => {
    window.addEventListener('pagehide', reportStreamedAudio);
    return () => window.removeEventListener('pagehide', reportStreamedAudio);
  }, [reportStreamedAudio]);

  useEffect(
    () => () => {
      stoppingRef.current = true;
      sttAbortRef.current?.abort();
      if (reopenTimerRef.current) clearTimeout(reopenTimerRef.current);
      teardownSocket();
      // The socket alone is not enough. Leaving the microphone running kept the
      // recording indicator lit after the page was left, and on the batch
      // transport a stale transport plus a live worklet went on posting audio to
      // /api/stt and driving whole turns for a session nobody was in.
      micRef.current.stop();
      transportRef.current = null;
    },
    [teardownSocket],
  );

  return {
    state: mic.state,
    level: mic.level,
    interim,
    transport,
    transcribing,
    start,
    stop,
    setMuted,
    setLanguage,
    setKeyterms,
  };
}
