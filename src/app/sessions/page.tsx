/**
 * Trainer-led sessions and batches.
 *
 * For facilitators, who see their own, and for company administrators and Technavious,
 * who see the whole company's and name the facilitator. A 404 for anybody else, as for
 * every other administrator's page.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireUserPage } from '@/lib/auth/guard';
import { mayRunSessions } from '@/lib/auth/permissions';
import { listDecks } from '@/lib/decks/registry';
import { rosterStore } from '@/lib/roster/registry';
import { visibleBatches, visibleSessions } from '@/lib/training/service';
import { trainingStore } from '@/lib/training/store';
import { SessionsBoard } from './SessionsBoard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Sessions | Technavious' };

export default async function SessionsPage() {
  const me = await requireUserPage('/sessions');
  if (!mayRunSessions(me)) notFound();

  const store = trainingStore(me.orgId);
  const [sessions, batches, decks, people] = await Promise.all([
    store.listSessions(),
    store.listBatches(),
    listDecks(me.orgId),
    rosterStore(me.orgId).listPeople(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={me} current="/sessions" />
      </BrandHeader>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-8">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Trainer-led</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Sessions and batches</h1>
        <p className="text-muted mt-3 max-w-2xl text-base leading-relaxed">
          A trainer-led session runs a deck on the facilitator&apos;s screen for the people listed.
          Each participant does their own consent, assessments and feedback on their own device.
          Batches are groups you set a session up from.
        </p>
        <div className="mt-8">
          <SessionsBoard
            me={{ id: me.id, role: me.role, platform: me.platform }}
            sessions={visibleSessions(me, sessions).sort((a, b) =>
              (b.scheduledFor ?? b.createdAt).localeCompare(a.scheduledFor ?? a.createdAt),
            )}
            batches={visibleBatches(me, batches)}
            decks={decks.map((deck) => ({ id: deck.id, title: deck.title }))}
            people={people.map((person) => ({
              id: person.id,
              name: person.name || person.email,
              email: person.email,
              role: person.role,
            }))}
          />
        </div>
      </main>
    </div>
  );
}
