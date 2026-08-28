'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface InviteLine {
  id: string;
  email: string | null;
  deckTitles: string[];
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  revoked: boolean;
  expired: boolean;
}

export interface InvitableDeck {
  id: string;
  title: string;
  estimatedMinutes: number;
}

function formatDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'unknown';
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Making and managing invitation links.
 *
 * The created link is shown once, here, and never again: only its hash is stored, so
 * nothing can produce it a second time. That is deliberate and the panel says so,
 * because somebody who closes the box expecting to find it later would otherwise
 * think it had been lost rather than never kept.
 */
export function InvitePanel({ invites, decks }: { invites: InviteLine[]; decks: InvitableDeck[] }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [days, setDays] = useState(14);
  const [maxUses, setMaxUses] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const personal = email.trim().length > 0;

  async function create() {
    setBusy('create');
    setError(null);
    setLink(null);
    setCopied(false);
    try {
      const response = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim() || null,
          deckIds: chosen,
          days,
          maxUses: personal ? 1 : maxUses,
        }),
      });
      const result = (await response.json()) as { error?: string; url?: string };
      if (!response.ok || !result.url) throw new Error(result.error ?? 'Could not create a link.');

      setLink(result.url);
      setEmail('');
      setChosen([]);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? 'Could not withdraw it.');
      }
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-6">
      <div className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5">
        <h2 className="font-semibold">Invite by link</h2>
        <p className="text-muted mt-1 text-sm leading-relaxed">
          Send somebody a link instead of adding them by hand. Leave the address blank to make one
          link a group can share.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="invite-email" className="block text-sm font-semibold">
              For one person
              <span className="text-muted ml-2 font-normal">optional</span>
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@technavious.com"
              className="bg-charcoal text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal mt-2 w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
            />
            <p className="text-muted mt-2 text-xs leading-relaxed">
              {personal
                ? 'Only this address can accept, and only once. A forwarded link will not work.'
                : 'Anyone holding the link can accept, up to the limit below.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="invite-days" className="block text-sm font-semibold">
                Expires in
              </label>
              <select
                id="invite-days"
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
                className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-2 w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
              >
                {[1, 7, 14, 30, 90].map((value) => (
                  <option key={value} value={value}>
                    {value} {value === 1 ? 'day' : 'days'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="invite-uses" className="block text-sm font-semibold">
                Uses
              </label>
              <input
                id="invite-uses"
                type="number"
                min={1}
                max={200}
                disabled={personal}
                value={personal ? 1 : maxUses}
                onChange={(event) => setMaxUses(Number(event.target.value))}
                className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-2 w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        {decks.length > 0 && (
          <fieldset className="mt-5">
            <legend className="text-sm font-semibold">
              Assign on acceptance
              <span className="text-muted ml-2 font-normal">optional</span>
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {decks.map((deck) => {
                const on = chosen.includes(deck.id);
                return (
                  <button
                    key={deck.id}
                    type="button"
                    onClick={() =>
                      setChosen((current) =>
                        on ? current.filter((id) => id !== deck.id) : [...current, deck.id],
                      )
                    }
                    className={`rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors ${
                      on
                        ? 'border-teal bg-teal/15 text-teal'
                        : 'border-charcoal-line text-muted hover:text-mist'
                    }`}
                  >
                    {deck.title}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void create()}
          className="bg-azure text-mist hover:bg-teal hover:text-charcoal mt-5 rounded-md px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'create' ? 'Creating' : 'Create link'}
        </button>

        {link && (
          <div className="border-teal/40 bg-teal/10 mt-5 rounded-md border p-4">
            <p className="text-sm font-semibold">Here is the link. Copy it now.</p>
            <p className="text-muted mt-1 text-xs leading-relaxed">
              Only a hash of it is stored, so it cannot be shown again. If you lose it, withdraw it
              and make another.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="bg-charcoal text-mist min-w-0 flex-1 overflow-x-auto rounded px-3 py-2 text-xs">
                {link}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(link)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
                className="border-charcoal-line text-mist hover:border-teal shrink-0 rounded-md border px-4 py-2 text-sm font-semibold transition-colors"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="border-logo-red/40 bg-logo-red/10 mt-4 rounded-md border p-3 text-sm"
          >
            {error}
          </p>
        )}
      </div>

      {invites.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Links you have made</h3>
          <ul className="mt-3 grid gap-2">
            {invites.map((invite) => {
              const dead = invite.revoked || invite.expired || invite.usedCount >= invite.maxUses;
              return (
                <li
                  key={invite.id}
                  className="border-charcoal-line bg-charcoal-soft flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${dead ? 'text-muted' : ''}`}>
                      {invite.email ?? 'Shared link'}
                      {invite.deckTitles.length > 0 && (
                        <span className="text-muted font-normal">
                          {' '}
                          · {invite.deckTitles.join(', ')}
                        </span>
                      )}
                    </p>
                    <p className="text-muted mt-0.5 text-xs">
                      {invite.revoked
                        ? 'Withdrawn'
                        : invite.expired
                          ? `Expired ${formatDate(invite.expiresAt)}`
                          : `Expires ${formatDate(invite.expiresAt)}`}{' '}
                      · used {invite.usedCount} of {invite.maxUses}
                    </p>
                  </div>

                  {!dead && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void revoke(invite.id)}
                      className="border-charcoal-line text-muted hover:text-mist shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      {busy === invite.id ? 'Withdrawing' : 'Withdraw'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
