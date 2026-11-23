/**
 * The developer log, for Technavious only.
 *
 * What trainees were told in standard words, with what actually happened behind it:
 * which provider, its status and its own message, or what the browser saw of its
 * connection. A trainee who reports a problem can quote the reference they were shown,
 * and it is the id in the first column here.
 *
 * One day at a time, read by the `day` field the log writes for exactly this, so the
 * page never reads the whole collection. A 404 for anybody else, as on the customer
 * list, so a customer's administrator cannot learn the page exists.
 *
 * In India time, labelled, as the audit history is and every other page (UAT issue 20).
 * It showed UTC, said so only in the sentence at the top, and read by the UTC day, while
 * the administrator's home page names a provider's failure by its time in India: a failure
 * at one in the morning there was on the home page as the 20th and in this log as the 19th.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireUserPage } from '@/lib/auth/guard';
import { isAdministrator } from '@/lib/auth/permissions';
import { DEVLOG_RETENTION_DAYS, entriesFor } from '@/lib/failures/devlog';
import { orgsConfigured } from '@/lib/orgs/registry';
import { formatTimeOfDay, shiftDay, todayInTrainingZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Developer log | Technavious' };

interface ErrorsPageProps {
  searchParams: Promise<{ day?: string }>;
}

export default async function ErrorsPage({ searchParams }: ErrorsPageProps) {
  const person = await requireUserPage('/platform/errors');
  // Every Technavious administrator, not only platform staff (AI-11): they are the ones
  // who follow up with whoever runs each service, to recharge credit for instance.
  if (!isAdministrator(person)) notFound();

  // Today in India, so Next day stops at the day it is there, not the day it is in UTC.
  const today = todayInTrainingZone();
  const { day: requested } = await searchParams;
  const day = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : today;
  const entries = orgsConfigured() ? await entriesFor(day).catch(() => null) : [];

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={person} current="/platform" />
      </BrandHeader>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Technavious</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Developer log</h1>
        <p className="text-muted mt-3 max-w-3xl text-base leading-relaxed">
          Every failure a trainee or admin met, with what the provider or the browser actually said.
          They were shown a standard message and the reference in the first column. Times and days
          are India time (IST), and entries are kept for {DEVLOG_RETENTION_DAYS} days.
        </p>

        <nav className="mt-6 flex flex-wrap items-center gap-4 text-sm" aria-label="Choose a day">
          <Link
            href={`/platform/errors?day=${shiftDay(day, -1)}`}
            className="text-teal hover:underline"
          >
            Previous day
          </Link>
          <span className="text-mist font-semibold">{day}</span>
          {day < today && (
            <Link
              href={`/platform/errors?day=${shiftDay(day, 1)}`}
              className="text-teal hover:underline"
            >
              Next day
            </Link>
          )}
          {/* The emails to the training team, whose failed sends are logged here (AI-35). */}
          <Link href="/platform/notifications" className="text-muted hover:text-teal ml-auto">
            Email notifications
          </Link>
          {person.platform && (
            <Link href="/platform" className="text-muted hover:text-teal">
              Back to customers
            </Link>
          )}
        </nav>

        {entries === null && (
          <p className="border-logo-red/40 bg-logo-red/10 mt-6 rounded-md border p-4 text-sm">
            The log could not be read just now. Try again in a moment.
          </p>
        )}

        {entries && entries.length === 0 && (
          <p className="text-muted mt-8 text-sm">Nothing went wrong on this day.</p>
        )}

        {entries && entries.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted border-charcoal-line border-b">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Reference</th>
                  <th className="py-2 pr-4 font-semibold">Time</th>
                  <th className="py-2 pr-4 font-semibold">Where</th>
                  <th className="py-2 pr-4 font-semibold">What</th>
                  <th className="py-2 pr-4 font-semibold">Who</th>
                  <th className="py-2 font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-charcoal-line border-b align-top">
                    <td className="py-2 pr-4 font-mono">{entry.id}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {formatTimeOfDay(entry.at)}
                      {entry.repeats > 1 && (
                        <span className="text-muted block text-xs">x{entry.repeats}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="text-mist">
                        {entry.source === 'browser' ? 'Browser' : 'Server'}
                      </span>
                      <span className="text-muted block text-xs">{entry.route}</span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className="text-mist">
                        {entry.provider}: {entry.kind.replaceAll('_', ' ')}
                      </span>
                      <span className="text-muted block text-xs">
                        shown as {entry.code}
                        {entry.status ? `, HTTP ${entry.status}` : ''}
                        {entry.language ? `, ${entry.language}` : ''}
                      </span>
                    </td>
                    <td className="text-muted py-2 pr-4 text-xs">
                      {entry.orgId ?? 'unknown'}
                      <span className="block">{entry.personId ?? ''}</span>
                      {entry.deckId && <span className="block">deck {entry.deckId}</span>}
                    </td>
                    <td className="py-2 text-xs break-words">
                      {entry.detail}
                      {entry.client?.network && (
                        <span className="text-muted block">network: {entry.client.network}</span>
                      )}
                      {entry.client?.userAgent && (
                        <span className="text-muted block">{entry.client.userAgent}</span>
                      )}
                    </td>
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
