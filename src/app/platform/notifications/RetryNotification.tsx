'use client';

/**
 * "Retry now" for one notification that is held, waiting or failed (AI-35).
 *
 * Sends at once rather than waiting for the backoff or the daily run, and says what
 * happened, in the outbox's own words, before refreshing the list.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { NOTIFICATION_STATUS_LABELS, type NotificationStatus } from '@/lib/notifications/types';

export function RetryNotification({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const retry = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/platform/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        outcome?: string;
        notification?: { status: NotificationStatus; lastError: string | null };
      };
      if (!response.ok) throw new Error(body.error ?? `Could not retry (${response.status}).`);
      const status = body.notification?.status;
      setMessage(
        body.outcome === 'skipped'
          ? 'Already being sent, or already sent.'
          : status
            ? `${NOTIFICATION_STATUS_LABELS[status]}${body.notification?.lastError && status !== 'sent' ? `: ${body.notification.lastError}` : ''}`
            : 'Done.',
      );
      router.refresh();
    } catch (caught) {
      setMessage((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => void retry()}
        disabled={busy}
        className="text-teal text-xs font-semibold hover:underline disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Retry now'}
      </button>
      {message && (
        <span className="text-muted block text-xs" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
