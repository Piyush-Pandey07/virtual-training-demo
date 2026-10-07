'use client';

/**
 * The two halves of the OpenAI test: hearing it speak, and seeing how well it listens.
 *
 * Speech is played from the same raw 24 kHz samples a session plays, so a voice heard
 * here sounds exactly as it would in front of a trainee, and the time to the first sound
 * is measured the way a trainee would feel it: from the click.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { AUDIO_SAMPLE_RATE } from '@/lib/config';
import { pcmToFloat } from '@/lib/pcm';
import {
  MAX_RECORDING_SECONDS,
  MAX_TEST_CHARS,
  OPENAI_VOICES,
  SUGGESTED_INSTRUCTIONS,
  TEST_LANGUAGES,
  TEST_SENTENCES,
  type ListeningChoice,
  type OpenAiVoice,
  type TestLanguage,
} from '@/lib/openai-test/samples';

interface OpenAiTestProps {
  /** Whether OPENAI_API_KEY is set. Without it the OpenAI buttons are switched off. */
  configured: boolean;
  /** Whether today's Hindi voice, Sarvam's, is offered, so it can be compared. */
  hindi: boolean;
}

interface SpeechResult {
  id: number;
  who: string;
  language: string;
  firstSoundMs?: number;
  seconds?: number;
  error?: string;
}

type Heard = { text: string; ms: number } | { error: string; ms: number };

/** Today's voice for each language, as the session would use it. */
const TODAY: Record<TestLanguage, { voice: string; label: string } | null> = {
  en: { voice: 'aura-2-thalia-en', label: 'Deepgram Thalia' },
  hi: { voice: 'sarvam-hi-priya', label: 'Sarvam Priya' },
  id: null,
};

const card = 'border-charcoal-line bg-charcoal-soft mt-8 rounded-xl border p-5';
const field =
  'bg-charcoal text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal mt-2 w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset';
const primary =
  'bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const secondary =
  'text-mist ring-charcoal-line hover:bg-charcoal-line rounded-md px-4 py-2.5 text-sm font-semibold ring-1 transition-colors ring-inset disabled:cursor-not-allowed disabled:opacity-50';

function recorderType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
}

