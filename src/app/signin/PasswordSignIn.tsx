'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { MIN_PASSWORD_LENGTH, passwordProblem } from '@/lib/auth/password';
import { explainAuthError, sendReset, signInWithPassword } from '@/lib/firebase/client';

type Mode = 'signin' | 'first';

/**
 * Signing in, and setting a password the first time.
 *
 * One form with two modes rather than two pages, because from the person's side it
 * is one question — let me in — and which of the two applies is not something they
 * should have to work out before typing anything.
 *
 * Neither mode is open registration. Setting a password works only for an address an
 * administrator has already added, which the server checks; this form cannot tell in
 * advance whether it will succeed, and does not pretend to.
 */
export function PasswordSignIn({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const weak = mode === 'first' && password ? passwordProblem(password, email) : null;

  /** Signs in with the password just proven to work, and goes where they were going. */
  async function finish() {
    const idToken = await signInWithPassword(email, password);
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      // Refused by us rather than by Firebase. Drop the browser-side session too, or
      // the next attempt silently reuses the account that was just turned away.
      const { signOutOfFirebase } = await import('@/lib/firebase/client');
      await signOutOfFirebase().catch(() => undefined);
      throw new Error(result.error ?? 'That sign-in was refused.');
    }

    router.push(next);
    router.refresh();
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setResetSent(false);
    try {
      if (mode === 'first') {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), name: name.trim(), password }),
        });
        const result = (await response.json()) as { error?: string; signIn?: boolean };

        if (!response.ok) {
          // An address that already has a password belongs in the other mode, so send
          // them there rather than making them find it.
          if (result.signIn) setMode('signin');
          throw new Error(result.error ?? 'That did not work.');
        }
      }

      await finish();
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
      // Said the same way whether or not the address is known here, so this cannot be
      // used to find out which addresses have accounts.
      setResetSent(true);
    } catch (cause) {
      setError(explainAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  const field =
    'bg-charcoal-soft text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset';

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (email.trim() && password && !weak) void submit();
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
          className={`${field} mt-2`}
        />
      </div>

      {mode === 'first' && (
        <div>
          <label htmlFor="name" className="block text-sm font-semibold">
            Your name
            <span className="text-muted ml-2 font-normal">optional</span>
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={`${field} mt-2`}
          />
        </div>
      )}

      <div>
        <label htmlFor="password" className="block text-sm font-semibold">
          {mode === 'first' ? 'Choose a password' : 'Password'}
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete={mode === 'first' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={mode === 'first' ? `${MIN_PASSWORD_LENGTH} characters or more` : undefined}
          className={`${field} mt-2`}
        />
        {mode === 'first' && (
          <p className={`mt-2 text-xs leading-relaxed ${weak ? 'text-logo-red' : 'text-muted'}`}>
            {weak ?? 'A short phrase you will remember is stronger than a short word you will not.'}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={busy || !email.trim() || !password || weak !== null}
        className="bg-azure text-mist hover:bg-teal hover:text-charcoal w-full rounded-md px-6 py-3 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Just a moment' : mode === 'first' ? 'Set password and sign in' : 'Sign in'}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setMode(mode === 'signin' ? 'first' : 'signin');
            setPassword('');
            setError(null);
            setResetSent(false);
          }}
          className="text-muted hover:text-teal text-sm transition-colors disabled:opacity-50"
        >
          {mode === 'signin' ? 'First time here?' : 'I already have a password'}
        </button>

        {mode === 'signin' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void forgot()}
            className="text-muted hover:text-teal text-sm transition-colors disabled:opacity-50"
          >
            Forgotten it?
          </button>
        )}
      </div>

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
    </form>
  );
}
