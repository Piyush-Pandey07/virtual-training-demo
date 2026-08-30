'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Giving a deck to the people who have to attend it.
 *
 * The other half of this already existed on a person's own page, one deck at a time.
 * That is the right shape for "what else should Aditi do" and the wrong one for the
 * moment somebody has just finished reviewing a deck and wants twelve people on it:
 * assigning from the deck side is one pass down a list, and from the person side it is
 * twelve visits to twelve pages.
 *
 * Deliberately refuses to work on a draft. Assigning one would put content nobody has
 * checked in front of a trainee as company training, and the review screen is where
 * that check happens — so the panel explains the order rather than failing at the API.
 */

export interface Assignee {
  id: string;
  name: string;
  email: string;
  /** ISO 8601, or null when it was assigned with no date. */
  dueAt: string | null;
  assignedAt: string;
}

export interface Candidate {
  id: string;
  name: string;
  email: string;
  /** Shown beside the name, so assigning training to an administrator is deliberate. */
  admin: boolean;
}

interface AssignDeckProps {
  deckId: string;
  published: boolean;
  /** Everybody who could be given this deck and does not already have it. */
  candidates: Candidate[];
  assigned: Assignee[];
}

function describe(person: { name: string; email: string }): string {
  return person.name.trim() ? `${person.name} · ${person.email}` : person.email;
}

function onDate(iso: string | null): string {
  if (!iso) return '';
  const when = new Date(iso);
  return Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function AssignDeck({ deckId, published, candidates, assigned }: AssignDeckProps) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function toggle(id: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Assigns to everybody ticked.
   *
   * One request per person because that is what the route takes, and sequentially so a
   * partial failure can say who it got to. Reporting "3 of 5 assigned" beats reporting
   * a single error for a batch that half worked, because the next click has to know
   * which half.
   */
  async function assign() {
    setBusy(true);
    setError(null);
    setDone(null);

    const people = [...chosen];
    const failed: string[] = [];

    for (const personId of people) {
      try {
        const response = await fetch('/api/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personId, deckId, dueAt: dueAt || null }),
        });
        if (!response.ok) {
          const result = (await response.json()) as { error?: string };
          throw new Error(result.error ?? 'That did not work.');
        }
      } catch (cause) {
        failed.push(candidates.find((c) => c.id === personId)?.email ?? personId);
        setError((cause as Error).message);
      }
    }

    const worked = people.length - failed.length;
    if (worked > 0) {
      setDone(
        failed.length === 0
          ? `Assigned to ${worked} ${worked === 1 ? 'person' : 'people'}.`
          : `Assigned to ${worked} of ${people.length}. Not assigned: ${failed.join(', ')}.`,
      );
    }

    setChosen(new Set());
    setDueAt('');
    setBusy(false);
    router.refresh();
  }

  async function unassign(personId: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const response = await fetch('/api/assignments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId, deckId }),
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? 'That did not work.');
      }
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5">
      <h2 className="text-lg font-semibold">Who is doing this training</h2>

      {!published ? (
        <p className="text-muted mt-3 text-sm leading-relaxed">
          This deck is still a draft, so it cannot be given to anybody yet. Read what the trainer
          intends to say, then <span className="text-mist font-semibold">Publish</span> — a draft
          has not been checked by a person, and a trainee has no way to tell the difference.
        </p>
      ) : (
        <>
          {assigned.length > 0 && (
            <ul className="mt-4 space-y-2">
              {assigned.map((person) => (
                <li
                  key={person.id}
                  className="border-charcoal-line flex flex-wrap items-center gap-3 rounded-md border px-3.5 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">{describe(person)}</span>
                  {person.dueAt && (
                    <span className="text-muted shrink-0 text-xs">due {onDate(person.dueAt)}</span>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void unassign(person.id)}
                    className="text-muted hover:text-logo-red shrink-0 text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {candidates.length === 0 ? (
            <p className="text-muted mt-4 text-sm leading-relaxed">
              {assigned.length > 0
                ? 'Everybody on the roster already has this deck.'
                : 'There is nobody to assign it to yet. Add people first, and they appear here.'}
            </p>
          ) : (
            <form
              className="mt-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (chosen.size > 0) void assign();
              }}
            >
              <fieldset className="border-charcoal-line max-h-64 overflow-y-auto rounded-md border">
                <legend className="sr-only">People to assign this deck to</legend>
                {candidates.map((person) => (
                  <label
                    key={person.id}
                    className="hover:bg-charcoal flex cursor-pointer items-center gap-3 px-3.5 py-2.5 text-sm transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={chosen.has(person.id)}
                      onChange={() => toggle(person.id)}
                      disabled={busy}
                      className="accent-teal size-4 shrink-0"
                    />
                    <span className="min-w-0 truncate">{describe(person)}</span>
                    {person.admin && (
                      <span className="text-muted shrink-0 text-xs">administrator</span>
                    )}
                  </label>
                ))}
              </fieldset>

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="due" className="block text-sm font-semibold">
                    Due by
                    <span className="text-muted ml-2 font-normal">optional</span>
                  </label>
                  <input
                    id="due"
                    type="date"
                    value={dueAt}
                    onChange={(event) => setDueAt(event.target.value)}
                    disabled={busy}
                    className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-2 rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy || chosen.size === 0}
                  className="bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy
                    ? 'Assigning'
                    : chosen.size === 0
                      ? 'Assign'
                      : `Assign to ${chosen.size} ${chosen.size === 1 ? 'person' : 'people'}`}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {done && (
        <p className="border-teal/40 bg-teal/10 mt-4 rounded-md border p-3 text-sm">{done}</p>
      )}

      {error && (
        <p
          role="alert"
          className="border-logo-red/40 bg-logo-red/10 mt-4 rounded-md border p-3 text-sm"
        >
          {error}
        </p>
      )}
    </section>
  );
}
