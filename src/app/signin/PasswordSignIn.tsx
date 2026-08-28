'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { explainAuthError, sendReset, signInWithPassword } from '@/lib/firebase/client';

/**
 * Signing in with an email address and a password.
 *
 * Accounts are not created here. They come from an invitation, which is checked on
 * the server before an account exists at all — so somebody with no account is told
 * to ask for an invitation rather than offered a sign-up form that would let anyone
 * with the public API key in.
 */
export function PasswordSignIn({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    setResetSent(false);
    try {
      const idToken = await signInWithPassword(email, password);

      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        // Refused by us rather than by Firebase. Drop the browser-side session too,
        // or the next attempt silently reuses the account just turned away.
        const { signOutOfFirebase } = await import('@/lib/firebase/client');
        await signOutOfFirebase().catch(() => undefined);
        throw new Error(result.error ?? 'That sign-in was refused.');
      }

      router.push(next);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error && !('code' in cause) ? cause.message : explainAuthError(cause),
      );
      setBusy(false);
    }
  }

  async function forgot() {
    if (!email.trim()) {
      setError('Type your email address first, then ask for a reset.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendReset(email);
      // Said the same way whether or not the address is known here, so this form
      // cannot be used to find out which addresses have accounts.
      setResetSent(true);
    } catch (cause) {
      setError(explainAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (email.trim() && password) void submit();
      }}
    >
      <div>
        <label htmlFor="email" className="block text-sm font-semibold">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@technavious.com"
          className="bg-charcoal-soft text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal mt-2 w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-semibold">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="bg-charcoal-soft text-mist ring-charcoal-line focus:ring-teal mt-2 w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
        />
      </div>

      <button
        type="submit"
        disabled={busy || !email.trim() || !password}
        className="bg-azure text-mist hover:bg-teal hover:text-charcoal w-full rounded-md px-6 py-3 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Signing in' : 'Sign in'}
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={() => void forgot()}
        className="text-muted hover:text-teal w-full text-sm transition-colors disabled:opacity-50"
      >
        Forgotten your password?
      </button>

      {resetSent && (
        <p className="border-teal/40 bg-teal/10 rounded-md border p-3 text-sm">
          If that address has an account here, a reset link is on its way to it.
        </p>
      )}

      {error && (
        <p role="alert" className="border-logo-red/40 bg-logo-red/10 rounded-md border p-3 text-sm">
          {error}
        </p>
      )}

      <p className="text-muted pt-2 text-sm leading-relaxed">
        No account? Accounts are created from an invitation. Ask whoever runs your training to send
        you a link.
      </p>
    </form>
  );
}
