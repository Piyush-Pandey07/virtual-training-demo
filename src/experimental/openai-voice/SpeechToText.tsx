'use client';

/**
 * EXPERIMENTAL -- OpenAI voice trial. Say something once and see what each OpenAI
 * speech-to-text model heard, how long it took, and how close it came.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  MAX_RECORDING_SECONDS,
  TEST_SENTENCES,
  TRAINING_VOCABULARY,
  TRANSCRIBE_MODELS,
} from './catalogue';
import { useRecorder } from './useRecorder';
import { wordAccuracy } from './validate';

const TRANSCRIBE_ROUTE = '/api/experimental/openai-voice/transcribe';
const FREE = 'free';

type Result =
  | { status: 'pending' }
  | { status: 'done'; text: string; roundTripMs: number }
  | { status: 'error'; error: string };

export function SpeechToText() {
  const [sentenceId, setSentenceId] = useState(TEST_SENTENCES[0]!.id);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(TRANSCRIBE_MODELS.filter((model) => model.preselected).map((model) => model.id)),
  );
  const [hint, setHint] = useState(true);
  const [recording, setRecording] = useState<Blob | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  /** What the results on screen were scored against, fixed when they were run. */
  const [scoredAgainst, setScoredAgainst] = useState<string | null>(null);

  const runRef = useRef(0);

  const sentence = TEST_SENTENCES.find((entry) => entry.id === sentenceId);

  const run = useCallback(
    (audio: Blob) => {
      runRef.current += 1;
      const runId = runRef.current;
      const models = TRANSCRIBE_MODELS.filter((model) => selected.has(model.id));
      setScoredAgainst(sentence?.text ?? null);
      setResults(Object.fromEntries(models.map((model) => [model.id, { status: 'pending' }])));

      for (const model of models) {
        const form = new FormData();
        form.append('audio', audio, 'speech');
        form.append('model', model.id);
        form.append('hint', hint ? '1' : '0');

        const started = performance.now();
        void fetch(TRANSCRIBE_ROUTE, { method: 'POST', body: form })
          .then(async (response) => {
            const body = (await response.json().catch(() => ({}))) as {
              text?: unknown;
              error?: unknown;
            };
            if (!response.ok || typeof body.text !== 'string') {
              const error =
                typeof body.error === 'string' && body.error
                  ? body.error
                  : `The request failed (${response.status}).`;
              return { status: 'error', error } as const;
            }
            return {
              status: 'done',
              text: body.text,
              roundTripMs: Math.round(performance.now() - started),
            } as const;
          })
          .catch(() => ({ status: 'error', error: 'Could not reach the server.' }) as const)
          .then((result) => {
            if (runId !== runRef.current) return;
            setResults((previous) => ({ ...previous, [model.id]: result }));
          });
      }
    },
    [hint, selected, sentence],
  );

  const onRecorded = useCallback(
    (audio: Blob) => {
      setRecording(audio);
      // The previous address is released by the effect below when this one replaces it.
      setRecordingUrl(URL.createObjectURL(audio));
      run(audio);
    },
    [run],
  );

  const recorder = useRecorder(onRecorded);

  useEffect(
    () => () => {
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    },
    [recordingUrl],
  );

  const recordingNow = recorder.state === 'recording';
  const anyPending = Object.values(results).some((result) => result.status === 'pending');

  return (
    <div>
      <label className="block text-sm">
        <span className="font-semibold">What you will say</span>
        <select
          value={sentenceId}
          onChange={(event) => setSentenceId(event.target.value)}
          disabled={recordingNow}
          className="bg-charcoal-soft ring-charcoal-line mt-1.5 block w-full rounded-md px-3 py-2 text-sm ring-1 ring-inset"
        >
          {TEST_SENTENCES.map((entry, index) => (
            <option key={entry.id} value={entry.id}>
              Test sentence {index + 1}
            </option>
          ))}
          <option value={FREE}>Anything you like (not scored)</option>
        </select>
      </label>

      {sentence ? (
        <p className="bg-charcoal-soft ring-charcoal-line mt-3 rounded-md px-4 py-3 text-base leading-relaxed ring-1 ring-inset">
          <span className="text-muted mb-1 block text-xs">Read this aloud</span>
          {sentence.text}
        </p>
      ) : (
        <p className="text-muted mt-3 text-sm">
          Ask the kind of question a trainee would, in your own words.
        </p>
      )}

      <fieldset className="mt-5 min-w-0" disabled={recordingNow}>
        <legend className="text-sm font-semibold">Models to compare</legend>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {TRANSCRIBE_MODELS.map((model) => (
            <li key={model.id}>
              <label className="ring-charcoal-line flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 ring-1 ring-inset">
                <input
                  type="checkbox"
                  checked={selected.has(model.id)}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(model.id);
                    else next.delete(model.id);
                    setSelected(next);
                  }}
                  className="accent-teal mt-0.5 size-4 shrink-0"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{model.name}</span>
                  <span className="text-muted block text-xs">{model.note}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={hint}
            onChange={(event) => setHint(event.target.checked)}
            className="accent-teal mt-0.5 size-4 shrink-0"
          />
          <span>
            Tell the models the training vocabulary
            <span className="text-muted block text-xs">
              {TRAINING_VOCABULARY.slice(0, 6).join(', ')} and {TRAINING_VOCABULARY.length - 6} more
            </span>
          </span>
        </label>
      </fieldset>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => (recordingNow ? recorder.stop() : void recorder.start())}
          disabled={recorder.state === 'starting' || (!recordingNow && selected.size === 0)}
          className={`rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            recordingNow
              ? 'bg-logo-red text-mist hover:bg-logo-red/80'
              : 'bg-azure text-mist hover:bg-teal hover:text-charcoal'
          }`}
        >
          {recordingNow
            ? `Stop and transcribe (${recorder.seconds} s)`
            : recorder.state === 'starting'
              ? 'Opening the microphone'
              : recording
                ? 'Record again'
                : 'Start recording'}
        </button>

        {recording && !recordingNow && (
          <button
            type="button"
            onClick={() => run(recording)}
            disabled={anyPending || selected.size === 0}
            className="text-mist ring-charcoal-line hover:bg-charcoal-line rounded-md px-4 py-2.5 text-sm font-semibold ring-1 transition-colors ring-inset disabled:cursor-not-allowed disabled:opacity-50"
          >
            Transcribe the same recording again
          </button>
        )}

        <span className="text-muted text-xs">Stops by itself at {MAX_RECORDING_SECONDS} s.</span>
      </div>

      {recordingNow && (
        <p role="status" className="text-teal mt-3 flex items-center gap-2 text-sm">
          <span className="bg-logo-red inline-block size-2 animate-pulse rounded-full" />
          Recording. Press stop when you have finished.
        </p>
      )}

      {recorder.error && (
        <p
          role="alert"
          className="border-logo-red/40 bg-logo-red/10 mt-4 rounded-md border p-3 text-sm"
        >
          {recorder.error}
        </p>
      )}

      {recordingUrl && !recordingNow && (
        <div className="mt-5">
          <p className="text-muted mb-1.5 text-xs">What was sent</p>
          <audio controls src={recordingUrl} className="w-full max-w-md" />
        </div>
      )}

      {Object.keys(results).length > 0 && (
        <ul className="mt-5 space-y-2" aria-live="polite">
          {TRANSCRIBE_MODELS.filter((model) => results[model.id]).map((model) => {
            const result = results[model.id]!;
            const accuracy =
              result.status === 'done' && scoredAgainst
                ? wordAccuracy(scoredAgainst, result.text)
                : null;
            return (
              <li
                key={model.id}
                className="ring-charcoal-line rounded-md px-4 py-3 ring-1 ring-inset"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-sm font-semibold">{model.name}</p>
                  {result.status === 'done' && (
                    <p className="text-muted text-xs">
                      {(result.roundTripMs / 1000).toFixed(2)} s
                      {accuracy !== null && (
                        <span className={accuracy >= 90 ? 'text-teal ml-3' : 'text-mist ml-3'}>
                          {accuracy}% of words right
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <p className="mt-1.5 text-sm leading-relaxed">
                  {result.status === 'pending' && <span className="text-muted">Transcribing</span>}
                  {result.status === 'done' &&
                    (result.text ? (
                      <>&ldquo;{result.text}&rdquo;</>
                    ) : (
                      <span className="text-muted">Heard nothing.</span>
                    ))}
                  {result.status === 'error' && (
                    <span className="text-logo-red">{result.error}</span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
