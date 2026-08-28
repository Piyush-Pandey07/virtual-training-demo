'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { signOutOfFirebase } from '@/lib/firebase/client';

/** Clears the session and returns to the sign-in page. */
export function SignOutButton({ label = 'Sign out' }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        // Both halves. Clearing only the cookie would leave the browser still signed
        // in to Microsoft, so the next attempt would walk straight back in without
        // asking, which is not what anybody means by signing out.
        void Promise.all([
          fetch('/api/auth/session', { method: 'DELETE' }).catch(() => undefined),
          fetch('/api/auth/dev', { method: 'DELETE' }).catch(() => undefined),
          signOutOfFirebase().catch(() => undefined),
        ])
          .catch(() => undefined)
          .then(() => {
            router.push('/signin');
            // The refresh matters as much as the push: rendered server components
            // are cached client-side, so without it the back button can show a page
            // belonging to the person who just signed out.
            router.refresh();
          });
      }}
      className="text-muted hover:text-teal text-sm transition-colors disabled:opacity-50"
    >
      {busy ? 'Signing out' : label}
    </button>
  );
}
