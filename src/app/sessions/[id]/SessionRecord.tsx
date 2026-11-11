'use client';

/**
 * Attendance and closing for one trainer-led session (AI-32).
 *
 * The facilitator marks each listed participant present or absent, and only they, or an
 * administrator, can close the session. Closing asks for everybody to be marked first,
 * so an absence is a decision rather than an omission; a closed session cannot be
 * changed or reopened. Before it starts, the same people may cancel it instead, which
 * keeps it on record as cancelled. Somebody marked present after it opened is shown as
 * having joined late (AI-26). There is no slide-by-slide progress for a trainer-led
 * session.
 *
 * The session's level bands are here too: filled from the deck when it was set up, and
 * changed by the same people until it closes. They decide each participant's level for
 * this session, and so the level the trainer pitches to.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { LevelBandsForm } from '@/components/LevelBandsForm';
import { describeBands } from '@/lib/assessments/scoring';
import { DEFAULT_LEVEL_BANDS, type LevelBands } from '@/lib/assessments/types';
import { formatMoment } from '@/lib/time';
import type { AttendanceMark, SummaryRow, TrainingSession } from '@/lib/training/types';
import {
  attendanceWord,
  feedbackWord,
  joinedLate,
  NO_REOPENING,
  NO_RUNNING_CANCELLED,
  resultWord,
} from '@/lib/training/words';

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
      joinedLate: number;
      absent: number;
      passed: number;
      feedbackGiven: number;
    };
  } | null;
  resultsLink: string;
}

const BUTTON =
  'bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

function markLabel(mark: AttendanceMark | undefined, late = false): string {
  return attendanceWord(mark, late);
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
  const cancelled = session.status === 'cancelled';
  // Either way it is a record now, and nothing on it can be changed.
  const finished = closed || cancelled;

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

  async function saveBands(levelBands: LevelBands): Promise<string | null> {
    const response = await fetch(`/api/training-sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ levelBands }),
    });
    if (!response.ok) {
      const reply = (await response.json().catch(() => ({}))) as { error?: string };
      return reply.error ?? 'The bands could not be saved. Try again.';
    }
    router.refresh();
    return null;
  }

  function cancel() {
    if (
      !window.confirm(
        'Cancel this session? It stays on record as cancelled, and cannot be run. To run it later, set up a new one.',
      )
    ) {
      return;
    }
    void change({ status: 'cancelled' });
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="border-logo-red/40 bg-logo-red/10 rounded-md border p-3 text-sm">
          {error}
        </p>
      )}

      {finished && (
        <p className="border-charcoal-line bg-charcoal-soft rounded-md border p-4 text-sm">
          {cancelled
            ? `Cancelled${session.cancelledAt ? ` ${formatMoment(session.cancelledAt)}` : ''}. ${NO_RUNNING_CANCELLED}`
            : NO_REOPENING}
        </p>
      )}

      {!finished && deckAvailable && (
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
            : cancelled
              ? 'Nobody attended: the session was cancelled.'
              : unmarked > 0
                ? `${unmarked} still to mark. Everybody must be marked before the session can be closed.`
                : 'Everybody is marked.'}
        </p>
        {!finished && (
          <p className="text-muted mt-1 text-xs">
            Mark those in the room before you start. Anybody marked present after the session starts
            is shown as joined late, and can do the pre-session assessment on their own device until
            you mark them.
          </p>
        )}
        <ul className="border-charcoal-line mt-4 rounded-xl border">
          {participants.map((person) => {
            const current = session.attendance[person.id];
            const late = joinedLate(session, person.id);
            return (
              <li
                key={person.id}
                className="border-charcoal-line flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0"
              >
                <span className="text-mist min-w-0 flex-1">
                  {person.name}
                  {late && !finished && (
                    <span className="text-azure-bright ml-2 text-xs font-semibold">
                      Joined late
                      {session.attendanceAt?.[person.id]
                        ? `, ${formatMoment(session.attendanceAt[person.id]!)}`
                        : ''}
                    </span>
                  )}
                </span>
                {finished ? (
                  <span
                    className={
                      current === 'absent' ? 'text-logo-red text-sm' : 'text-muted text-sm'
                    }
                  >
                    {markLabel(current, late)}
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

      {!cancelled && (
        <section aria-labelledby="bands-heading">
          <h2 id="bands-heading" className="text-xl font-bold">
            Level bands
          </h2>
          <p className="text-muted mt-1 text-sm leading-relaxed">
            Where each participant&rsquo;s pre-session score places them for this session, and so
            the level the trainer pitches to: the level most attendees are at, the lower one on a
            tie, with anybody not assessed counted as Beginner. Nobody fails the pre-session
            assessment.{' '}
            {session.levelBands
              ? describeBands(session.levelBands)
              : 'This session was set up before sessions had their own bands, so each participant keeps the level their result gave until bands are saved here.'}
          </p>
          {!closed && (
            <div className="mt-4">
              <LevelBandsForm
                current={session.levelBands ?? DEFAULT_LEVEL_BANDS}
                unsaved={!session.levelBands}
                onSave={saveBands}
                savedText="Saved. Levels for this session now use these bands."
              />
            </div>
          )}
        </section>
      )}

      {!summary && !cancelled && (
        <p className="border-logo-red/40 bg-logo-red/10 rounded-md border p-4 text-sm">
          The closure summary could not be read just now. Reload the page to try again.
        </p>
      )}

      {summary && !cancelled && (
        <section aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="text-xl font-bold">
            Closure summary
          </h2>
          <p className="text-muted mt-1 text-sm">
            {summary.totals.present} of {summary.totals.listed} present
            {summary.totals.joinedLate > 0
              ? ` (${summary.totals.joinedLate} joined late)`
              : ''}, {summary.totals.passed} passed the post-session assessment,{' '}
            {summary.totals.feedbackGiven} gave feedback.
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
                    <td className="py-2 pr-4">{attendanceWord(row.attendance, row.joinedLate)}</td>
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
              Download the summary (Excel)
            </a>
            <Link href={resultsLink} className="text-teal hover:underline">
              Results and feedback in detail
            </Link>
          </div>
        </section>
      )}

      {!finished && (
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            disabled={busy || unmarked > 0}
            onClick={() => void change({ status: 'closed' })}
            className={BUTTON}
          >
            Close the session
          </button>
          {session.status === 'scheduled' && (
            <button
              type="button"
              disabled={busy}
              onClick={cancel}
              className="text-muted hover:text-logo-red text-sm font-semibold disabled:opacity-50"
            >
              Cancel the session
            </button>
          )}
        </div>
      )}
    </div>
  );
}
