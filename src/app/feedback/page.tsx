/**
 * A participant's feedback on a session (BRD v2.3: AI-31).
 *
 * `/feedback?deck=...`, with `&session=...` when the session was trainer-led. Mandatory,
 * and straight after the post-session assessment, so the page sends somebody who has not
 * taken that assessment back to it first, and tells somebody who has already given
 * feedback that they have.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireUserPage } from '@/lib/auth/guard';
import { assessmentHref, feedbackHref, sessionHref } from '@/lib/assessments/paths';
import {
  assessmentPaper,
  feedbackDone,
  hasAttended,
  ownResult,
  participation,
  Refused,
} from '@/lib/assessments/service';
import { CURRENT_FEEDBACK_SET } from '@/lib/assessments/types';
import { loadStoredDeck } from '@/lib/decks/registry';
import type { TrainingSession } from '@/lib/training/types';
import { FeedbackForm } from './FeedbackForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Session feedback' };

interface FeedbackPageProps {
  searchParams: Promise<{ deck?: string; session?: string }>;
}

const BUTTON =
  'bg-azure text-mist hover:bg-teal hover:text-charcoal mt-5 inline-block rounded-md px-5 py-2.5 text-sm font-semibold transition-colors';

export default async function FeedbackPage({ searchParams }: FeedbackPageProps) {
  const { deck, session: sessionParam } = await searchParams;
  const deckId = deck?.trim() ?? '';
  const sessionId = sessionParam?.trim() || null;

  const person = await requireUserPage(deckId ? feedbackHref(deckId, sessionId) : '/');
  if (!deckId) notFound();

  let session: TrainingSession | null;
  try {
    ({ session } = await participation(person, deckId, sessionId));
  } catch (error) {
    if (error instanceof Refused) notFound();
    throw error;
  }

  const stored = await loadStoredDeck(person.orgId, deckId).catch(() => undefined);
  if (!stored) notFound();

  const [given, attended, postPaper, postResult] = await Promise.all([
    feedbackDone(person.orgId, person.id, deckId, session?.id ?? null),
    hasAttended(person, deckId, session),
    assessmentPaper(person.orgId, deckId, 'post'),
    ownResult(person.orgId, person.id, deckId, 'post'),
  ]);
  const assessmentFirst = postPaper !== null && postResult === undefined;

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={person} />
      </BrandHeader>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-12 sm:px-8">
        <Link
          href="/"
          className="text-muted hover:text-teal mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Your training
        </Link>

        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Session feedback</p>
        <h1 className="mt-3 text-3xl font-bold">{stored.record.meta.title}</h1>

        <div className="mt-8">
          {given ? (
            <section className="border-charcoal-line bg-charcoal-soft rounded-xl border p-6">
              <p className="leading-relaxed">
                You have already given your feedback on this session. Thank you.
              </p>
              <Link href="/" className="text-teal mt-4 inline-block text-sm hover:underline">
                Back to your training
              </Link>
            </section>
          ) : !attended ? (
            <section className="border-charcoal-line bg-charcoal-soft rounded-xl border p-6">
              <p className="leading-relaxed">Feedback opens once you have attended the session.</p>
              {!session && (
                <Link href={sessionHref(deckId)} className={BUTTON}>
                  Go to the session
                </Link>
              )}
            </section>
          ) : assessmentFirst ? (
            <section className="border-charcoal-line bg-charcoal-soft rounded-xl border p-6">
              <p className="leading-relaxed">
                Please take the short post-session assessment first. Feedback comes straight after
                it.
              </p>
              <Link href={assessmentHref('post', deckId, session?.id)} className={BUTTON}>
                Take the assessment
              </Link>
            </section>
          ) : (
            <>
              <p className="text-muted mb-8 leading-relaxed">
                Tell us how the session went. Choose a rating from 1 to 5 for each question. It
                takes about a minute, and every rating is needed before you can send it.
              </p>
              <FeedbackForm
                deckId={deckId}
                sessionId={session?.id ?? null}
                set={CURRENT_FEEDBACK_SET}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
