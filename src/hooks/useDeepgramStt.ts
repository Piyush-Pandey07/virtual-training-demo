'use client';

/**
 * Live speech to text.
 *
 * Owns the microphone, the capture worklet, and the Deepgram WebSocket. The
 * microphone exists only to feed this socket, so they are started and stopped
 * together rather than being split across hooks.
 *
 * Authentication uses a short-lived token minted by /api/deepgram/token. Browsers
 * cannot set an Authorization header on a WebSocket, so the token travels in the
 * Sec-WebSocket-Protocol subprotocol instead, which is what Deepgram expects.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { CAPTURE_SAMPLE_RATE } from '@/lib/config';
import type { DeepgramTokenResponse, MicState } from '@/lib/types';

/** Deepgram closes an idle socket, so send a keepalive well inside that window. */
const KEEPALIVE_MS = 8_000;

/** Silence in milliseconds before Deepgram finalises an utterance. */
const ENDPOINTING_MS = 400;

/** How long Deepgram waits before emitting UtteranceEnd. */
const UTTERANCE_END_MS = 1_000;

interface DeepgramTranscriptMessage {
  type?: string;
  channel?: { alternatives?: Array<{ transcript?: string }> };
  is_final?: boolean;
  speech_final?: boolean;
}

export interface UseDeepgramSttOptions {
  /** Called with a complete utterance once the speaker has stopped. */
  onUtterance: (text: string) => void;
  /** Called on every partial result, for the live caption. */
  onInterim?: (text: string) => void;
  /**
   * Called as soon as any speech is detected. Used to cut the trainer off
   * mid-sentence when the trainee starts talking.
   */
  onSpeechStart?: () => void;
  /** Called when something goes wrong and the session should surface it. */
  onError?: (message: string) => void;
}

export interface UseDeepgramSttResult {
  state: MicState;
  /** Normalised loudness, 0 to 1, for the level meter. */
  level: number;
  /** The partial transcript being refined right now. */
  interim: string;
  start: () => Promise<void>;
  stop: () => void;
  /** Stops audio reaching Deepgram without tearing the socket down. */
  setMuted: (muted: boolean) => void;
  muted: boolean;
}

export function useDeepgramStt(options: UseDeepgramSttOptions): UseDeepgramSttResult {
  const [state, setState] = useState<MicState>('off');
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState('');
  const [muted, setMutedState] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const keepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppingRef = useRef(false);
  /** Accumulates finalised fragments until Deepgram signals the end of the utterance. */
  const pendingRef = useRef('');
  /** Guards onSpeechStart so it fires once per utterance rather than per packet. */
  const speakingRef = useRef(false);

  // Keep the latest callbacks without making start/stop change identity.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const teardown = useCallback(() => {
    if (keepaliveRef.current) {
      clearInterval(keepaliveRef.current);
      keepaliveRef.current = null;
    }

    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      // Tell Deepgram we are done so it flushes any final transcript.
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({ type: 'CloseStream' }));
        } catch {
          // Socket already going down. Nothing useful to do.
        }
      }
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }

    workletRef.current?.port.close();
    workletRef.current?.disconnect();
    workletRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const context = contextRef.current;
    contextRef.current = null;
    void context?.close().catch(() => undefined);

    pendingRef.current = '';
    speakingRef.current = false;
    setLevel(0);
    setInterim('');
  }, []);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    teardown();
    setState('off');
  }, [teardown]);

  const start = useCallback(async () => {
    if (socketRef.current || state === 'requesting') return;

    stoppingRef.current = false;
    setState('requesting');

    // 1. Microphone. Ask for the processing that keeps the trainer's own voice
    //    out of the transcript when the trainee is on speakers.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (error) {
      const denied =
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      setState(denied ? 'denied' : 'error');
      optionsRef.current.onError?.(
        denied
          ? 'Microphone access was blocked. Allow it in your browser settings and start the session again.'
          : `Could not open the microphone: ${(error as Error).message}`,
      );
      return;
    }
    streamRef.current = stream;

    // 2. Short-lived token, so the account key stays on the server.
    let credentials: DeepgramTokenResponse;
    try {
      const response = await fetch('/api/deepgram/token', { method: 'POST' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Token request failed with ${response.status}.`);
      }
      credentials = (await response.json()) as DeepgramTokenResponse;
    } catch (error) {
      teardown();
      setState('error');
      optionsRef.current.onError?.((error as Error).message);
      return;
    }

    // 3. Audio graph. Creating the context at the capture rate means the browser
    //    resamples the microphone for us.
    let context: AudioContext;
    try {
      context = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE });
      contextRef.current = context;
      await context.audioWorklet.addModule('/worklets/pcm-processor.js');
    } catch (error) {
      teardown();
      setState('error');
      optionsRef.current.onError?.(`Could not start audio capture: ${(error as Error).message}`);
      return;
    }

    // 4. Socket.
    const url = new URL('wss://api.deepgram.com/v1/listen');
    url.searchParams.set('model', credentials.model);
    url.searchParams.set('encoding', 'linear16');
    url.searchParams.set('sample_rate', String(CAPTURE_SAMPLE_RATE));
    url.searchParams.set('channels', '1');
    url.searchParams.set('interim_results', 'true');
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('punctuate', 'true');
    url.searchParams.set('endpointing', String(ENDPOINTING_MS));
    url.searchParams.set('utterance_end_ms', String(UTTERANCE_END_MS));
    url.searchParams.set('vad_events', 'true');
    url.searchParams.set('language', 'en');

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
      setState('live');

      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, 'pcm-processor');
      workletRef.current = worklet;

      worklet.port.onmessage = (event) => {
        const data = event.data as {
          type: string;
          payload: ArrayBuffer;
          rms: number;
          muted: boolean;
        };
        if (data.type !== 'pcm') return;

        setLevel(Math.min(1, data.rms * 8));

        if (data.muted) return;
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(data.payload);
        }
      };

      source.connect(worklet);
      // A worklet needs a destination to be pulled, but we must not play the
      // microphone back into the room. A silent gain node keeps the graph alive.
      const sink = context.createGain();
      sink.gain.value = 0;
      worklet.connect(sink);
      sink.connect(context.destination);

      keepaliveRef.current = setInterval(() => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, KEEPALIVE_MS);
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
        // speech_final means Deepgram is confident the speaker has stopped.
        if (message.speech_final) flushPending();
      } else {
        const live = `${pendingRef.current} ${transcript}`.trim();
        setInterim(live);
        optionsRef.current.onInterim?.(live);
      }
    };

    socket.onerror = () => {
      if (stoppingRef.current) return;
      setState('error');
      optionsRef.current.onError?.(
        'The transcription connection failed. Check your network and start the session again.',
      );
    };

    socket.onclose = (event) => {
      if (stoppingRef.current) return;
      // 1000 and 1005 are ordinary closes. Anything else is worth surfacing,
      // and 1006 right after opening almost always means the token was rejected.
      if (event.code !== 1000 && event.code !== 1005) {
        setState('error');
        optionsRef.current.onError?.(
          event.code === 1006
            ? 'Deepgram closed the connection during setup. This usually means the API key was rejected.'
            : `Transcription stopped unexpectedly (code ${event.code}).`,
        );
      } else {
        setState('off');
      }
    };
  }, [state, teardown]);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    workletRef.current?.port.postMessage({ type: 'mute', value: next });
    if (next) {
      pendingRef.current = '';
      speakingRef.current = false;
      setInterim('');
    }
  }, []);

  // Release the microphone if the component goes away mid-session.
  useEffect(() => teardown, [teardown]);

  return { state, level, interim, start, stop, setMuted, muted };
}
