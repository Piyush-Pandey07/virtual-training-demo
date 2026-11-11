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

import { formatMoment } from '@/lib/time';
import type { AttendanceMark, SummaryRow, TrainingSession } from '@/lib/training/types';
import { attendanceWord, feedbackWord, resultWord } from '@/lib/training/words';

interface Props {
  session: TrainingSession;
  participants: { id: string; name: string }[];
  deckAvailable: boolean;
  /** The closure summary (AI-33). Null if it could not be read. */
  summary: {
    rows: SummaryRow[];
    totals: {
      listed: number;
      present: number;
      absent: number;
      passed: number;
      feedbackGiven: number;
    };
  } | null;
  resultsLink: string;
}

const BUTTON =
  'bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

function markLabel(mark: AttendanceMark | undefined): string {
  return attendanceWord(mark);
}

export function SessionRecord({
  session,
  participants,
  deckAvailable,
  summary,
  resultsLink,
}: Props) {
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
            ? `Closed ${formatMoment(session.closedAt ?? session.createdAt)}.`
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

      {summary && (
        <section aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="text-xl font-bold">
            Closure summary
          </h2>
          <p className="text-muted mt-1 text-sm">
            {summary.totals.present} of {summary.totals.listed} present, {summary.totals.passed}{' '}
            passed the post-session assessment, {summary.totals.feedbackGiven} gave feedback.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted border-charcoal-line border-b">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Participant</th>
                  <th className="py-2 pr-4 font-semibold">Attendance</th>
                  <th className="py-2 pr-4 font-semibold">Pre-session level</th>
                  <th className="py-2 pr-4 font-semibold">Post-session</th>
                  <th className="py-2 font-semibold">Feedback</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((row) => (
                  <tr key={row.personId} className="border-charcoal-line border-b">
                    <td className="text-mist py-2 pr-4">{row.name}</td>
                    <td className="py-2 pr-4">{attendanceWord(row.attendance)}</td>
                    <td className="py-2 pr-4">{row.preLevel ?? 'Not taken'}</td>
                    <td className="py-2 pr-4">
                      {row.postPercent === null
                        ? resultWord(row)
                        : `${row.postPercent}%, ${resultWord(row)}`}
                    </td>
                    <td className="py-2">{feedbackWord(row.feedback)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <a
              href={`/api/training-sessions/${session.id}/summary`}
              className="text-teal hover:underline"
            >
              Download the summary
            </a>
            <Link href={resultsLink} className="text-teal hover:underline">
              Results and feedback in detail
            </Link>
          </div>
        </section>
      )}

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
