/**
 * Email notifications, for Technavious administrators only (AI-35).
 *
 * Every email the portal has written to the training team this month and last: what it
 * was about, whether it went, how many tries it took and what went wrong last. A held or
 * failed one can be retried from here at once. Linked from the developer log, where the
 * failed sends themselves are logged.
 *
 * Without RESEND_API_KEY nothing is sent, and the page says so at the top rather than
 * leaving the administrator to work it out from a column of held notifications.
 *
 * A 404 for anybody else, as the developer log is.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireAdministratorPage } from '@/lib/auth/guard';
import { notifyFrom, notifyTo, resendApiKey } from '@/lib/config';
import {
  MAX_ATTEMPTS,
  NOTIFICATION_RETENTION_DAYS,
  recentNotifications,
} from '@/lib/notifications/outbox';
import { NOTIFICATION_KIND_LABELS, NOTIFICATION_STATUS_LABELS } from '@/lib/notifications/types';
import { formatMoment } from '@/lib/time';
import { RetryNotification } from './RetryNotification';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Email notifications | Technavious' };

const STATUS_CLASSES: Record<string, string> = {
  sent: 'text-teal',
  pending: 'text-mist',
  held: 'text-muted',
  failed: 'text-logo-red',
};

export default async function NotificationsPage() {
  const person = await requireAdministratorPage('/platform/notifications');

  const configured = Boolean(resendApiKey());
  const records = await recentNotifications().catch(() => null);

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={person} />
      </BrandHeader>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Technavious</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Email notifications</h1>
        <p className="text-muted mt-3 max-w-3xl text-base leading-relaxed">
          What the portal emailed to {notifyTo().join(', ')}: each session set up, and participants
          whose profiles are missing required fields. A send that fails for a reason that may clear
          is retried, up to {MAX_ATTEMPTS} tries in all, and every failure is in the{' '}
          <Link href="/platform/errors" className="text-teal hover:underline">
            developer log
          </Link>
          . Times are India time, and notifications are kept for {NOTIFICATION_RETENTION_DAYS} days.
        </p>

        {!configured && (
          <p
            role="status"
            className="border-logo-red/40 bg-logo-red/10 mt-6 max-w-3xl rounded-md border p-4 text-sm"
          >
            No email is being sent: RESEND_API_KEY is not set. Notifications are kept here as held,
            and the first daily run after the key is set sends them. They will come from{' '}
            {notifyFrom()}, which must be on a domain verified in Resend.
          </p>
        )}

        {records === null && (
          <p className="border-logo-red/40 bg-logo-red/10 mt-6 rounded-md border p-4 text-sm">
            The notifications could not be read just now. Try again in a moment.
          </p>
        )}

        {records && records.length === 0 && (
          <p className="text-muted mt-8 text-sm">Nothing has been written this month or last.</p>
        )}

        {records && records.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted border-charcoal-line border-b">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Written</th>
                  <th className="py-2 pr-4 font-semibold">About</th>
                  <th className="py-2 pr-4 font-semibold">Status</th>
                  <th className="py-2 pr-4 font-semibold">Tries</th>
                  <th className="py-2 font-semibold">Last error</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-charcoal-line border-b align-top">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {formatMoment(record.createdAt)}
                      <span className="text-muted block font-mono text-xs">{record.id}</span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className="text-mist">{NOTIFICATION_KIND_LABELS[record.kind]}</span>
                      <span className="text-muted block text-xs">{record.subject}</span>
                      <span className="text-muted block text-xs">
                        {record.orgId ?? 'no customer'}, to {record.to.join(', ')}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className={STATUS_CLASSES[record.status]}>
                        {NOTIFICATION_STATUS_LABELS[record.status]}
                      </span>
                      {record.status === 'sent' && record.sentAt && (
                        <span className="text-muted block text-xs">
                          {formatMoment(record.sentAt)}
                        </span>
                      )}
                      {record.status === 'pending' && record.nextAttemptAt && (
                        <span className="text-muted block text-xs">
                          next try from {formatMoment(record.nextAttemptAt)}
                        </span>
                      )}
                      {record.status !== 'sent' && <RetryNotification id={record.id} />}
                    </td>
                    <td className="py-2 pr-4">{record.attempts}</td>
                    <td className="py-2 text-xs break-words">{record.lastError ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
