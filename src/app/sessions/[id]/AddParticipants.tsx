'use client';

/**
 * Adding people to a session that has not finished, for an administrator (AI-26).
 *
 * Somebody who turns up unlisted, even once the session is under way, is added here: the
 * deck is assigned to them as setting the session up does, they do their profile and
 * pre-session assessment on their own device, and the facilitator then marks them
 * present, which shows them as having joined late. Nobody is removed this way.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ParticipantPicker, type PersonOption } from '../ParticipantPicker';

const BUTTON =
  'bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

export function AddParticipants({
  sessionId,
  started,
  candidates,
}: {
  sessionId: string;
  started: boolean;
  /** Participants in the company not yet listed. */
  candidates: PersonOption[];
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/training-sessions/${sessionId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: chosen }),
      });
      if (!response.ok) {
        const reply = (await response.json().catch(() => ({}))) as { error?: string };
        setError(reply.error ?? 'That did not work. Try again.');
        return;
      }
      setChosen([]);
      router.refresh();
    } catch {
      setError('The connection dropped. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="add-heading"
      className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5"
    >
      <h2 id="add-heading" className="text-lg font-bold">
        Add participants
      </h2>
      <p className="text-muted mt-1 text-sm">
        {started
          ? 'The session has started. Anybody added now does their profile and pre-session assessment on their own device, then joins, and is shown as joined late once marked present.'
          : 'Adding somebody assigns them the deck, so they can do their own steps on their own device.'}
      </p>
      {error && (
        <p
          role="alert"
          className="border-logo-red/40 bg-logo-red/10 mt-3 rounded-md border p-3 text-sm"
        >
          {error}
        </p>
      )}
      {candidates.length === 0 ? (
        <p className="text-muted mt-3 text-sm">
          Every participant in the company is already listed.
        </p>
      ) : (
        <>
          <ParticipantPicker
            people={candidates}
            chosen={chosen}
            onChange={setChosen}
            idPrefix="add-person"
            legend="People to add"
          />
          <button
            type="button"
            disabled={busy || chosen.length === 0}
            onClick={() => void add()}
            className={`${BUTTON} mt-4`}
          >
            Add to the session
          </button>
        </>
      )}
    </section>
  );
}
