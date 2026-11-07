'use client';

/**
 * Attendance and closing for one trainer-led session (AI-32).
 *
 * The facilitator marks each listed participant present or absent, and only they, or an
 * administrator, can close the session. Closing asks for everybody to be marked first,
 * so an absence is a decision rather than an omission; a closed session cannot be
 * changed. There is no slide-by-slide progress for a trainer-led session.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { AttendanceMark, TrainingSession } from '@/lib/training/types';

interface Props {
  session: TrainingSession;
  participants: { id: string; name: string }[];
  deckAvailable: boolean;
}

const BUTTON =
  'bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

function markLabel(mark: AttendanceMark | undefined): string {
  if (mark === 'absent') return 'Absent';
  if (mark === 'present') return 'Present';
  return 'Not marked';
}

export function SessionRecord({ session, participants, deckAvailable }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closed = session.status === 'closed';

  async function change(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/training-sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const reply = (await response.json().catch(() => ({}))) as { error?: string };
        setError(reply.error ?? 'That did not work. Try again.');
        return;
      }
      router.refresh();
    } catch {
      setError('The connection dropped. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const unmarked = participants.filter((person) => !session.attendance[person.id]).length;

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="border-logo-red/40 bg-logo-red/10 rounded-md border p-3 text-sm">
          {error}
        </p>
      )}

      {!closed && deckAvailable && (
        <Link href={`/sessions/${session.id}/run`} className={`${BUTTON} inline-block`}>
          {session.status === 'open' ? 'Carry on running it' : 'Run it on this screen'}
        </Link>
      )}

      <section aria-labelledby="attendance-heading">
        <h2 id="attendance-heading" className="text-xl font-bold">
          Attendance
        </h2>
        <p className="text-muted mt-1 text-sm">
          {closed
            ? `Closed ${new Date(session.closedAt ?? session.createdAt).toLocaleString('en-GB')}.`
            : unmarked > 0
              ? `${unmarked} still to mark. Everybody must be marked before the session can be closed.`
              : 'Everybody is marked.'}
        </p>
        <ul className="border-charcoal-line mt-4 rounded-xl border">
          {participants.map((person) => {
            const current = session.attendance[person.id];
            return (
              <li
                key={person.id}
                className="border-charcoal-line flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0"
              >
                <span className="text-mist min-w-0 flex-1">{person.name}</span>
                {closed ? (
                  <span
                    className={
                      current === 'absent' ? 'text-logo-red text-sm' : 'text-muted text-sm'
                    }
                  >
                    {markLabel(current)}
                  </span>
                ) : (
                  <div
                    className="flex gap-2"
                    role="group"
                    aria-label={`Attendance for ${person.name}`}
                  >
                    {(['present', 'absent'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={current === value}
                        disabled={busy}
                        onClick={() => void change({ attendance: { [person.id]: value } })}
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold ring-1 transition-colors ring-inset ${
                          current === value
                            ? value === 'present'
                              ? 'bg-teal/15 text-teal ring-teal'
                              : 'bg-logo-red/15 text-logo-red ring-logo-red'
                            : 'text-muted ring-charcoal-line hover:text-mist'
                        }`}
                      >
                        {markLabel(value)}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {!closed && (
        <button
          type="button"
          disabled={busy || unmarked > 0}
          onClick={() => void change({ status: 'closed' })}
          className={BUTTON}
        >
          Close the session
        </button>
      )}
    </div>
  );
}
