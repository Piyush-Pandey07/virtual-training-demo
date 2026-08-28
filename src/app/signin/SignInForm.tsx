'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Role } from '@/lib/roster/types';

export interface Candidate {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/**
 * The development sign-in.
 *
 * Two ways in: pick somebody already in the roster, or name a new address, which
 * adds them as a trainee and signs in as them. That second path is how the first
 * person comes to exist at all, since there is nobody to add them yet.
 *
 * Replaced wholesale by a "Continue with Microsoft" button once Firebase is wired.
 * Nothing else on either dashboard depends on which of the two put the cookie there.
 */
export function SignInForm({ people, next }: { people: Candidate[]; next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(body: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not sign in.');

      router.push(next);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {people.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold">Someone already here</h2>
          <ul className="mt-3 grid gap-2">
            {people.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void signIn({ personId: person.id })}
                  className="border-charcoal-line bg-charcoal-soft hover:border-teal flex w-full items-center justify-between gap-4 rounded-md border px-4 py-3 text-left transition-colors disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">{person.name || person.email}</span>
                    <span className="text-muted block text-sm">{person.email}</span>
                  </span>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${
                      person.role === 'admin'
                        ? 'bg-teal/15 text-teal'
                        : 'bg-charcoal-line text-muted'
                    }`}
                  >
                    {person.role === 'admin' ? 'HR' : 'Trainee'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold">
          {people.length > 0 ? 'Or somebody new' : 'Add the first person'}
        </h2>
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (email.trim()) void signIn({ email: email.trim(), name: name.trim() });
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@technavious.com"
            className="bg-charcoal-soft text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
          />
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Their name, optional"
            className="bg-charcoal-soft text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
          />
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="bg-azure text-mist hover:bg-teal hover:text-charcoal w-full rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Signing in' : 'Sign in'}
          </button>
        </form>
      </section>

      {error && (
        <p role="alert" className="border-logo-red/40 bg-logo-red/10 rounded-md border p-3 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
