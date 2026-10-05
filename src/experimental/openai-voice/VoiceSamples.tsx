'use client';

/**
 * EXPERIMENTAL -- OpenAI voice trial. Hear every OpenAI voice say the same line, and
 * the app's current voices beside them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useVoiceSample } from '@/hooks/useVoiceSample';
import type { VoiceOption } from '@/lib/voice/catalogue';
import {
  DEFAULT_SPEECH_MODEL,
  MAX_STYLE_CHARS,
  MAX_TEXT_CHARS,
  OPENAI_PCM_SAMPLE_RATE,
  RECOMMENDED_VOICES,
  SAMPLE_LINES,
  SPEECH_MODELS,
  STYLE_PRESETS,
  speechModel,
  voiceName,
} from './catalogue';
import { playPcmStream, type Playback, type PlaybackResult } from './pcm-stream';

const SPEECH_ROUTE = '/api/experimental/openai-voice/speech';
const CUSTOM = 'custom';

interface Timing {
  firstAudioMs: number | null;
  seconds: number;
}

async function errorFrom(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) return body.error;
  } catch {
    // Not JSON.
  }
  return `The request failed (${response.status}).`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

export function VoiceSamples({
  currentVoices,
  currentSampleText,
}: {
  currentVoices: readonly VoiceOption[];
  currentSampleText: string;
}) {
  const [modelId, setModelId] = useState(DEFAULT_SPEECH_MODEL);
  const [lineId, setLineId] = useState(SAMPLE_LINES[0]!.id);
  const [customText, setCustomText] = useState('');
  const [styleId, setStyleId] = useState(STYLE_PRESETS[0]!.id);
  const [styleText, setStyleText] = useState(STYLE_PRESETS[0]!.text);

  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timings, setTimings] = useState<Record<string, Timing>>({});

  const current = useVoiceSample();
  const stopCurrent = current.stop;

  const model = speechModel(modelId) ?? SPEECH_MODELS[0]!;
  const text =
    lineId === CUSTOM ? customText.trim() : SAMPLE_LINES.find((l) => l.id === lineId)!.text;
  const style = model.takesStyle ? styleText.trim() : '';

  /** Everything that changes what a voice would say, so a replay is only reused when it would sound the same. */
  const settingsKey = useMemo(
    () => JSON.stringify([model.id, text, style]),
    [model.id, text, style],
  );

  const contextRef = useRef<AudioContext | null>(null);
  const playbackRef = useRef<Playback | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);
  const cacheRef = useRef(new Map<string, Uint8Array<ArrayBuffer>>());

  const stop = useCallback(() => {
    requestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    playbackRef.current?.stop();
    playbackRef.current = null;
    setPlaying(null);
    setLoading(null);
  }, []);

  /** Plays one voice. Resolves once it has finished, been stopped, or failed. */
  const play = useCallback(
    async (voice: string): Promise<PlaybackResult | null> => {
      stop();
      stopCurrent();
      setError(null);
      const request = requestRef.current;

      if (!text) {
        setError('Type something for the voices to say.');
        return null;
      }

      // Inside the click, before any await, which is when a browser allows sound to start.
      if (!contextRef.current || contextRef.current.state === 'closed') {
        contextRef.current = new AudioContext({ sampleRate: OPENAI_PCM_SAMPLE_RATE });
      }
      const context = contextRef.current;
      if (context.state === 'suspended') void context.resume().catch(() => undefined);

      const key = `${settingsKey}|${voice}`;
      const started = performance.now();
      const cached = cacheRef.current.get(key);
      const collected: Uint8Array[] = [];
      let body: ReadableStream<Uint8Array>;

      if (cached) {
        body = new Blob([cached]).stream();
      } else {
        setLoading(voice);
        const controller = new AbortController();
        abortRef.current = controller;
        let response: Response;
        try {
          response = await fetch(SPEECH_ROUTE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice, model: model.id, style }),
            signal: controller.signal,
          });
        } catch {
          if (request === requestRef.current) {
            setLoading(null);
            setError('Could not reach the server. Check the connection and try again.');
          }
          return null;
        }
        if (request !== requestRef.current) return null;
        if (!response.ok || !response.body) {
          setLoading(null);
          setError(`${voiceName(voice)}: ${await errorFrom(response)}`);
          return null;
        }
        body = response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, stream) {
              collected.push(chunk);
              stream.enqueue(chunk);
            },
          }),
        );
      }

      const playback = playPcmStream(context, body, OPENAI_PCM_SAMPLE_RATE, started);
      playbackRef.current = playback;
      setLoading(null);
      setPlaying(voice);

      let result: PlaybackResult | null = null;
      try {
        result = await playback.finished;
      } catch {
        if (request === requestRef.current)
          setError(`${voiceName(voice)}: the audio stopped arriving.`);
      }

      if (playbackRef.current === playback) {
        playbackRef.current = null;
        setPlaying(null);
      }

      if (result && !result.stopped && result.firstAudioMs === null) {
        setError(`${voiceName(voice)}: OpenAI sent back no audio.`);
      }
      if (result && !result.stopped && !cached && result.firstAudioMs !== null) {
        const size = collected.reduce((total, chunk) => total + chunk.byteLength, 0);
        const audio = new Uint8Array(size);
        let offset = 0;
        for (const chunk of collected) {
          audio.set(chunk, offset);
          offset += chunk.byteLength;
        }
        cacheRef.current.set(key, audio);
        const timing = { firstAudioMs: result.firstAudioMs, seconds: result.seconds };
        setTimings((previous) => ({ ...previous, [key]: timing }));
      }
      return result;
    },
    [model.id, settingsKey, stop, stopCurrent, style, text],
  );

  /**
   * Each voice in turn. Stopping, or playing any single voice, ends the run, because
   * either one stops the voice it is waiting on.
   */
  const playAll = useCallback(async () => {
    for (const voice of model.voices) {
      const result = await play(voice);
      if (!result || result.stopped || result.firstAudioMs === null) return;
    }
  }, [model.voices, play]);

  // Nothing keeps talking after the page has gone.
  useEffect(() => stop, [stop]);

  const busy = playing !== null || loading !== null;

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-semibold">Model</span>
          <select
            value={model.id}
            onChange={(event) => {
              stop();
              setModelId(event.target.value);
            }}
            className="bg-charcoal-soft ring-charcoal-line mt-1.5 block w-full rounded-md px-3 py-2 text-sm ring-1 ring-inset"
          >
            {SPEECH_MODELS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <span className="text-muted mt-1 block text-xs">{model.note}</span>
        </label>

        <label className="block text-sm">
          <span className="font-semibold">What they say</span>
          <select
            value={lineId}
            onChange={(event) => {
              stop();
              setLineId(event.target.value);
            }}
            className="bg-charcoal-soft ring-charcoal-line mt-1.5 block w-full rounded-md px-3 py-2 text-sm ring-1 ring-inset"
          >
            {SAMPLE_LINES.map((line) => (
              <option key={line.id} value={line.id}>
                {line.label}
              </option>
            ))}
            <option value={CUSTOM}>Your own words</option>
          </select>
        </label>
      </div>

      {lineId === CUSTOM ? (
        <label className="mt-4 block text-sm">
          <span className="font-semibold">Your own words</span>
          <textarea
            value={customText}
            onChange={(event) => setCustomText(event.target.value)}
            maxLength={MAX_TEXT_CHARS}
            rows={3}
            placeholder="Type what the trainer should say"
            className="bg-charcoal-soft ring-charcoal-line placeholder:text-muted mt-1.5 block w-full rounded-md px-3 py-2 text-sm ring-1 ring-inset"
          />
          <span className="text-muted mt-1 block text-xs">
            {customText.length} of {MAX_TEXT_CHARS} characters
          </span>
        </label>
      ) : (
        <blockquote className="border-teal text-mist/90 mt-4 border-l-2 pl-3 text-sm leading-relaxed italic">
          {text}
        </blockquote>
      )}

      {model.takesStyle ? (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-semibold">
            Speaking style
            <span className="text-muted ml-2 font-normal">
              {STYLE_PRESETS.find((preset) => preset.id === styleId)?.label ?? 'Your own'}
            </span>
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  stop();
                  setStyleId(preset.id);
                  setStyleText(preset.text);
                }}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ring-1 transition-colors ring-inset ${
                  styleId === preset.id
                    ? 'bg-charcoal-soft ring-teal text-mist'
                    : 'ring-charcoal-line text-muted hover:text-mist'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <textarea
            value={styleText}
            onChange={(event) => {
              setStyleId(CUSTOM);
              setStyleText(event.target.value);
            }}
            maxLength={MAX_STYLE_CHARS}
            rows={3}
            aria-label="Speaking style instructions"
            className="bg-charcoal-soft ring-charcoal-line mt-2 block w-full rounded-md px-3 py-2 text-sm ring-1 ring-inset"
          />
        </details>
      ) : (
        <p className="text-muted mt-4 text-xs">This model ignores speaking style.</p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => (busy ? stop() : void playAll())}
          className="bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Stop' : `Play all ${model.voices.length} voices`}
        </button>
        <span className="text-muted text-xs">Or play them one at a time below.</span>
      </div>

      {error && (
        <p
          role="alert"
          className="border-logo-red/40 bg-logo-red/10 mt-4 rounded-md border p-3 text-sm"
        >
          {error}
        </p>
      )}

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {model.voices.map((voice) => {
          const isPlaying = playing === voice;
          const isLoading = loading === voice;
          const timing = timings[`${settingsKey}|${voice}`];
          return (
            <li
              key={voice}
              className={`flex items-center gap-3 rounded-md px-3 py-2.5 ring-1 transition-colors ring-inset ${
                isPlaying ? 'bg-charcoal-soft ring-teal' : 'ring-charcoal-line'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {voiceName(voice)}
                  {RECOMMENDED_VOICES.has(voice) && (
                    <span className="text-teal ml-2 text-xs font-normal">OpenAI recommends</span>
                  )}
                </p>
                <p className="text-muted text-xs">
                  {timing
                    ? `Started speaking after ${seconds(timing.firstAudioMs ?? 0)} · ${timing.seconds.toFixed(1)} s long`
                    : isLoading
                      ? 'Asking OpenAI'
                      : 'Not played yet'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => (isPlaying || isLoading ? stop() : void play(voice))}
                aria-label={
                  isPlaying || isLoading ? `Stop ${voiceName(voice)}` : `Play ${voiceName(voice)}`
                }
                className="text-mist ring-charcoal-line hover:bg-charcoal-line shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold ring-1 transition-colors ring-inset"
              >
                {isLoading ? 'Loading' : isPlaying ? 'Stop' : 'Play'}
              </button>
            </li>
          );
        })}
      </ul>

      <details className="mt-8 text-sm">
        <summary className="cursor-pointer font-semibold">
          Compare with the voices the app uses now
          <span className="text-muted ml-2 font-normal">Deepgram</span>
        </summary>
        <p className="text-muted mt-2 text-xs leading-relaxed">
          Each says &ldquo;{currentSampleText}&rdquo; For a like-for-like comparison, choose &ldquo;
          {SAMPLE_LINES[0]!.label}&rdquo; above.
        </p>
        {current.error && (
          <p role="status" className="text-muted mt-2 text-xs">
            {current.error}
          </p>
        )}
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {currentVoices.map((voice) => {
            const isPlaying = current.playing === voice.id;
            const isLoading = current.loading === voice.id;
            return (
              <li
                key={voice.id}
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 ring-1 ring-inset ${
                  isPlaying ? 'bg-charcoal-soft ring-teal' : 'ring-charcoal-line'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {voice.name}
                    <span className="text-muted ml-2 text-xs font-normal">{voice.accent}</span>
                  </p>
                  <p className="text-muted truncate text-xs">{voice.description}</p>
                </div>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    if (isPlaying) {
                      current.stop();
                      return;
                    }
                    stop();
                    void current.play(voice.id);
                  }}
                  aria-label={isPlaying ? `Stop ${voice.name}` : `Play ${voice.name}`}
                  className="text-mist ring-charcoal-line hover:bg-charcoal-line shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold ring-1 transition-colors ring-inset disabled:cursor-wait disabled:opacity-60"
                >
                  {isLoading ? 'Loading' : isPlaying ? 'Stop' : 'Play'}
                </button>
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
