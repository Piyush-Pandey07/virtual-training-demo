'use client';

/**
 * Plays a short sample of a voice, so a delegate can hear it before choosing.
 *
 * Its own AudioContext rather than the session's, created and resumed inside the click
 * that asked for a sample, which is the gesture a browser wants before it will play. A
 * side effect worth having: a delegate who plays a sample has heard sound come out of
 * this page before the session starts, so a muted tab or a dead headset shows up here
 * rather than as a silent trainer.
 *
 * Each voice is fetched once and kept, so comparing voices back and forth costs one
 * synthesis per voice rather than one per click.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { AUDIO_SAMPLE_RATE } from '@/lib/config';
import { pcmToFloat } from '@/lib/pcm';

export interface UseVoiceSampleResult {
  /** Plays a voice's sample, stopping whichever was playing. */
  play: (voiceId: string) => Promise<void>;
  stop: () => void;
  /** The voice whose sample is playing, if any. */
  playing: string | null;
  /** The voice whose sample is being fetched, if any. */
  loading: string | null;
  error: string | null;
}

export function useVoiceSample(): UseVoiceSampleResult {
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const cacheRef = useRef(new Map<string, AudioBuffer>());
  /**
   * Which request is current. Clicking A and then B before A's sample arrives must not
   * play A over B when it finally lands.
   */
  const requestRef = useRef(0);

  const stop = useCallback(() => {
    const source = sourceRef.current;
    sourceRef.current = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already finished.
      }
      source.disconnect();
    }
    setPlaying(null);
  }, []);

  const play = useCallback(
    async (voiceId: string) => {
      stop();
      setError(null);
      requestRef.current += 1;
      const request = requestRef.current;

      // Inside the click, before any await, so the browser counts it as the gesture.
      if (!contextRef.current || contextRef.current.state === 'closed') {
        contextRef.current = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
      }
      const context = contextRef.current;
      if (context.state === 'suspended') await context.resume().catch(() => undefined);

      let buffer = cacheRef.current.get(voiceId);
      if (!buffer) {
        setLoading(voiceId);
        try {
          const response = await fetch(`/api/voices/sample?voice=${encodeURIComponent(voiceId)}`);
          if (!response.ok) throw new Error(`Sample failed with ${response.status}.`);
          const samples = pcmToFloat(await response.arrayBuffer());
          if (samples.length === 0) throw new Error('The sample came back empty.');
          buffer = context.createBuffer(1, samples.length, AUDIO_SAMPLE_RATE);
          buffer.copyToChannel(samples, 0);
          cacheRef.current.set(voiceId, buffer);
        } catch {
          if (request === requestRef.current) {
            setError('That sample would not play. You can still choose the voice and start.');
          }
          return;
        } finally {
          if (request === requestRef.current) setLoading(null);
        }
      }

      // Overtaken by a later click while this one was fetching.
      if (request !== requestRef.current) return;

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (sourceRef.current !== source) return;
        sourceRef.current = null;
        setPlaying(null);
      };
      sourceRef.current = source;
      source.start();
      setPlaying(voiceId);
    },
    [stop],
  );

  // Gone with the lobby. A sample still playing as the session starts would talk over
  // the trainer's first words.
  useEffect(
    () => () => {
      requestRef.current += 1;
      try {
        sourceRef.current?.stop();
      } catch {
        // Never started, or already finished.
      }
      void contextRef.current?.close().catch(() => undefined);
      contextRef.current = null;
    },
    [],
  );

  return { play, stop, playing, loading, error };
}
