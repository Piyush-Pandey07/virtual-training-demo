'use client';

import { useState } from 'react';

import { advancedAbove, checkBands, describeBands } from '@/lib/assessments/scoring';
import type { LevelBands } from '@/lib/assessments/types';

/**
 * The two edges of the pre-session level bands, as people say them: where Intermediate
 * starts, and the score above which a participant is Advanced.
 *
 * Shared by a deck's question banks and a trainer-led session, so both ask the same
 * question in the same words and check it with the same rule the server does. The
 * stored shape counts Advanced from one more than what is typed here (see `LevelBands`).
 */

const BUTTON =
  'bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const INPUT =
  'border-charcoal-line bg-charcoal focus:border-teal mt-1 w-28 rounded-md border px-3 py-2 outline-none';

export function LevelBandsForm({
  current,
  onSave,
  savedText,
  disabled = false,
  unsaved = false,
}: {
  current: LevelBands;
  /** Saves the bands, and resolves to an error to show, or null once saved. */
  onSave: (bands: LevelBands) => Promise<string | null>;
  /** What to say once saved. */
  savedText: string;
  disabled?: boolean;
  /** `current` is only a suggestion, so saving it unchanged still means something. */
  unsaved?: boolean;
}) {
  const [intermediateFrom, setIntermediateFrom] = useState(String(current.intermediateFrom));
  const [above, setAbove] = useState(String(advancedAbove(current)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  // An empty box is not zero, so it is refused as not a number rather than read as one.
  const typed = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));
  const checked = checkBands({
    intermediateFrom: typed(intermediateFrom),
    advancedFrom: typed(above) + 1,
  });
  const changed =
    checked.ok &&
    (unsaved ||
      checked.bands.intermediateFrom !== current.intermediateFrom ||
      checked.bands.advancedFrom !== current.advancedFrom);

  async function save() {
    if (!checked.ok) return;
    setBusy(true);
    setMessage(null);
    try {
      const error = await onSave(checked.bands);
      setMessage(error ? { error: true, text: error } : { error: false, text: savedText });
    } catch {
      setMessage({ error: true, text: 'The connection dropped. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="text-sm">
          <span className="text-muted block">Intermediate from (%)</span>
          <input
            type="number"
            min={1}
            max={99}
            step={1}
            value={intermediateFrom}
            disabled={disabled}
            onChange={(event) => setIntermediateFrom(event.target.value)}
            className={INPUT}
          />
        </label>
        <label className="text-sm">
          <span className="text-muted block">Advanced above (%)</span>
          <input
            type="number"
            min={1}
            max={99}
            step={1}
            value={above}
            disabled={disabled}
            onChange={(event) => setAbove(event.target.value)}
            className={INPUT}
          />
        </label>
        <button type="submit" disabled={disabled || busy || !changed} className={BUTTON}>
          {busy ? 'Saving' : 'Save the bands'}
        </button>
      </form>
      <p
        className={`mt-3 text-sm ${checked.ok ? 'text-muted' : 'text-logo-red'}`}
        aria-live="polite"
      >
        {checked.ok ? (changed ? describeBands(checked.bands) : '') : checked.error}
      </p>
      {message && (
        <p
          role={message.error ? 'alert' : 'status'}
          className={`mt-2 text-sm ${message.error ? 'text-logo-red' : 'text-teal'}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
