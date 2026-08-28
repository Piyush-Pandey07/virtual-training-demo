'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Accepting an invitation.
 *
 * Three shapes, decided by the server before this renders: somebody already signed
 * in just confirms; a personal invitation already knows the address; an open one
 * asks for it.
 */
export function AcceptInvite({
  token,
  signedInAs,
  boundEmail,
}: {
  token: string;
  signedInAs: string | null;
  boundEmail: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsEmail = !signedInAs && !boundEmail;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email: email.trim(), name: name.trim() }),
      });
      const result = (await response.json()) as { error?: string; signIn?: boolean };

      if (result.signIn) {
        // Sign in first, carrying the token so they land back here afterwards.
        router.push(`/signin?next=${encodeURIComponent(`/invite/${token}`)}`);
        return;
      }
      if (!response.ok) throw new Error(result.error ?? 'That did not work.');

      router.push('/');
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-4">
      {signedInAs && (
        <p className="text-muted text-sm">
          You are signed in as <span className="text-mist font-semibold">{signedInAs}</span>.
        </p>
      )}

      {needsEmail && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (email.trim()) void accept();
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
            placeholder="Your name, optional"
            className="bg-charcoal-soft text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
          />
        </form>
      )}

      <button
        type="button"
        disabled={busy || (needsEmail && !email.trim())}
        onClick={() => void accept()}
        className="bg-azure text-mist hover:bg-teal hover:text-charcoal w-full rounded-md px-6 py-3 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Accepting' : 'Accept and start'}
      </button>

      {error && (
        <p role="alert" className="border-logo-red/40 bg-logo-red/10 rounded-md border p-3 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
