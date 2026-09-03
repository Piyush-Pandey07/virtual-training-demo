'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { MIN_PASSWORD_LENGTH, passwordProblem } from '@/lib/auth/password';
import {
  explainAuthError,
  sendReset,
  sendVerification,
  signInWithPassword,
} from '@/lib/firebase/client';
import type { Role } from '@/lib/roster/types';

type Mode = 'signin' | 'first';

/**
 * What somebody says they are, which is not what they are.
 *
 * Three now rather than two, because being an administrator of one customer and being
 * Technavious are different things and the page had no way to say so. None of the three
 * grants anything: the role comes from the roster and the platform list, both decided
 * on the server, and this choice is never sent anywhere. Whoever holds the page could
 * otherwise elect themselves.
 */
type Expecting = 'platform' | 'company' | 'employee';

/**
 * Signing in, and setting a password the first time.
 *
 * The three buttons at the top choose which kind of person is signing in. They do not
 * choose the role, and cannot: whoever holds the page could otherwise pick Admin. The
 * role comes from the roster and the platform list, both decided on the server,
 * exactly as it did before this control existed.
 *
 * What they do is set expectations, and make a mismatch something the person is told
 * about rather than something they puzzle over. Somebody who picks Company and turns
 * out to be an employee is shown their own training with a line saying so, instead of
 * an administrator's page they cannot see quietly not appearing.
 *
 * Employee is selected by default because almost every sign-in is one. Admin is listed
 * first because that is the order these were asked for, and being first is not the
 * same as being the common case.
 *
 * One form under all three, because from the person's side it is one question -- let
 * me in -- and which case applies is not something they should work out before typing
 * anything.
 */
const NOTES: Record<Expecting, string> = {
  employee:
    'You are signed in as an employee. If you should have administrator access, ask whoever runs your training.',
  company: 'You are signed in as an administrator of your company.',
  platform: 'You are signed in as Technavious, with access to every customer.',
};

export function PasswordSignIn({ next }: { next: string }) {
  const router = useRouter();
  const [expecting, setExpecting] = useState<Expecting>('employee');
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [verifySent, setVerifySent] = useState(false);

  const weak = mode === 'first' && password ? passwordProblem(password, email) : null;

  /** Signs in with the password just proven to work, and goes where they were going. */
  async function finish() {
    const idToken = await signInWithPassword(email, password);
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const result = (await response.json()) as {
      error?: string;
      role?: Role;
      platform?: boolean;
    };

    if (!response.ok) {
      // Refused by us rather than by Firebase. Drop the browser-side session too, or
      // the next attempt silently reuses the account that was just turned away.
      const { signOutOfFirebase } = await import('@/lib/firebase/client');
      await signOutOfFirebase().catch(() => undefined);
      throw new Error(result.error ?? 'That sign-in was refused.');
    }

    // What the server decided, which is the only thing that counts. Said out loud only
    // when it differs from what they picked: somebody who chose Technavious and is in
    // fact a trainee should be told, rather than left wondering where the customer
    // list went.
    const actual: Expecting = result.platform
      ? 'platform'
      : result.role === 'admin'
        ? 'company'
        : 'employee';

    if (result.role && actual !== expecting) {
      setNote(NOTES[actual]);
    }

    router.push(next);
    router.refresh();
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setNote(null);
    setResetSent(false);
    setVerifySent(false);
    try {
      if (mode === 'first') {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), name: name.trim(), password }),
        });
        const result = (await response.json()) as {
          error?: string;
          signIn?: boolean;
          verify?: boolean;
        };

        if (!response.ok) {
          // An address that already has a password belongs in the other mode, so send
          // them there rather than making them find it.
          if (result.signIn) setMode('signin');
          throw new Error(result.error ?? 'That did not work.');
        }

        // Nobody vouched for this address, so it has to prove it before it gets a
        // session. Stopping here rather than trying to sign in is the point: the
        // attempt would be refused for being unverified, and "your email address is
        // unverified" reads as a failure when it is the expected next step.
        if (result.verify) {
          await sendVerification(email.trim(), password);
          setVerifySent(true);
          setMode('signin');
          setPassword('');
          setBusy(false);
          return;
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

  const CHOICES: Array<{ kind: Expecting; label: string; blurb: string }> = [
    {
      kind: 'platform',
      label: 'Admin',
      blurb: 'Technavious. Look after every company using this platform.',
    },
    {
      kind: 'company',
      label: 'Company',
      blurb: 'Upload decks, assign them, and see who has attended at your company.',
    },
    {
      kind: 'employee',
      label: 'Employee',
      blurb: 'Attend the training you have been given.',
    },
  ];

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (email.trim() && password && !weak) void submit();
      }}
    >
      <div>
        <div
          role="radiogroup"
          aria-label="What are you signing in as?"
          className="border-charcoal-line grid grid-cols-3 gap-1 rounded-lg border p-1"
        >
          {CHOICES.map((choice) => {
            const on = expecting === choice.kind;
            return (
              <button
                key={choice.kind}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setExpecting(choice.kind);
                  setNote(null);
                }}
                className={`rounded-md px-4 py-2.5 text-sm font-semibold transition-colors ${
                  on ? 'bg-azure text-mist' : 'text-muted hover:text-mist'
                }`}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
        <p className="text-muted mt-2 text-xs leading-relaxed">
          {CHOICES.find((choice) => choice.kind === expecting)?.blurb}
        </p>
      </div>

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setMode(mode === 'signin' ? 'first' : 'signin');
            setPassword('');
            setError(null);
            setNote(null);
            setResetSent(false);
            setVerifySent(false);
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

      {note && <p className="border-azure/40 bg-azure/10 rounded-md border p-3 text-sm">{note}</p>}

      {verifySent && (
        <p className="border-teal/40 bg-teal/10 rounded-md border p-3 text-sm">
          Your password is set. Check your email for a link confirming the address is yours, then
          come back and sign in.
        </p>
      )}

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
