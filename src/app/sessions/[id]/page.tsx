/**
 * One trainer-led session: who is listed, who attended, and closing it (AI-32).
 *
 * Only its facilitator, and administrators, may open this page. Everybody else gets
 * a 404, including a facilitator looking for somebody else's session.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireUserPage } from '@/lib/auth/guard';
import { mayRunSessions } from '@/lib/auth/permissions';
import { loadDeck } from '@/lib/decks/registry';
import { rosterStore } from '@/lib/roster/registry';
import { mayManageSession } from '@/lib/training/access';
import { trainingStore } from '@/lib/training/store';
import { closureSummary } from '@/lib/training/summary';
import { resultsHref } from '@/lib/assessments/paths';
import { STATUS_WORDS } from '@/lib/training/words';
import { AddParticipants } from './AddParticipants';
import { SessionRecord } from './SessionRecord';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Session | Technavious' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SessionPage({ params }: Props) {
  const { id } = await params;
  const me = await requireUserPage(`/sessions/${id}`);
  if (!mayRunSessions(me)) notFound();

  const session = await trainingStore(me.orgId)
    .getSession(id)
    .catch(() => undefined);
  if (!session || !mayManageSession(me, session)) notFound();

  const [deck, people, summary] = await Promise.all([
    loadDeck(me.orgId, session.deckId).catch(() => undefined),
    rosterStore(me.orgId).listPeople(),
    closureSummary(me, session.id).catch(() => null),
  ]);
  // Only an administrator decides who is in a session; a facilitator runs it.
  const organiser = me.platform || me.role === 'admin';
  const nameOf = (personId: string) => {
    const person = people.find((entry) => entry.id === personId);
    return person ? person.name || person.email : 'Removed';
  };

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={me} />
      </BrandHeader>
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8">
        <Link
          href="/sessions"
          className="text-muted hover:text-teal mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Sessions
        </Link>
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">
          Trainer-led session
        </p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">
          {deck?.meta.title ?? 'Deck removed'}
        </h1>
        <p className="text-muted mt-2 text-sm">
          Facilitated by {nameOf(session.facilitatorId)} &middot; {STATUS_WORDS[session.status]}
        </p>
        <div className="mt-8">
          <SessionRecord
            session={session}
            participants={session.participantIds.map((personId) => ({
              id: personId,
              name: nameOf(personId),
            }))}
            deckAvailable={Boolean(deck)}
            summary={summary ? { rows: summary.rows, totals: summary.totals } : null}
            resultsLink={resultsHref(session.deckId, session.id)}
          />
        </div>
        {organiser && (session.status === 'scheduled' || session.status === 'open') && (
          <div className="mt-10">
            <AddParticipants
              sessionId={session.id}
              started={session.status === 'open'}
              candidates={people
                .filter(
                  (person) =>
                    person.role === 'trainee' && !session.participantIds.includes(person.id),
                )
                .map((person) => ({
                  id: person.id,
                  name: person.name || person.email,
                  email: person.email,
                }))}
            />
          </div>
        )}
      </main>
    </div>
  );
}
