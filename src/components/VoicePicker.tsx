'use client';

/**
 * Choosing the session's language and the trainer's voice, on the lobby, before the
 * session starts.
 *
 * Knows nothing about where the voices come from. The list is whatever /api/voices
 * returns, samples come from /api/voices/sample, and an id is passed back untouched, so
 * a different provider later changes the server and leaves this screen alone. That was
 * asked for in so many words, and guarded in voice.test.ts. It is also how Hindi
 * arrived: a second language in the list, from a second provider, with no change here
 * beyond showing a choice of language when there is one.
 *
 * Only ever rendered on the lobby. Once the session starts the lobby is gone, and
 * nothing returns a running session to it, so there is no point at which the voice or
 * the language can be changed mid-session.
 */

import { useEffect, useState } from 'react';

import { useVoiceSample } from '@/hooks/useVoiceSample';
import type { VoiceCatalogue } from '@/lib/voice/catalogue';
import { TRAINER_NAME } from '@/lib/trainer';
import type { SessionLanguage } from '@/lib/types';

interface VoicePickerProps {
  language: SessionLanguage;
  onLanguageChange: (language: SessionLanguage) => void;
  /** The chosen voice id, or null before the list has loaded. */
  value: string | null;
  onChange: (voiceId: string) => void;
  disabled?: boolean;
}

export function VoicePicker({
  language,
  onLanguageChange,
  value,
  onChange,
  disabled = false,
}: VoicePickerProps) {
  const [catalogue, setCatalogue] = useState<VoiceCatalogue | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const sample = useVoiceSample();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/voices')
      .then((response) =>
        response.ok ? (response.json() as Promise<VoiceCatalogue>) : Promise.reject(new Error()),
      )
      .then((loaded) => {
        if (!cancelled) setCatalogue(loaded);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const current =
    catalogue?.languages.find((option) => option.code === language) ?? catalogue?.languages[0];

  // Preselected, so somebody who does not care can start straight away. Also on a change
  // of language: a voice from the other list cannot speak this one. And the language is
  // only ever one the list offers, so the session can never start in Hindi with an
  // English voice.
  useEffect(() => {
    if (!current) return;
    if (current.code !== language) onLanguageChange(current.code);
    if (!current.voices.some((voice) => voice.id === value)) onChange(current.defaultVoiceId);
  }, [current, language, value, onChange, onLanguageChange]);

  // A choice is a nicety, never a gate. Without the list the session starts in the
  // deployment's default voice, exactly as it did before there was a choice.
  if (unavailable) {
    return (
      <p className="text-muted mt-8 text-sm">
        Voice choice is not available right now, so {TRAINER_NAME} will speak in the usual voice.
      </p>
    );
  }

  if (!catalogue || !current) {
    return <p className="text-muted mt-8 text-sm">Loading voices</p>;
  }

  return (
    <>
      {/* Shown only when there is a choice to make. A deployment with English alone
          looks exactly as it did before there was a second language. */}
      {catalogue.languages.length > 1 && (
        <fieldset className="mt-8 min-w-0" disabled={disabled}>
          <legend className="text-sm font-semibold">
            Language
            <span className="text-muted ml-2 font-normal">fixed once the session starts</span>
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {catalogue.languages.map((option) => {
              const selected = option.code === current.code;
              return (
                <label
                  key={option.code}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ring-1 transition-colors ring-inset ${
                    selected ? 'bg-charcoal-soft ring-teal' : 'ring-charcoal-line'
                  }`}
                >
                  <input
                    type="radio"
                    name="session-language"
                    value={option.code}
                    checked={selected}
                    onChange={() => {
                      sample.stop();
                      onLanguageChange(option.code);
                    }}
                    className="accent-teal size-4 shrink-0"
                  />
                  <span className="text-mist font-semibold" lang={option.code}>
                    {option.name}
                  </span>
                  {option.name !== option.englishName && (
                    <span className="text-muted text-xs">{option.englishName}</span>
                  )}
                </label>
              );
            })}
          </div>
          {current.code === 'hi' && (
            <p className="text-muted mt-2 text-xs leading-relaxed">
              {TRAINER_NAME} will teach and answer in Hindi, keeping technical terms in English. The
              slides stay in English. Speak Hindi, English or a mix of the two.
            </p>
          )}
        </fieldset>
      )}

      {/* min-w-0 because a fieldset will not shrink below its widest row by default,
          which is what once pushed the deck page wider than a phone. */}
      <fieldset className="mt-8 min-w-0" disabled={disabled}>
        <legend className="text-sm font-semibold">
          {TRAINER_NAME}&apos;s voice
          <span className="text-muted ml-2 font-normal">fixed once the session starts</span>
        </legend>

        <ul className="mt-2 space-y-1.5">
          {current.voices.map((voice) => {
            const selected = voice.id === value;
            const playing = sample.playing === voice.id;
            const loading = sample.loading === voice.id;
            return (
              <li
                key={voice.id}
                className={`flex items-center gap-3 rounded-md px-3 py-2 ring-1 transition-colors ring-inset ${
                  selected ? 'bg-charcoal-soft ring-teal' : 'ring-charcoal-line'
                }`}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="trainer-voice"
                    value={voice.id}
                    checked={selected}
                    onChange={() => onChange(voice.id)}
                    className="accent-teal size-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="text-mist text-sm font-semibold">{voice.name}</span>
                    <span className="text-muted ml-2 text-xs">{voice.accent}</span>
                    <span className="text-muted block truncate text-xs">{voice.description}</span>
                  </span>
                </label>

                {/* Outside the label, so hearing a voice does not choose it. */}
                <button
                  type="button"
                  onClick={() => (playing ? sample.stop() : void sample.play(voice.id))}
                  disabled={loading}
                  aria-label={
                    playing ? `Stop the sample of ${voice.name}` : `Play a sample of ${voice.name}`
                  }
                  className="text-mist ring-charcoal-line hover:bg-charcoal-line shrink-0 rounded-md px-2.5 py-1.5 text-xs font-semibold ring-1 transition-colors ring-inset disabled:cursor-wait disabled:opacity-60"
                >
                  {loading ? 'Loading' : playing ? 'Stop' : 'Listen'}
                </button>
              </li>
            );
          })}
        </ul>

        {sample.error && (
          <p role="status" className="text-muted mt-2 text-xs">
            {sample.error}
          </p>
        )}
      </fieldset>
    </>
  );
}
