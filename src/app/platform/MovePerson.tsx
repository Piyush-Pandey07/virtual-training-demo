'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Moving somebody from one customer to another.
 *
 * Rare, and almost always a correction: a contractor provisioned against the wrong
 * company, or an address whose domain resolved somewhere unexpected. Takes an address
 * rather than a person id because whoever needs this has the address in front of them
 * and no way to find the id.
 */

export function MovePerson({ customers }: { customers: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [toOrgId, setToOrgId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function move() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const response = await fetch('/api/platform/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), toOrgId }),
      });
      const result = (await response.json()) as { error?: string; from?: string; to?: string };
      if (!response.ok) throw new Error(result.error ?? 'That did not work.');

      setDone(`${email.trim()} moved from "${result.from}" to "${result.to}".`);
      setEmail('');
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field =
    'bg-charcoal text-mist ring-charcoal-line focus:ring-teal rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset';

  return (
    <section className="border-charcoal-line bg-charcoal-soft mt-8 rounded-xl border p-5">
      <h2 className="text-lg font-semibold">Move somebody between customers</h2>
      <p className="text-muted mt-2 text-sm leading-relaxed">
        For corrections: somebody provisioned against the wrong company, or an address whose
        domain resolved somewhere unexpected. Anybody who already has training records cannot be
        moved, because removing them from a customer takes those records with them, and carrying
        them across would hand the new company training it never ran. Their session ends
        immediately, so they sign in again to the customer they now belong to.
      </p>

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (email.trim() && toOrgId) void move();
        }}
      >
        <div className="min-w-56 flex-1">
          <label htmlFor="move-email" className="block text-sm font-semibold">
            Email address
          </label>
          <input
            id="move-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@customer.com"
            disabled={busy}
            className={`${field} mt-2 w-full`}
          />
        </div>

        <div className="min-w-48">
          <label htmlFor="move-to" className="block text-sm font-semibold">
            Move to
          </label>
          <select
            id="move-to"
            value={toOrgId}
            onChange={(event) => setToOrgId(event.target.value)}
            disabled={busy}
            className={`${field} mt-2 w-full`}
          >
            <option value="">Choose a customer</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={busy || !email.trim() || !toOrgId}
          className="bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Moving' : 'Move'}
        </button>
      </form>

      {done && (
        <p className="border-teal/40 bg-teal/10 mt-4 rounded-md border p-3 text-sm">{done}</p>
      )}
      {error && (
        <p
          role="alert"
          className="border-logo-red/40 bg-logo-red/10 mt-4 rounded-md border p-3 text-sm"
        >
          {error}
        </p>
      )}
    </section>
  );
}
