/**
 * The audit history, for the administrator only (BRD v2.3, AI-40).
 *
 * Who viewed or changed a learner profile, an assessment result or a question bank, who
 * approved a deck and when its approval cleared, in the customer the administrator is
 * looking at; and, beside them, who changed the glossary, which is the platform's own.
 * A company administrator, a facilitator and a participant get a 404, as for the other
 * Technavious tools, so they cannot learn the page exists.
 *
 * Read a month or a day at a time, by the fields each entry carries for exactly this,
 * so the page never reads the whole collection. A plain form with GET, so a filtered
 * view is a link that can be sent to somebody else who may see it.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import {
  AUDIT_RETENTION_DAYS,
  AUDIT_SUBJECT_LABELS,
  AUDIT_SUBJECTS,
  auditHistory,
  isAuditSubject,
  platformAuditHistory,
  type AuditEntry,
  type AuditFilter,
} from '@/lib/audit/log';
import { requireUserPage } from '@/lib/auth/guard';
import { isAdministrator } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Audit history | Technavious' };

interface AuditPageProps {
  searchParams: Promise<{ type?: string; month?: string; day?: string }>;
}

/** Both halves, newest first. Either half failing shows as the page saying so. */
async function read(orgId: string, filter: AuditFilter): Promise<AuditEntry[] | null> {
  const wantsCustomer = filter.subjectType !== 'glossary-term';
  const wantsPlatform = !filter.subjectType || filter.subjectType === 'glossary-term';
  try {
    const [customer, platform] = await Promise.all([
      wantsCustomer ? auditHistory(orgId, filter) : Promise.resolve([]),
      wantsPlatform ? platformAuditHistory(filter) : Promise.resolve([]),
    ]);
    return [...customer, ...platform].sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return null;
  }
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const person = await requireUserPage('/audit');
  if (!isAdministrator(person)) notFound();

  const { type, month: requestedMonth, day: requestedDay } = await searchParams;
  const subjectType = isAuditSubject(type) ? type : undefined;
  const day = requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) ? requestedDay : undefined;
  const month =
    requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth)
      ? requestedMonth
      : new Date().toISOString().slice(0, 7);

  const filter: AuditFilter = { subjectType, ...(day ? { day } : { month }) };
  const entries = await read(person.orgId, filter);

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={person} current="/audit" />
      </BrandHeader>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Technavious</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Audit history</h1>
        <p className="text-muted mt-3 max-w-3xl text-base leading-relaxed">
          Who viewed or changed learner profiles, assessment results and question banks, and who
          approved decks, in <span className="text-mist font-semibold">{person.orgId}</span>; and
          who changed the glossary, which belongs to no customer. Times are UTC, and entries are
          kept for {AUDIT_RETENTION_DAYS} days.
        </p>

        <form method="get" className="mt-6 flex flex-wrap items-end gap-3 text-sm">
          <div>
            <label htmlFor="type" className="block font-semibold">
              What
            </label>
            <select
              id="type"
              name="type"
              defaultValue={subjectType ?? ''}
              className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-2 rounded-md px-3.5 py-2.5 ring-1 ring-inset"
            >
              <option value="">Everything</option>
              {AUDIT_SUBJECTS.map((subject) => (
                <option key={subject} value={subject}>
                  {AUDIT_SUBJECT_LABELS[subject]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="month" className="block font-semibold">
              Month
            </label>
            <input
              id="month"
              name="month"
              type="month"
              defaultValue={month}
              className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-2 rounded-md px-3.5 py-2.5 ring-1 ring-inset"
            />
          </div>
          <div>
            <label htmlFor="day" className="block font-semibold">
              Or one day
              <span className="text-muted ml-2 font-normal">optional</span>
            </label>
            <input
              id="day"
              name="day"
              type="date"
              defaultValue={day ?? ''}
              className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-2 rounded-md px-3.5 py-2.5 ring-1 ring-inset"
            />
          </div>
          <button
            type="submit"
            className="bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2.5 font-semibold transition-colors"
          >
            Show
          </button>
          <Link href="/audit" className="text-muted hover:text-teal py-2.5">
            This month
          </Link>
        </form>

        <p className="text-muted mt-4 text-sm">
          {day ? `Showing ${day}` : `Showing ${month}`}
          {subjectType ? `, ${AUDIT_SUBJECT_LABELS[subjectType].toLowerCase()} only` : ''}.
        </p>

        {entries === null && (
          <p className="border-logo-red/40 bg-logo-red/10 mt-6 rounded-md border p-4 text-sm">
            The history could not be read just now. Try again in a moment.
          </p>
        )}

        {entries && entries.length === 0 && (
          <p className="text-muted mt-8 text-sm">Nothing was recorded in this period.</p>
        )}

        {entries && entries.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted border-charcoal-line border-b">
                <tr>
                  <th className="py-2 pr-4 font-semibold">When</th>
                  <th className="py-2 pr-4 font-semibold">Who</th>
                  <th className="py-2 pr-4 font-semibold">Did</th>
                  <th className="py-2 pr-4 font-semibold">To</th>
                  <th className="py-2 font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-charcoal-line border-b align-top">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {entry.at.slice(0, 10)}
                      <span className="text-muted block text-xs">{entry.at.slice(11, 19)}</span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className="text-mist break-all">{entry.actorEmail}</span>
                      <span className="text-muted block text-xs">{entry.actorRole}</span>
                    </td>
                    <td className="py-2 pr-4">{entry.action}</td>
                    <td className="py-2 pr-4">
                      <span className="text-mist">{AUDIT_SUBJECT_LABELS[entry.subjectType]}</span>
                      <span className="text-muted block text-xs break-all">{entry.subjectId}</span>
                    </td>
                    <td className="py-2 text-xs break-words">{entry.detail}</td>
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
