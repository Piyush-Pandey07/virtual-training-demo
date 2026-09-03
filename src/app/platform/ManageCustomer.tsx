'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Suspending, capping and deleting one customer.
 *
 * Folded away behind a "Manage" toggle rather than sitting open on every row. Two of
 * these three are things somebody does once a year, and the third destroys a company's
 * records permanently. None of them should be one stray click from the button that
 * opens a customer.
 */

interface ManageCustomerProps {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  sessionsPerMonth: number | null;
}

export function ManageCustomer({ id, name, status, sessionsPerMonth }: ManageCustomerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [cap, setCap] = useState(sessionsPerMonth === null ? '' : String(sessionsPerMonth));
  const [confirm, setConfirm] = useState('');

  async function send(what: string, init: RequestInit, path = `/api/platform/customers/${id}`) {
    setBusy(what);
    setError(null);
    setDone(null);
    try {
      const response = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'That did not work.');
      router.refresh();
      return result;
    } catch (cause) {
      setError((cause as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const field =
    'bg-charcoal text-mist ring-charcoal-line focus:ring-teal rounded-md px-3 py-2 text-sm ring-1 ring-inset';

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted hover:text-teal shrink-0 text-xs font-semibold transition-colors"
      >
        Manage
      </button>
    );
  }

  return (
    <div className="border-charcoal-line mt-3 w-full space-y-4 border-t pt-4">
      {/* -------------------------------------------------------- suspend */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{status === 'suspended' ? 'Suspended' : 'Active'}</p>
          <p className="text-muted mt-0.5 text-xs leading-relaxed">
            Suspending stops everybody here signing in. Nothing of theirs is touched, and somebody
            who completed a programme still completed it.
          </p>
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void send('status', {
              method: 'PATCH',
              body: JSON.stringify({ status: status === 'suspended' ? 'active' : 'suspended' }),
            })
          }
          className="border-charcoal-line text-mist hover:border-teal shrink-0 rounded-md border px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-50"
        >
          {busy === 'status' ? 'Working' : status === 'suspended' ? 'Reactivate' : 'Suspend'}
        </button>
      </div>

      {/* ------------------------------------------------------------ cap */}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = cap.trim();
          void send('cap', {
            method: 'PATCH',
            body: JSON.stringify({ sessionsPerMonth: trimmed === '' ? null : Number(trimmed) }),
          });
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor={`cap-${id}`} className="block text-sm font-semibold">
            Sessions a month
          </label>
          <p className="text-muted mt-0.5 text-xs leading-relaxed">
            Leave empty for no cap. Once reached, new sessions are refused until the month turns
            over.
          </p>
        </div>
        <input
          id={`cap-${id}`}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={cap}
          onChange={(event) => setCap(event.target.value)}
          placeholder="no cap"
          disabled={busy !== null}
          className={`${field} w-28 shrink-0`}
        />
        <button
          type="submit"
          disabled={busy !== null}
          className="border-charcoal-line text-mist hover:border-teal shrink-0 rounded-md border px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-50"
        >
          {busy === 'cap' ? 'Saving' : 'Save'}
        </button>
      </form>

      {/* --------------------------------------------------------- delete */}
      <form
        className="border-logo-red/40 bg-logo-red/5 space-y-3 rounded-md border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send('delete', { method: 'DELETE', body: JSON.stringify({ confirm }) }).then(
            (result) => {
              if (result) setDone(`${name} and everything of theirs has been deleted.`);
            },
          );
        }}
      >
        <div>
          <p className="text-sm font-semibold">Delete this customer</p>
          <p className="text-muted mt-0.5 text-xs leading-relaxed">
            Removes their people, decks, slide images, assignments, training records and usage.
            There is no undo and nothing is archived. To confirm, type{' '}
            <code className="bg-charcoal-soft rounded px-1 py-0.5">{id}</code> below.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder={id}
            disabled={busy !== null}
            autoComplete="off"
            className={`${field} min-w-0 flex-1`}
          />
          <button
            type="submit"
            disabled={busy !== null || confirm !== id}
            className="bg-logo-red text-mist shrink-0 rounded-md px-4 py-2 text-xs font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === 'delete' ? 'Deleting' : 'Delete permanently'}
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            setDone(null);
            setConfirm('');
          }}
          className="text-muted hover:text-mist text-xs transition-colors"
        >
          Close
        </button>
      </div>

      {done && <p className="border-teal/40 bg-teal/10 rounded-md border p-3 text-sm">{done}</p>}
      {error && (
        <p role="alert" className="border-logo-red/40 bg-logo-red/10 rounded-md border p-3 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
