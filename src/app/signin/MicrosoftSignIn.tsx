'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { signInWithMicrosoft, signOutOfFirebase } from '@/lib/firebase/client';

/**
 * "Continue with Microsoft".
 *
 * Three steps, and the middle one is the point: sign in with Firebase, post the ID
 * token once to be swapped for a session cookie, then go where they were headed. The
 * ID token itself is never used again — it lasts an hour and lives in JavaScript,
 * neither of which suits something every server render has to check.
 */
export function MicrosoftSignIn({ next, tenantId }: { next: string; tenantId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const idToken = await signInWithMicrosoft(tenantId);

      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        // Refused by us, not by Microsoft. Drop the browser-side session too, or the
        // next attempt silently reuses the account that was just turned away.
        await signOutOfFirebase().catch(() => undefined);
        throw new Error(result.error ?? 'That sign-in was refused.');
      }

      router.push(next);
      router.refresh();
    } catch (cause) {
      const message = (cause as Error).message ?? 'Sign-in failed.';
      setError(
        message.includes('popup-closed') || message.includes('cancelled')
          ? 'The sign-in window was closed before it finished.'
          : message,
      );
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        disabled={busy}
        onClick={() => void start()}
        className="bg-azure text-mist hover:bg-teal hover:text-charcoal w-full rounded-md px-6 py-3 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Signing in' : 'Continue with Microsoft'}
      </button>

      {error && (
        <p role="alert" className="border-logo-red/40 bg-logo-red/10 rounded-md border p-3 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
