'use client';

/**
 * Choosing the trainer's voice, on the lobby, before the session starts.
 *
 * Knows nothing about where the voices come from. The list is whatever /api/voices
 * returns, samples come from /api/voices/sample, and an id is passed back untouched, so
 * a different provider later changes the server and leaves this screen alone. That was
 * asked for in so many words, and guarded in voice.test.ts.
 *
 * Only ever rendered on the lobby. Once the session starts the lobby is gone, and
 * nothing returns a running session to it, so there is no point at which the voice can
 * be changed mid-session.
 */

import { useEffect, useState } from 'react';

import { useVoiceSample } from '@/hooks/useVoiceSample';
import type { VoiceCatalogue } from '@/lib/voice/catalogue';
import { TRAINER_NAME } from '@/lib/trainer';

interface VoicePickerProps {
  /** The chosen voice id, or null before the list has loaded. */
  value: string | null;
  onChange: (voiceId: string) => void;
  disabled?: boolean;
}

export function VoicePicker({ value, onChange, disabled = false }: VoicePickerProps) {
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

  // Preselected, so somebody who does not care can start straight away.
  useEffect(() => {
    if (catalogue && !value) onChange(catalogue.defaultVoiceId);
  }, [catalogue, value, onChange]);

  // A choice is a nicety, never a gate. Without the list the session starts in the
  // deployment's default voice, exactly as it did before there was a choice.
  if (unavailable) {
    return (
      <p className="text-muted mt-8 text-sm">
        Voice choice is not available right now, so {TRAINER_NAME} will speak in the usual voice.
      </p>
    );
  }

  if (!catalogue) {
    return <p className="text-muted mt-8 text-sm">Loading voices</p>;
  }

  return (
    // min-w-0 because a fieldset will not shrink below its widest row by default, which
    // is what once pushed the deck page wider than a phone.
    <fieldset className="mt-8 min-w-0" disabled={disabled}>
      <legend className="text-sm font-semibold">
        {TRAINER_NAME}&apos;s voice
        <span className="text-muted ml-2 font-normal">fixed once the session starts</span>
      </legend>

      <ul className="mt-2 space-y-1.5">
        {catalogue.voices.map((voice) => {
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
  );
}
