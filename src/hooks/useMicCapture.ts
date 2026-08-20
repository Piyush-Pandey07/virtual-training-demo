'use client';

/**
 * Microphone capture.
 *
 * Owns getUserMedia, the AudioContext, and the capture worklet, and hands each
 * chunk of 16-bit PCM to a callback along with its loudness. Knows nothing about
 * what happens to the audio, so both the streaming and the batch speech to text
 * transports can sit on top of it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { CAPTURE_SAMPLE_RATE } from '@/lib/config';
import type { MicState } from '@/lib/types';

/** Samples per chunk, matching CHUNK_SAMPLES in the worklet. */
export const CHUNK_SAMPLES = 1024;

/** Duration of one chunk in milliseconds. Used by the voice activity detector. */
export const CHUNK_MS = (CHUNK_SAMPLES / CAPTURE_SAMPLE_RATE) * 1000;

export interface MicChunk {
  /** 16-bit PCM samples for this chunk. */
  pcm: Int16Array;
  /** Root mean square loudness, 0 to 1. */
  rms: number;
  /** True when input is gated off, as in push to talk with the key released. */
  muted: boolean;
}

export interface UseMicCaptureResult {
  state: MicState;
  /** Smoothed loudness for the level meter, 0 to 1. */
  level: number;
  start: () => Promise<boolean>;
  stop: () => void;
  setMuted: (muted: boolean) => void;
}

interface Options {
  onChunk: (chunk: MicChunk) => void;
  onError?: (message: string) => void;
}

export function useMicCapture({ onChunk, onError }: Options): UseMicCaptureResult {
  const [state, setState] = useState<MicState>('off');
  const [level, setLevel] = useState(0);

  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const mutedRef = useRef(false);
  /**
   * Invalidates an in-flight start().
   *
   * Opening the microphone means awaiting getUserMedia and then awaiting the
   * worklet module, and either can still be pending when the component unmounts or
   * the session ends. stop() only clears refs, so a start() that resumes afterwards
   * would assign a live stream and a running AudioContext to refs nobody holds any
   * more: the recording indicator stays lit for the life of the tab and the worklet
   * keeps posting chunks with no way to stop it. Every await re-checks this token
   * and disposes what it acquired instead.
   */
  const runIdRef = useRef(0);

  const onChunkRef = useRef(onChunk);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onChunkRef.current = onChunk;
    onErrorRef.current = onError;
  }, [onChunk, onError]);

  const stop = useCallback(() => {
    // Any start() still waiting on an await belongs to a previous run now.
    runIdRef.current += 1;

    workletRef.current?.port.close();
    workletRef.current?.disconnect();
    workletRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const context = contextRef.current;
    contextRef.current = null;
    void context?.close().catch(() => undefined);

    setLevel(0);
    setState('off');
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return true;
    // Claiming a token here also makes stop-then-start correct, because the
    // abandoned run can no longer match.
    runIdRef.current += 1;
    const runId = runIdRef.current;
    const superseded = () => runIdRef.current !== runId;
    setState('requesting');

    // Ask for the processing that keeps the trainer's own voice out of the
    // transcript when the trainee is listening on speakers rather than headphones.
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
      onErrorRef.current?.(
        denied
          ? 'Microphone access was blocked. Allow it in your browser settings and start the session again.'
          : `Could not open the microphone: ${(error as Error).message}`,
      );
      return false;
    }

    // Release the device rather than merely bailing out. A stale run must not
    // call stop(), because a newer start() may already own the refs.
    if (superseded()) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }
    streamRef.current = stream;

    // Creating the context at the capture rate means the browser resamples the
    // microphone for us, so the worklet never has to.
    try {
      const context = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE });
      contextRef.current = context;
      await context.audioWorklet.addModule('/worklets/pcm-processor.js');

      if (superseded()) {
        void context.close().catch(() => undefined);
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }

      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, 'pcm-processor');
      workletRef.current = worklet;

      // Re-apply any mute set before the graph existed.
      worklet.port.postMessage({ type: 'mute', value: mutedRef.current });

      worklet.port.onmessage = (event) => {
        const data = event.data as {
          type: string;
          payload: ArrayBuffer;
          rms: number;
          muted: boolean;
        };
        if (data.type !== 'pcm') return;

        setLevel(Math.min(1, data.rms * 8));
        onChunkRef.current({
          pcm: new Int16Array(data.payload),
          rms: data.rms,
          muted: data.muted,
        });
      };

      source.connect(worklet);
      // A worklet is only pulled if it reaches a destination, but the microphone
      // must not be played back into the room. A muted gain node satisfies both.
      const sink = context.createGain();
      sink.gain.value = 0;
      worklet.connect(sink);
      sink.connect(context.destination);
    } catch (error) {
      stop();
      setState('error');
      onErrorRef.current?.(`Could not start audio capture: ${(error as Error).message}`);
      return false;
    }

    setState('live');
    return true;
  }, [stop]);

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    workletRef.current?.port.postMessage({ type: 'mute', value: muted });
  }, []);

  // Release the microphone if the component goes away mid-session.
  useEffect(() => stop, [stop]);

  return { state, level, start, stop, setMuted };
}
