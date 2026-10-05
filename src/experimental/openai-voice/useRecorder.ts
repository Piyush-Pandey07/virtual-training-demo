'use client';

/**
 * EXPERIMENTAL -- OpenAI voice trial. Records one utterance from the microphone.
 *
 * MediaRecorder rather than the app's PCM worklet, because OpenAI takes the
 * compressed formats browsers record natively: webm in Chrome, Edge and Firefox, mp4
 * in Safari. Stops itself at MAX_RECORDING_SECONDS so a forgotten recording cannot
 * grow into an expensive upload.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { MAX_RECORDING_SECONDS } from './catalogue';

const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function supportedType(): string | undefined {
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export type RecorderState = 'idle' | 'starting' | 'recording';

export interface UseRecorderResult {
  state: RecorderState;
  /** Whole seconds recorded so far. */
  seconds: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

export function useRecorder(onRecorded: (recording: Blob) => void): UseRecorderResult {
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const onRecordedRef = useRef(onRecorded);

  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  const release = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // Stopping the tracks is what turns the browser's recording light off.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    setError(null);

    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot record audio.');
      return;
    }

    setState('starting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      setState('idle');
      setError('The microphone is blocked. Allow it for this site and try again.');
      return;
    }
    streamRef.current = stream;

    const mimeType = supportedType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      release();
      setState('idle');
      setError('This browser cannot record audio.');
      return;
    }

    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      release();
      recorderRef.current = null;
      setState('idle');
      const recording = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      if (recording.size > 0) onRecordedRef.current(recording);
      else setError('Nothing was recorded. Check the microphone and try again.');
    };
    recorderRef.current = recorder;

    const startedAt = Date.now();
    setSeconds(0);
    timerRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      setSeconds(Math.floor(elapsed));
      if (elapsed >= MAX_RECORDING_SECONDS) stop();
    }, 250);

    recorder.start();
    setState('recording');
  }, [release, stop]);

  // Leaving the page mid-recording releases the microphone and sends nothing.
  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
      }
      release();
    },
    [release],
  );

  return { state, seconds, error, start, stop };
}
