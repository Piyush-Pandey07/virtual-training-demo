'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ProgressBar } from '@/components/ProgressBar';
import type { ProgressRow } from '@/lib/roster/types';

export interface AssignableDeck {
  id: string;
  title: string;
  slideCount: number;
  estimatedMinutes: number;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'unknown';
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function PersonDetail({
  personId,
  rows,
  assignable,
}: {
  personId: string;
  rows: ProgressRow[];
  assignable: AssignableDeck[];
}) {
  const router = useRouter();
  const [deckId, setDeckId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(what: string, init: RequestInit) {
    setBusy(what);
    setError(null);
    try {
      const response = await fetch('/api/assignments', {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'That did not work.');
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5">
        <h2 className="font-semibold">Assign a deck</h2>

        {assignable.length === 0 ? (
          <p className="text-muted mt-3 text-sm leading-relaxed">
            Nothing left to assign. Only published decks can be given to somebody, since a draft has
            not been checked by anybody yet.
          </p>
        ) : (
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!deckId) return;
              void send('assign', {
                method: 'POST',
                body: JSON.stringify({ personId, deckId, dueAt: dueAt || null }),
              }).then(() => {
                setDeckId('');
                setDueAt('');
              });
            }}
          >
            <div className="min-w-56 flex-1">
              <label htmlFor="deck" className="block text-sm font-semibold">
                Deck
              </label>
              <select
                id="deck"
                value={deckId}
                onChange={(event) => setDeckId(event.target.value)}
                className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-2 w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
              >
                <option value="">Choose a deck</option>
                {assignable.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.title} · {deck.estimatedMinutes} min
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="due" className="block text-sm font-semibold">
                Due
                <span className="text-muted ml-2 font-normal">optional</span>
              </label>
              <input
                id="due"
                type="date"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-2 rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
              />
            </div>

            <button
              type="submit"
              disabled={busy !== null || !deckId}
              className="bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'assign' ? 'Assigning' : 'Assign'}
            </button>
          </form>
        )}
      </section>

      {error && (
        <p role="alert" className="border-logo-red/40 bg-logo-red/10 rounded-md border p-3 text-sm">
          {error}
        </p>
      )}

      <section>
        <h2 className="text-xl font-semibold">Assigned training</h2>

        {rows.length === 0 ? (
          <p className="border-charcoal-line text-muted mt-4 rounded-xl border border-dashed p-8 text-center text-sm">
            Nothing assigned yet.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {rows.map((row) => (
              <li
                key={row.deckId}
                className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{row.deckTitle ?? row.deckId}</p>
                    <p className="text-muted mt-0.5 text-sm">
                      Assigned {formatDate(row.assignedAt)}
                      {row.dueAt ? ` · due ${formatDate(row.dueAt)}` : ''} · last attended{' '}
                      {formatDate(row.lastSeenAt)}
                    </p>
                  </div>

                  <span
                    className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${
                      row.completedAt
                        ? 'bg-teal/15 text-teal'
                        : row.percent > 0
                          ? 'bg-azure/20 text-azure-bright'
                          : 'bg-charcoal-line text-muted'
                    }`}
                  >
                    {row.completedAt
                      ? 'Complete'
                      : row.percent > 0
                        ? `${row.percent}%`
                        : 'Not started'}
                  </span>
                </div>

                <div className="mt-4">
                  <ProgressBar percent={row.percent} complete={row.completedAt !== null} />
                </div>

                <div className="text-muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span>
                    {row.coverage.coveredCount} of {row.coverage.slideCount} slides taught
                  </span>
                  {row.completedAt && <span>Completed {formatDate(row.completedAt)}</span>}
                  {row.deckChangedSince && (
                    <span className="text-azure-bright">
                      This deck has been re-analysed since they started, so the figure is against
                      the deck as it was.
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void send(row.deckId, {
                        method: 'DELETE',
                        body: JSON.stringify({ personId, deckId: row.deckId }),
                      })
                    }
                    className="hover:text-mist underline transition-colors disabled:opacity-50"
                  >
                    Unassign
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
