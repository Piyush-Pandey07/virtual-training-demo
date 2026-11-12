/**
 * Running a trainer-led session on the facilitator's screen (AI-01).
 *
 * Only the session's facilitator, or an administrator, may open it, and a closed or
 * cancelled session cannot be run. Participants never come here: they do their own steps on their
 * own devices.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { requireUserPage } from '@/lib/auth/guard';
import { mayRunSessions } from '@/lib/auth/permissions';
import { toClientView } from '@/lib/deck';
import { DeckProvider } from '@/lib/deck-context';
import { loadDeck } from '@/lib/decks/registry';
import { keytermsFor } from '@/lib/glossary';
import { liveGlossary } from '@/lib/glossary/store';
import { lessonPlanGaps } from '@/lib/lesson-plan/view';
import { rosterStore } from '@/lib/roster/registry';
import { mayManageSession } from '@/lib/training/access';
import { addressName } from '@/lib/training/facilitation';
import { trainingStore } from '@/lib/training/store';
import { FacilitatorScreen } from './FacilitatorScreen';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Running a session | Technavious' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function RunSessionPage({ params }: Props) {
  const { id } = await params;
  const me = await requireUserPage(`/sessions/${id}/run`);
  if (!mayRunSessions(me)) notFound();

  const session = await trainingStore(me.orgId)
    .getSession(id)
    .catch(() => undefined);
  if (
    !session ||
    !mayManageSession(me, session) ||
    session.status === 'closed' ||
    session.status === 'cancelled'
  ) {
    notFound();
  }

  const [deck, people, glossary] = await Promise.all([
    loadDeck(me.orgId, session.deckId).catch(() => undefined),
    rosterStore(me.orgId).listPeople(),
    liveGlossary(),
  ]);
  if (!deck) notFound();

  const attendees = session.participantIds
    .filter((personId) => session.attendance[personId] !== 'absent')
    .map((personId) => people.find((person) => person.id === personId))
    .filter((person): person is NonNullable<typeof person> => Boolean(person))
    .map(addressName)
    // Each name once, as the trainer is given them: two Rahuls are one choice here.
    .filter((name, index, names) => names.indexOf(name) === index);

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <Link
          href={`/sessions/${session.id}`}
          className="text-muted hover:text-teal text-sm transition-colors"
        >
          Attendance and closing
        </Link>
      </BrandHeader>
      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-5 py-5 sm:px-8">
        <DeckProvider deck={{ ...toClientView(deck), listenFor: keytermsFor(deck, glossary) }}>
          <FacilitatorScreen
            sessionId={session.id}
            attendees={attendees}
            planGaps={lessonPlanGaps(deck)}
          />
        </DeckProvider>
      </main>
    </div>
  );
}
