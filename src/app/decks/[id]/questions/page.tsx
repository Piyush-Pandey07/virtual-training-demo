/**
 * A deck's question banks: the pre-session and post-session assessments.
 *
 * The Benchmark administrator only. A company administrator or facilitator gets a 404,
 * as for every administrator's tool they have no use for. The banks are read here with
 * their answers, which is safe because nobody else can open this page.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireUserPage } from '@/lib/auth/guard';
import { currentPerson } from '@/lib/auth/session';
import { mayManageBanks } from '@/lib/assessments/access';
import { banksHref, resultsHref } from '@/lib/assessments/paths';
import { bankForAdministrator } from '@/lib/assessments/service';
import { loadStoredDeck } from '@/lib/decks/registry';
import { QuestionBanks } from './QuestionBanks';

export const dynamic = 'force-dynamic';

interface QuestionsPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: QuestionsPageProps): Promise<Metadata> {
  const { id } = await params;
  // Asks who is signed in rather than reading blind, as the other deck pages do, since
  // this runs outside the page's guard.
  const viewer = await currentPerson();
  if (!viewer || !mayManageBanks(viewer)) return {};
  const stored = await loadStoredDeck(viewer.orgId, id).catch(() => undefined);
  return stored ? { title: `Question banks: ${stored.record.meta.title}` } : {};
}

export default async function QuestionsPage({ params }: QuestionsPageProps) {
  const { id } = await params;
  const person = await requireUserPage(banksHref(id));
  if (!mayManageBanks(person)) notFound();

  const stored = await loadStoredDeck(person.orgId, id).catch(() => undefined);
  if (!stored) notFound();

  const [pre, post] = await Promise.all([
    bankForAdministrator(person, id, 'pre'),
    bankForAdministrator(person, id, 'post'),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <div className="flex items-center gap-4">
          <Link
            href={resultsHref(id)}
            className="text-muted hover:text-teal text-sm transition-colors"
          >
            Results and feedback
          </Link>
          <MainNav person={person} />
        </div>
      </BrandHeader>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8">
        <Link
          href={`/decks/${encodeURIComponent(id)}`}
          className="text-muted hover:text-teal mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Back to the deck
        </Link>

        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Question banks</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{stored.record.meta.title}</h1>
        <p className="text-muted mt-3 max-w-2xl text-base leading-relaxed">
          Multiple choice questions for before and after the session, each with exactly one correct
          answer. Participants never see the answers, only their score. A deck without a pre-session
          bank lets participants start straight away.
        </p>

        <div className="mt-8">
          <QuestionBanks deckId={id} banks={{ pre, post }} />
        </div>
      </main>
    </div>
  );
}
