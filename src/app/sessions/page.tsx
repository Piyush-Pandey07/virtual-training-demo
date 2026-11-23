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
import { MonthlyAllowance } from '@/components/MonthlyAllowance';
import { requireUserPage } from '@/lib/auth/guard';
import { mayRunSessions } from '@/lib/auth/permissions';
import { deckApprovalStates } from '@/lib/decks/approval';
import { listDecks } from '@/lib/decks/registry';
import { HOME_ORG_ID } from '@/lib/orgs/types';
import { rosterStore } from '@/lib/roster/registry';
import { peopleOnBoard, visibleBatches, visibleSessions } from '@/lib/training/service';
import { trainingStore } from '@/lib/training/store';
import { monthlyAllowance } from '@/lib/usage/limits';
import { SessionsBoard } from './SessionsBoard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Sessions | Technavious' };

export default async function SessionsPage() {
  const me = await requireUserPage('/sessions');
  if (!mayRunSessions(me)) notFound();

  const store = trainingStore(me.orgId);
  const [sessions, batches, decks, people, allowance] = await Promise.all([
    store.listSessions(),
    store.listBatches(),
    listDecks(me.orgId),
    rosterStore(me.orgId).listPeople(),
    // The customer's sessions this month (UAT, issue 19), for whoever sets them up or runs
    // them there: a session refused for the cap is refused at its first hand-over, in front
    // of the room, so the facilitator needs to know as much as the administrator does.
    me.orgId === HOME_ORG_ID ? Promise.resolve(null) : monthlyAllowance(me.orgId),
  ]);
  // A deck can only be run once it is published and approved as it stands (AI-39). The
  // others stay listed, disabled with the reason, so nobody wonders where a deck went.
  // A failure to read approvals disables them all; the server refuses them anyway.
  // A facilitator is shown only the people in their own sessions and batches, for the
  // names on them, never the whole company.
  const shownPeople = peopleOnBoard(me, sessions, batches, people);
  const approvals = await deckApprovalStates(me.orgId, decks).catch(() => null);
  const deckChoices = decks.map((deck) => {
    const approval = approvals?.get(deck.id);
    const unavailable =
      deck.status !== 'published'
        ? 'not published'
        : approval?.state === 'approved'
          ? undefined
          : approval?.state === 'changed'
            ? 'changed since approval'
            : 'needs approval';
    return { id: deck.id, title: deck.title, ...(unavailable ? { unavailable } : {}) };
  });

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
        {allowance && (
          <div className="mt-6 max-w-2xl">
            <MonthlyAllowance allowance={allowance} />
          </div>
        )}
        <div className="mt-8">
          <SessionsBoard
            me={{ id: me.id, role: me.role, platform: me.platform }}
            sessions={visibleSessions(me, sessions).sort((a, b) =>
              (b.scheduledFor ?? b.createdAt).localeCompare(a.scheduledFor ?? a.createdAt),
            )}
            batches={visibleBatches(me, batches)}
            decks={deckChoices}
            people={shownPeople.map((person) => ({
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
