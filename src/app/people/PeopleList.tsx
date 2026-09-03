'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Role } from '@/lib/roster/types';
import { otherRoleLabel, roleLabel } from '@/lib/auth/labels';
import { duration } from '@/lib/roster/stats';

export interface PersonLine {
  id: string;
  name: string;
  email: string;
  role: Role;
  assigned: number;
  completed: number;
  /** Opened and unfinished. */
  inProgress: number;
  /** Assigned and never opened. */
  notStarted: number;
  /** Seconds actually taught to them. */
  secondsSpent: number;
  lastActiveAt: string | null;
  /** True when the address is an administrator by deployment configuration. */
  pinnedAdmin: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'never';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'unknown';
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function PeopleList({ people, meId }: { people: PersonLine[]; meId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(what: string, url: string, init: RequestInit) {
    setBusy(what);
    setError(null);
    try {
      const response = await fetch(url, {
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
      <form
        className="border-charcoal-line bg-charcoal-soft flex flex-wrap items-end gap-3 rounded-xl border p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!email.trim()) return;
          void send('add', '/api/people', {
            method: 'POST',
            body: JSON.stringify({ email: email.trim(), name: name.trim() }),
          }).then(() => {
            setEmail('');
            setName('');
          });
        }}
      >
        <div className="min-w-48 flex-1">
          <label htmlFor="new-email" className="block text-sm font-semibold">
            Add somebody
          </label>
          <input
            id="new-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@technavious.com"
            className="bg-charcoal text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal mt-2 w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
          />
        </div>
        <div className="min-w-40 flex-1">
          <label htmlFor="new-name" className="block text-sm font-semibold">
            Name
            <span className="text-muted ml-2 font-normal">optional</span>
          </label>
          <input
            id="new-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-2 w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
          />
        </div>
        <button
          type="submit"
          disabled={busy !== null || !email.trim()}
          className="bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'add' ? 'Adding' : 'Add'}
        </button>
      </form>

      <p className="text-muted text-sm leading-relaxed">
        Somebody can be added before they have ever signed in, so a new starter can be given their
        training on their first day. Their assignments follow them across when they do sign in.
      </p>

      {error && (
        <p role="alert" className="border-logo-red/40 bg-logo-red/10 rounded-md border p-3 text-sm">
          {error}
        </p>
      )}

      {people.length === 0 ? (
        <p className="border-charcoal-line text-muted rounded-xl border border-dashed p-8 text-center text-sm">
          Nobody here yet.
        </p>
      ) : (
        <ul className="grid gap-3">
          {people.map((person) => (
            <li
              key={person.id}
              className="border-charcoal-line bg-charcoal-soft rounded-xl border px-5 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <Link
                    href={`/people/${encodeURIComponent(person.id)}`}
                    className="hover:text-teal font-semibold transition-colors"
                  >
                    {person.name || person.email}
                  </Link>
                  <p className="text-muted mt-0.5 text-sm">
                    {person.email}
                    {person.assigned === 0
                      ? ' · nothing assigned'
                      : ` · ${person.completed} of ${person.assigned} complete`}
                  </p>
                  {person.assigned > 0 && (
                    <p className="text-muted mt-0.5 text-xs">
                      {person.inProgress > 0 && `${person.inProgress} part-way · `}
                      {person.notStarted > 0 && `${person.notStarted} not started · `}
                      {person.secondsSpent > 0 && `${duration(person.secondsSpent)} in sessions · `}
                      last active {formatDate(person.lastActiveAt)}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${
                      person.role === 'admin'
                        ? 'bg-teal/15 text-teal'
                        : 'bg-charcoal-line text-muted'
                    }`}
                  >
                    {roleLabel(person.role, person.pinnedAdmin)}
                  </span>

                  {person.id === meId ? (
                    <span className="text-muted text-xs">you</span>
                  ) : person.pinnedAdmin ? (
                    <span
                      className="text-muted text-xs"
                      title="Set in the deployment configuration"
                    >
                      pinned
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void send(person.id, `/api/people/${encodeURIComponent(person.id)}`, {
                          method: 'PATCH',
                          body: JSON.stringify({
                            role: person.role === 'admin' ? 'trainee' : 'admin',
                          }),
                        })
                      }
                      className="border-charcoal-line text-muted hover:text-mist rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      Make {otherRoleLabel(person.role)}
                    </button>
                  )}

                  <Link
                    href={`/people/${encodeURIComponent(person.id)}`}
                    className="border-charcoal-line text-muted hover:text-mist rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors"
                  >
                    Assign
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
