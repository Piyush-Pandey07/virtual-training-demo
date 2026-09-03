/**
 * One person's training record.
 *
 * The profile an administrator opens to answer "has this person done it", and the
 * place training is given to them.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireAdminPage } from '@/lib/auth/guard';
import { roleLabel } from '@/lib/auth/labels';
import { isPlatformAdmin } from '@/lib/auth/roles';
import { currentPerson } from '@/lib/auth/session';
import { listDecks } from '@/lib/decks/registry';
import { rosterStore } from '@/lib/roster/registry';
import { trainingFor } from '@/lib/roster/report';
import { EmployeeStats } from './EmployeeStats';
import { PersonDetail, type AssignableDeck } from './PersonDetail';

export const dynamic = 'force-dynamic';

interface PersonPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PersonPageProps): Promise<Metadata> {
  const { id } = await params;
  // Asks who is signed in rather than reading blind: `generateMetadata` runs outside
  // the page's guard, and a name in a tab title is still somebody's name.
  const viewer = await currentPerson();
  if (!viewer) return { title: 'Technavious' };

  const person = await rosterStore(viewer.orgId)
    .getPerson(id)
    .catch(() => undefined);
  return { title: person ? `${person.name || person.email} | Technavious` : 'Technavious' };
}

export default async function PersonPage({ params }: PersonPageProps) {
  const admin = await requireAdminPage();
  const { id } = await params;

  const person = await rosterStore(admin.orgId)
    .getPerson(id)
    .catch(() => undefined);
  if (!person) notFound();

  const [rows, decks] = await Promise.all([
    trainingFor(admin.orgId, person),
    listDecks(admin.orgId),
  ]);
  const already = new Set(rows.map((row) => row.deckId));

  // Only published decks, and only ones they do not already have. A draft has not
  // been checked by anybody, and the API refuses it too — this just avoids offering
  // a choice that would be rejected.
  const assignable: AssignableDeck[] = decks
    .filter((deck) => deck.status === 'published' && !already.has(deck.id))
    .map((deck) => ({
      id: deck.id,
      title: deck.title,
      slideCount: deck.slideCount,
      estimatedMinutes: deck.estimatedMinutes,
    }));

  const complete = rows.filter((row) => row.completedAt !== null).length;

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={admin} />
      </BrandHeader>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8">
        <Link
          href="/people"
          className="text-muted hover:text-teal mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <span aria-hidden="true">&larr;</span> All people
        </Link>

        <p className="text-teal text-sm font-semibold tracking-wide uppercase">
          {roleLabel(person.role, isPlatformAdmin(person.email))}
        </p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{person.name || person.email}</h1>
        <p className="text-muted mt-2 text-base">
          {person.email} ·{' '}
          {rows.length === 0 ? 'nothing assigned' : `${complete} of ${rows.length} complete`}
          {person.lastSeenAt === null ? ' · has never signed in' : ''}
        </p>

        <div className="mt-10 space-y-8">
          <EmployeeStats
            rows={rows}
            joinedAt={person.createdAt}
            lastSignedInAt={person.lastSeenAt}
          />
          <PersonDetail personId={person.id} rows={rows} assignable={assignable} />
        </div>
      </main>
    </div>
  );
}
