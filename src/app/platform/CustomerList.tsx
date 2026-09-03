'use client';

import { useRouter } from 'next/navigation';

import { ManageCustomer } from './ManageCustomer';
import { useState } from 'react';

import type { CustomerOverview } from '@/lib/platform/overview-types';

/**
 * Choosing which customer to look inside.
 *
 * The row that is currently being viewed says so plainly, because the danger with a
 * tool like this is not getting into a customer — it is forgetting you are in one, and
 * reading a screen full of somebody else's employees as though it were your own.
 */

export interface CustomerRow {
  id: string;
  name: string;
  domains: string[];
  status: 'active' | 'suspended';
  sessionsPerMonth: number | null;
  /** This calendar month, in the quantities the bill is made of. */
  usage: {
    sessions: number;
    ttsCharacters: number;
    sttSeconds: number;
    geminiTokens: number;
  };
  /** Who is in this company and what they are doing, for the same row. */
  overview: CustomerOverview;
}

/** Compact enough to sit on one line beside a name. */
function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

function minutes(seconds: number): string {
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds)}s`;
}

/**
 * Who runs this company, and who is in it.
 *
 * Folded away because the list is read to find a customer, not to study one -- but
 * one click rather than one navigation, because "who do I call at this company" is
 * asked often enough that making it a page of its own would be a worse answer.
 */
function CustomerPeople({ overview }: { overview: CustomerOverview }) {
  const { people, sessions } = overview;
  const own = people.admins.filter((admin) => !admin.platform);

  return (
    <details className="group mt-2">
      <summary className="text-muted hover:text-teal cursor-pointer list-none text-xs transition-colors">
        <span className="group-open:hidden">
          {own.length === 0
            ? 'No administrator of their own · show people'
            : `Administrator: ${own[0]!.name}${own.length > 1 ? ` and ${own.length - 1} more` : ''} · show people`}
        </span>
        <span className="hidden group-open:inline">Hide people</span>
      </summary>

      <div className="border-charcoal-line mt-2 space-y-2 border-l pl-3">
        {people.admins.length === 0 ? (
          <p className="text-muted text-xs leading-relaxed">
            Nobody here can administer this company. Somebody has to be made an administrator
            before they can upload a deck or assign anything.
          </p>
        ) : (
          <ul className="space-y-1">
            {people.admins.map((admin) => (
              <li key={admin.email} className="text-xs">
                <span className="font-semibold">{admin.name}</span>{' '}
                <span className="text-muted">{admin.email}</span>
                {admin.platform && (
                  <span className="text-azure ml-2 font-semibold">Technavious</span>
                )}
                {!admin.lastSeenAt && <span className="text-muted ml-2">never signed in</span>}
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted text-xs">
          {people.trainees} trainee{people.trainees === 1 ? '' : 's'}
          {people.neverSignedIn > 0 && ` · ${people.neverSignedIn} have never signed in`}
          {sessions.lastActivityAt &&
            ` · last training activity ${new Date(sessions.lastActivityAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
        </p>

        {sessions.open.length > 0 && (
          <ul className="space-y-1">
            {sessions.open.map((session) => (
              <li key={`${session.personEmail}-${session.deckId}`} className="text-xs">
                <span className="text-teal font-semibold">In a session now:</span>{' '}
                {session.personName} · {session.deckTitle ?? session.deckId} · {session.percent}%
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

interface CustomerListProps {
  customers: CustomerRow[];
  /** The customer currently being viewed. */
  viewing: string;
  /** Technavious's own organisation, which is where "leave" goes back to. */
  home: string;
}

export function CustomerList({ customers, viewing, home }: CustomerListProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(what: string, init: RequestInit) {
    setBusy(what);
    setError(null);
    try {
      const response = await fetch('/api/platform', {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? 'That did not work.');
      }
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (customers.length === 0) {
    return (
      <p className="text-muted text-sm leading-relaxed">
        No customers yet. Create one with{' '}
        <code className="bg-charcoal-soft rounded px-1.5 py-0.5 text-xs">
          npm run provision-org
        </code>
        .
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {viewing !== home && (
        <div className="border-teal/40 bg-teal/10 flex flex-wrap items-center gap-3 rounded-md border p-4 text-sm">
          <span className="flex-1">
            You are looking inside <span className="font-semibold">{viewing}</span>. Everything you
            open is theirs.
          </span>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void send('leave', { method: 'DELETE' })}
            className="bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {busy === 'leave' ? 'Leaving' : 'Back to Technavious'}
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {customers.map((customer) => {
          const here = customer.id === viewing;
          const atLimit =
            customer.sessionsPerMonth !== null &&
            customer.usage.sessions >= customer.sessionsPerMonth;
          return (
            <li
              key={customer.id}
              className={`flex flex-wrap items-center gap-3 rounded-md border p-4 text-sm ${
                here ? 'border-teal bg-teal/5' : 'border-charcoal-line'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {customer.name}
                  {customer.status === 'suspended' && (
                    <span className="text-logo-red ml-2 text-xs font-normal">suspended</span>
                  )}
                </p>
                <p className="text-muted mt-0.5 truncate text-xs">
                  {customer.id}
                  {customer.domains.length > 0 && ` · ${customer.domains.join(', ')}`}
                </p>
                {/* This month. Quantities, never a price: rates change and differ per
                    contract, and a figure with a price baked in cannot be re-derived
                    when the rate moves. */}
                <p className="text-muted mt-1 text-xs">
                  <span className={atLimit ? 'text-logo-red font-semibold' : ''}>
                    {customer.usage.sessions} session
                    {customer.usage.sessions === 1 ? '' : 's'}
                    {customer.sessionsPerMonth !== null && ` of ${customer.sessionsPerMonth}`}
                  </span>
                  {' · '}
                  {compact(customer.usage.ttsCharacters)} spoken
                  {' · '}
                  {minutes(customer.usage.sttSeconds)} heard
                  {' · '}
                  {compact(customer.usage.geminiTokens)} tokens
                </p>

                {/* Who is in there and what they have done, all time -- distinct from
                    the line above it, which is this month and is what the bill is
                    made of. */}
                <p className="text-muted mt-1 text-xs">
                  {customer.overview.people.total}
                  {customer.overview.people.total === 1 ? ' person' : ' people'}
                  {' · '}
                  {customer.overview.decks.total} deck
                  {customer.overview.decks.total === 1 ? '' : 's'}
                  {` (${customer.overview.decks.published} published)`}
                  {' · '}
                  {customer.overview.sessions.completed} completed
                  {customer.overview.sessions.unfinished > 0 &&
                    ` · ${customer.overview.sessions.unfinished} part-way`}
                  {customer.overview.sessions.open.length > 0 && (
                    <span className="text-teal font-semibold">
                      {' · '}
                      {customer.overview.sessions.open.length} in progress now
                    </span>
                  )}
                </p>

                <CustomerPeople overview={customer.overview} />
              </div>

              <ManageCustomer
                id={customer.id}
                name={customer.name}
                status={customer.status}
                sessionsPerMonth={customer.sessionsPerMonth}
              />

              {here ? (
                <span className="text-teal shrink-0 text-xs font-semibold">viewing</span>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void send(customer.id, {
                      method: 'POST',
                      body: JSON.stringify({ orgId: customer.id }),
                    })
                  }
                  className="border-charcoal-line text-mist hover:border-teal shrink-0 rounded-md border px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {busy === customer.id ? 'Opening' : 'Look inside'}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="border-logo-red/40 bg-logo-red/10 rounded-md border p-3 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
