/**
 * Everybody, and how much of their training they have done.
 *
 * Administrators only. A trainee gets a 404 rather than a refusal, because the
 * existence of an administrator's tools is not something they need to know about.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { BrandHeader } from '@/components/BrandHeader';
import { SignOutButton } from '@/components/SignOutButton';
import { requireAdminPage } from '@/lib/auth/guard';
import { isBootstrapAdmin } from '@/lib/auth/session';
import { listDecks } from '@/lib/decks/registry';
import { rosterStore } from '@/lib/roster/registry';
import { inviteOverview, peopleOverview } from '@/lib/roster/report';
import { InvitePanel, type InvitableDeck, type InviteLine } from './InvitePanel';
import { PeopleList, type PersonLine } from './PeopleList';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'People | Technavious' };

export default async function PeoplePage() {
  const me = await requireAdminPage('/people');
  const store = rosterStore();

  const [rows, invites, decks]: [
    Awaited<ReturnType<typeof peopleOverview>>,
    InviteLine[],
    Awaited<ReturnType<typeof listDecks>>,
  ] = store.writable
    ? await Promise.all([peopleOverview(), inviteOverview(), listDecks()])
    : [[], [], []];

  // Only published decks can be attached, for the same reason a draft cannot be
  // assigned: nobody has checked it yet.
  const invitable: InvitableDeck[] = decks
    .filter((deck) => deck.status === 'published')
    .map((deck) => ({
      id: deck.id,
      title: deck.title,
      estimatedMinutes: deck.estimatedMinutes,
    }));

  const people: PersonLine[] = rows.map((row) => ({
    id: row.person.id,
    name: row.person.name,
    email: row.person.email,
    role: isBootstrapAdmin(row.person.email) ? 'admin' : row.person.role,
    assigned: row.assigned,
    completed: row.completed,
    lastActiveAt: row.lastActiveAt,
    pinnedAdmin: isBootstrapAdmin(row.person.email),
  }));

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <div className="flex items-center gap-4">
          <Link href="/" className="text-muted hover:text-teal text-sm transition-colors">
            Home
          </Link>
          <SignOutButton />
        </div>
      </BrandHeader>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8">
        <Link
          href="/"
          className="text-muted hover:text-teal mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Back
        </Link>

        <p className="text-teal text-sm font-semibold tracking-wide uppercase">People</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">
          {people.length} {people.length === 1 ? 'person' : 'people'}
        </h1>

        {!store.writable ? (
          <div
            role="alert"
            className="border-logo-red/40 bg-logo-red/10 mt-6 rounded-md border p-4 text-sm"
          >
            <p className="font-semibold">There is no roster storage on this deployment.</p>
            <p className="text-muted mt-1 leading-relaxed">
              People, assignments and progress cannot be saved. Connect a Blob store and redeploy.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-12">
            <InvitePanel invites={invites} decks={invitable} />
            <PeopleList people={people} meId={me.id} />
          </div>
        )}
      </main>
    </div>
  );
}
