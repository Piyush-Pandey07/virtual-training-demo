'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { MIN_PASSWORD_LENGTH, passwordProblem } from '@/lib/auth/password';
import { explainAuthError, signInWithPassword } from '@/lib/firebase/client';

/**
 * Creating the first administrator.
 *
 * Only offered while no administrator exists, and only accepts an address the
 * deployment configuration already names as one. It stops being offered the moment
 * it has been used.
 */
export function FirstAdmin({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weak = password ? passwordProblem(password, email) : null;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim(), password }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'That did not work.');

      // Straight in with the password just chosen, through the one route that decides
      // who somebody is.
      const idToken = await signInWithPassword(email, password);
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      router.push(next);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error && !('code' in cause) ? cause.message : explainAuthError(cause),
      );
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (email.trim() && password && !weak) void create();
      }}
    >
      <input
        type="email"
        required
        autoComplete="username"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="name@technavious.com"
        className="bg-charcoal-soft text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
      />
      <input
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Your name, optional"
        className="bg-charcoal-soft text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
      />
      <div>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={`Choose a password, ${MIN_PASSWORD_LENGTH} characters or more`}
          className="bg-charcoal-soft text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
        />
        {weak && <p className="text-logo-red mt-2 text-xs leading-relaxed">{weak}</p>}
      </div>

      <button
        type="submit"
        disabled={busy || !email.trim() || !password || weak !== null}
        className="bg-azure text-mist hover:bg-teal hover:text-charcoal w-full rounded-md px-6 py-3 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Setting up' : 'Create the first administrator'}
      </button>

      {error && (
        <p role="alert" className="border-logo-red/40 bg-logo-red/10 rounded-md border p-3 text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
