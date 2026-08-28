'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
        void fetch('/api/auth/dev', { method: 'DELETE' })
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
