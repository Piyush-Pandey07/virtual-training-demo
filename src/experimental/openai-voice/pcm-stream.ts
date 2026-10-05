/**
 * EXPERIMENTAL -- OpenAI voice trial. Plays raw PCM as it arrives.
 *
 * Each chunk is scheduled on the context's own timeline straight after the one before,
 * the same way the training app plays its trainer, so the sound is gapless and starts
 * with the first chunk rather than after the whole sample has downloaded. That is
 * what makes "started speaking after" an honest figure: it is the delay a trainee
 * would actually sit through.
 */

import { pcmToFloat } from '@/lib/pcm';

export interface PlaybackResult {
  /** From the click to the first sound, or null if nothing arrived. */
  firstAudioMs: number | null;
  /** Length of the audio that played. */
  seconds: number;
  stopped: boolean;
}

export interface Playback {
  finished: Promise<PlaybackResult>;
  stop: () => void;
}

/** A little headroom so the first chunk is never scheduled in the past. */
const LEAD_SECONDS = 0.05;

export function playPcmStream(
  context: AudioContext,
  body: ReadableStream<Uint8Array>,
  sampleRate: number,
  startedAt: number,
): Playback {
  const reader = body.getReader();
  const sources = new Set<AudioBufferSourceNode>();
  let stopped = false;
  let streamDone = false;
  let nextStart = 0;
  let firstAudioMs: number | null = null;
  let seconds = 0;
  let carry: Uint8Array | null = null;
  let drained: (() => void) | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    void reader.cancel().catch(() => undefined);
    for (const source of sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Never started, or already finished.
      }
      source.disconnect();
    }
    sources.clear();
    drained?.();
  };

  const schedule = (bytes: Uint8Array) => {
    // A chunk can end halfway through a sample. Hold the odd byte for the next one.
    let joined = bytes;
    if (carry) {
      joined = new Uint8Array(carry.byteLength + bytes.byteLength);
      joined.set(carry);
      joined.set(bytes, carry.byteLength);
      carry = null;
    }
    const usable = joined.byteLength - (joined.byteLength % 2);
    if (usable < joined.byteLength) carry = joined.slice(usable);
    if (usable === 0) return;

    // A copy, so the samples start on an aligned offset of their own buffer.
    const samples = pcmToFloat(joined.slice(0, usable).buffer);
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const at = Math.max(nextStart, context.currentTime + LEAD_SECONDS);
    source.start(at);
    nextStart = at + buffer.duration;
    seconds += buffer.duration;
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      source.disconnect();
      if (streamDone && sources.size === 0) drained?.();
    };

    if (firstAudioMs === null) {
      firstAudioMs = Math.round(performance.now() - startedAt + (at - context.currentTime) * 1000);
    }
  };

  const finished = (async (): Promise<PlaybackResult> => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || stopped) break;
        if (value && value.byteLength > 0) schedule(value);
      }
    } catch (error) {
      if (!stopped) throw error;
    }
    streamDone = true;
    if (!stopped && sources.size > 0) {
      await new Promise<void>((resolve) => {
        drained = resolve;
      });
    }
    return { firstAudioMs, seconds, stopped };
  })();

  return { finished, stop };
}
