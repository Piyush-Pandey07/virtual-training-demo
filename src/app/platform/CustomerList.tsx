'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
                  {customer.sessionsPerMonth !== null &&
                    ` · capped at ${customer.sessionsPerMonth} sessions a month`}
                </p>
              </div>

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