export function OpenAiTest({ configured, hindi }: OpenAiTestProps) {
  // ------------------------------------------------------------------ speaking
  const [language, setLanguage] = useState<TestLanguage>('en');
  const [text, setText] = useState(TEST_SENTENCES.en);
  const [voice, setVoice] = useState<OpenAiVoice>('marin');
  const [instructions, setInstructions] = useState(SUGGESTED_INSTRUCTIONS.en);
  const [playing, setPlaying] = useState<string | null>(null);
  const [results, setResults] = useState<SpeechResult[]>([]);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const counter = useRef(0);

  const chooseLanguage = (next: TestLanguage) => {
    setLanguage(next);
    setText(TEST_SENTENCES[next]);
    setInstructions(SUGGESTED_INSTRUCTIONS[next]);
  };

  const stopPlayback = useCallback(() => {
    try {
      sourceRef.current?.stop();
    } catch {
      // Already finished.
    }
    sourceRef.current = null;
    setPlaying(null);
  }, []);

  const speak = useCallback(
    async (who: 'openai' | 'today') => {
      stopPlayback();
      // Made and resumed inside the click, which is the gesture a browser wants first.
      if (!contextRef.current || contextRef.current.state === 'closed') {
        contextRef.current = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
      }
      const context = contextRef.current;
      await context.resume().catch(() => undefined);

      const today = TODAY[language];
      const label = who === 'openai' ? `OpenAI ${voice}` : (today?.label ?? 'Today');
      const languageName = TEST_LANGUAGES.find((entry) => entry.code === language)?.name ?? '';
      counter.current += 1;
      const id = counter.current;
      setPlaying(who);

      const started = performance.now();
      let firstSoundMs: number | undefined;
      try {
        const response = await fetch(who === 'openai' ? '/api/openai-test/speak' : '/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            who === 'openai' ? { text, voice, instructions } : { text, voice: today?.voice },
          ),
        });
        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Failed with ${response.status}.`);
        }

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (firstSoundMs === undefined) firstSoundMs = Math.round(performance.now() - started);
          chunks.push(value);
          length += value.length;
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }

        const samples = pcmToFloat(bytes.buffer);
        if (samples.length === 0) throw new Error('No audio came back.');
        const buffer = context.createBuffer(1, samples.length, AUDIO_SAMPLE_RATE);
        buffer.copyToChannel(samples, 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = () => {
          if (sourceRef.current === source) {
            sourceRef.current = null;
            setPlaying(null);
          }
        };
        sourceRef.current = source;
        source.start();

        setResults((current) =>
          [
            { id, who: label, language: languageName, firstSoundMs, seconds: buffer.duration },
            ...current,
          ].slice(0, 8),
        );
      } catch (error) {
        setPlaying(null);
        setResults((current) =>
          [
            { id, who: label, language: languageName, error: (error as Error).message },
            ...current,
          ].slice(0, 8),
        );
      }
    },
    [instructions, language, stopPlayback, text, voice],
  );

  useEffect(
    () => () => {
      stopPlayback();
      void contextRef.current?.close().catch(() => undefined);
    },
    [stopPlayback],
  );

  // ----------------------------------------------------------------- listening
  const [choice, setChoice] = useState<ListeningChoice>('auto');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [heard, setHeard] = useState<{ openai: Heard; deepgram: Heard } | null>(null);
  const [listenError, setListenError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const transcribe = useCallback(
    async (audio: Blob) => {
      setTranscribing(true);
      setHeard(null);
      try {
        const form = new FormData();
        form.append('audio', audio, 'speech');
        form.append('language', choice);
        const response = await fetch('/api/openai-test/transcribe', { method: 'POST', body: form });
        const body = (await response.json().catch(() => ({}))) as {
          openai?: Heard;
          deepgram?: Heard;
          error?: string;
        };
        if (!response.ok || !body.openai || !body.deepgram) {
          throw new Error(body.error ?? `Failed with ${response.status}.`);
        }
        setHeard({ openai: body.openai, deepgram: body.deepgram });
      } catch (error) {
        setListenError((error as Error).message);
      } finally {
        setTranscribing(false);
      }
    },
    [choice],
  );

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const startRecording = useCallback(async () => {
    setListenError(null);
    setHeard(null);
    if (clip) URL.revokeObjectURL(clip);
    setClip(null);

    const type = recorderType();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setListenError('The browser did not allow the microphone.');
      return;
    }

    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const parts: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) parts.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      setRecording(false);
      const audio = new Blob(parts, { type: recorder.mimeType || type || 'audio/webm' });
      setClip(URL.createObjectURL(audio));
      void transcribe(audio);
    };

    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    setElapsed(0);
    const began = Date.now();
    timerRef.current = setInterval(() => {
      const seconds = Math.floor((Date.now() - began) / 1000);
      setElapsed(seconds);
      if (seconds >= MAX_RECORDING_SECONDS) stopRecording();
    }, 250);
  }, [clip, stopRecording, transcribe]);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    },
    [],
  );

  const today = TODAY[language];
  const todayUnavailable = !today || (language === 'hi' && !hindi);

  return (
    <div>
      {!configured && (
        <div
          role="alert"
          className="border-logo-red/40 bg-logo-red/10 mt-8 rounded-md border p-4 text-sm"
        >
          <p className="font-semibold">OpenAI is not connected yet.</p>
          <p className="text-muted mt-1 leading-relaxed">
            Add <code className="text-mist">OPENAI_API_KEY</code> to the Production environment
            variables in Vercel and redeploy. Until then the OpenAI buttons are switched off;
            today&apos;s voices and Deepgram&apos;s listening still work here for comparison.
          </p>
        </div>
      )}

      <section className={card} aria-labelledby="speak-heading">
        <h2 id="speak-heading" className="text-lg font-semibold">
          Hear it speak
        </h2>

        <fieldset className="mt-4 min-w-0">
          <legend className="text-sm font-semibold">Language</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {TEST_LANGUAGES.map((option) => (
              <label
                key={option.code}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ring-1 transition-colors ring-inset ${
                  option.code === language ? 'bg-charcoal ring-teal' : 'ring-charcoal-line'
                }`}
              >
                <input
                  type="radio"
                  name="speak-language"
                  checked={option.code === language}
                  onChange={() => chooseLanguage(option.code)}
                  className="accent-teal size-4"
                />
                {option.name}
              </label>
            ))}
          </div>
        </fieldset>

        <label htmlFor="speak-text" className="mt-5 block text-sm font-semibold">
          What to say
          <span className="text-muted ml-2 font-normal">
            {text.length} of {MAX_TEST_CHARS} characters
          </span>
        </label>
        <textarea
          id="speak-text"
          value={text}
          maxLength={MAX_TEST_CHARS}
          rows={4}
          onChange={(event) => setText(event.target.value)}
          className={field}
          lang={language}
        />

        <div className="mt-5 grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <div>
            <label htmlFor="speak-voice" className="block text-sm font-semibold">
              OpenAI voice
            </label>
            <select
              id="speak-voice"
              value={voice}
              onChange={(event) => setVoice(event.target.value as OpenAiVoice)}
              className={field}
            >
              {OPENAI_VOICES.map((name) => (
                <option key={name} value={name}>
                  {name[0]!.toUpperCase() + name.slice(1)}
                  {name === 'marin' || name === 'cedar' ? ' (recommended)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor="speak-how" className="block text-sm font-semibold">
              How it should sound
              <span className="text-muted ml-2 font-normal">OpenAI only</span>
            </label>
            <input
              id="speak-how"
              type="text"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              className={field}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void speak('openai')}
            disabled={!configured || playing !== null || !text.trim()}
            className={primary}
          >
            {playing === 'openai' ? 'Playing' : 'Play with OpenAI'}
          </button>
          <button
            type="button"
            onClick={() => void speak('today')}
            disabled={todayUnavailable || playing !== null || !text.trim()}
            className={secondary}
          >
            {playing === 'today'
              ? 'Playing'
              : today
                ? `Play with today's voice (${today.label})`
                : "Play with today's voice"}
          </button>
          {playing && (
            <button type="button" onClick={stopPlayback} className={secondary}>
              Stop
            </button>
          )}
        </div>
        {language === 'id' && (
          <p className="text-muted mt-2 text-xs">
            Nothing the trainer uses today can speak Indonesian: Deepgram&apos;s voices are English
            and Sarvam&apos;s are Indian languages.
          </p>
        )}
        {language === 'hi' && !hindi && (
          <p className="text-muted mt-2 text-xs">
            Today&apos;s Hindi voice is not switched on in this deployment, so there is nothing to
            compare against.
          </p>
        )}

        {results.length > 0 && (
          <ul className="mt-5 space-y-2" aria-live="polite">
            {results.map((result) => (
              <li
                key={result.id}
                className="border-charcoal-line flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border px-3.5 py-2.5 text-sm"
              >
                <span className="text-mist font-semibold">{result.who}</span>
                <span className="text-muted text-xs">{result.language}</span>
                {result.error ? (
                  <span className="text-logo-red w-full text-xs">{result.error}</span>
                ) : (
                  <span className="text-muted text-xs">
                    first sound after {result.firstSoundMs} ms, {result.seconds?.toFixed(1)} s of
                    speech
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card} aria-labelledby="listen-heading">
        <h2 id="listen-heading" className="text-lg font-semibold">
          Test how it listens
        </h2>
        <p className="text-muted mt-1 text-sm leading-relaxed">
          Record yourself saying something a trainee might, in any mix of languages. The same
          recording goes to OpenAI and to Deepgram, which listens in every session today.
        </p>

        <label htmlFor="listen-language" className="mt-4 block text-sm font-semibold">
          You will speak
        </label>
        <select
          id="listen-language"
          value={choice}
          onChange={(event) => setChoice(event.target.value as ListeningChoice)}
          disabled={recording || transcribing}
          className={`${field} sm:w-64`}
        >
          <option value="auto">Let them work it out</option>
          {TEST_LANGUAGES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </select>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {recording ? (
            <button type="button" onClick={stopRecording} className={primary}>
              Stop recording ({elapsed} s of {MAX_RECORDING_SECONDS})
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void startRecording()}
              disabled={transcribing}
              className={primary}
            >
              {transcribing ? 'Transcribing' : clip ? 'Record again' : 'Record'}
            </button>
          )}
          {/* The recording itself, so what each service was sent can be heard back. */}
          {clip && !recording && <audio controls src={clip} className="h-9 max-w-full" />}
        </div>

        {listenError && (
          <p role="alert" className="text-logo-red mt-3 text-sm">
            {listenError}
          </p>
        )}

        {heard && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2" aria-live="polite">
            {(
              [
                ['OpenAI', heard.openai],
                ['Deepgram (today)', heard.deepgram],
              ] as const
            ).map(([name, result]) => (
              <div key={name} className="border-charcoal-line rounded-md border p-3.5">
                <p className="flex items-baseline justify-between gap-2 text-sm font-semibold">
                  {name}
                  <span className="text-muted text-xs font-normal">{result.ms} ms</span>
                </p>
                {'error' in result ? (
                  <p className="text-logo-red mt-2 text-sm">{result.error}</p>
                ) : (
                  <p className="text-mist mt-2 text-sm leading-relaxed">
                    {result.text || <span className="text-muted">Heard nothing.</span>}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
