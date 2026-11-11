/**
 * A participant's pre or post-session assessment for one deck (BRD v2.3: AI-04, AI-29).
 *
 * `/assessment/pre?deck=...` before the session, `/assessment/post?deck=...` straight
 * after it, each with `&session=...` when the session is trainer-led. The page decides
 * which of four things to show: the result, if they have already submitted; that there is
 * nothing to take, if the deck has no bank; that the post-session one opens after the
 * session, if they have not attended; otherwise the questions, without their answers.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireUserPage } from '@/lib/auth/guard';
import { assessmentHref, feedbackHref, sessionHref } from '@/lib/assessments/paths';
import { summaryOf } from '@/lib/assessments/scoring';
import {
  assessmentPaperFor,
  feedbackDone,
  hasAttended,
  preAssessmentClosed,
  ownResult,
  participation,
  Refused,
} from '@/lib/assessments/service';
import {
  BANK_KIND_LABELS,
  isBankKind,
  PASS_MARK,
  SAMPLE_LABEL,
  type BankKind,
} from '@/lib/assessments/types';
import { loadStoredDeck } from '@/lib/decks/registry';
import { RESTRICTED_EXPLANATION, visibleTo } from '@/lib/retention/restricted';
import type { SignedInPerson } from '@/lib/roster/types';
import type { TrainingSession } from '@/lib/training/types';
import { AssessmentForm } from './AssessmentForm';
import { ResultCard, type NextLink } from './ResultCard';

export const dynamic = 'force-dynamic';

interface AssessmentPageProps {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ deck?: string; session?: string }>;
}

export async function generateMetadata({ params }: AssessmentPageProps): Promise<Metadata> {
  const { kind } = await params;
  return { title: isBankKind(kind) ? BANK_KIND_LABELS[kind] : 'Assessment' };
}

/** Where a participant goes once this assessment is done, or what they wait for instead. */
async function nextAfter(
  person: SignedInPerson,
  kind: BankKind,
  deckId: string,
  session: TrainingSession | null,
): Promise<{ next: NextLink | null; waiting: string | null }> {
  if (kind === 'pre') {
    // A trainer-led session is started by its facilitator, in the room, so there is
    // nothing to link to: the participant waits for them.
    // Somebody arriving late has done it on their own device and now joins the room.
    return session
      ? {
          next: null,
          waiting:
            session.status === 'open'
              ? 'You are ready. Join the session in the room, and your facilitator will mark you present.'
              : 'You are ready. Your facilitator will start the session.',
        }
      : { next: { href: sessionHref(deckId), label: 'Start the session' }, waiting: null };
  }
  // Feedback comes straight after the post-session assessment (AI-31), whether or not it
  // has been submitted yet, since this link is also shown on the form that submits it.
  const given = await feedbackDone(person.orgId, person.id, deckId, session?.id ?? null);
  return {
    next: given ? null : { href: feedbackHref(deckId, session?.id), label: 'Give your feedback' },
    waiting: null,
  };
}

export default async function AssessmentPage({ params, searchParams }: AssessmentPageProps) {
  const [{ kind }, { deck, session: sessionParam }] = await Promise.all([params, searchParams]);
  const deckId = deck?.trim() ?? '';
  const sessionId = sessionParam?.trim() || null;

  const person = await requireUserPage(
    isBankKind(kind) && deckId ? assessmentHref(kind, deckId, sessionId) : '/',
  );
  if (!isBankKind(kind) || !deckId) notFound();

  let session: TrainingSession | null;
  try {
    ({ session } = await participation(person, deckId, sessionId));
  } catch (error) {
    if (error instanceof Refused) notFound();
    throw error;
  }

  const stored = await loadStoredDeck(person.orgId, deckId).catch(() => undefined);
  if (!stored) notFound();

  const [existing, paper] = await Promise.all([
    ownResult(person.orgId, person.id, deckId, kind),
    assessmentPaperFor(person, deckId, kind),
  ]);
  const attended = kind === 'post' ? await hasAttended(person, deckId, session) : true;
  const { next, waiting } = await nextAfter(person, kind, deckId, session);

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

        <p className="text-teal text-sm font-semibold tracking-wide uppercase">
          {BANK_KIND_LABELS[kind]}
        </p>
        <h1 className="mt-3 text-3xl font-bold">{stored.record.meta.title}</h1>

        <div className="mt-8">
          {existing && !visibleTo(person, existing) ? (
            // Taken, and restricted under the retention policy (AI-41): it still stands, so
            // the paper is not offered again, but its score is no longer shown.
            <section className="border-charcoal-line bg-charcoal-soft rounded-xl border p-6">
              <p className="leading-relaxed">You have already taken this assessment.</p>
              <p className="text-muted mt-3 text-sm leading-relaxed">{RESTRICTED_EXPLANATION}</p>
            </section>
          ) : existing ? (
            <ResultCard result={summaryOf(existing)} next={next} waiting={waiting} />
          ) : !paper ? (
            <section className="border-charcoal-line bg-charcoal-soft rounded-xl border p-6">
              <p className="leading-relaxed">
                There is no {kind === 'pre' ? 'pre-session' : 'post-session'} assessment for this
                deck, so there is nothing to do here.
              </p>
              {next ? (
                <Link
                  href={next.href}
                  className="bg-azure text-mist hover:bg-teal hover:text-charcoal mt-5 inline-block rounded-md px-5 py-2.5 text-sm font-semibold transition-colors"
                >
                  {next.label}
                </Link>
              ) : (
                waiting && <p className="mt-4 text-sm">{waiting}</p>
              )}
            </section>
          ) : kind === 'pre' && preAssessmentClosed(session, person.id) ? (
            <section className="border-charcoal-line bg-charcoal-soft rounded-xl border p-6">
              <p className="leading-relaxed">
                {session?.status === 'cancelled'
                  ? 'This session was cancelled, so there is nothing to do here.'
                  : 'The pre-session assessment closed when your facilitator marked you in the session, so there is nothing to do here. Once you have attended, the post-session assessment opens as usual.'}
              </p>
              <Link
                href="/"
                className="bg-azure text-mist hover:bg-teal hover:text-charcoal mt-5 inline-block rounded-md px-5 py-2.5 text-sm font-semibold transition-colors"
              >
                Back to your training
              </Link>
            </section>
          ) : !attended ? (
            <section className="border-charcoal-line bg-charcoal-soft rounded-xl border p-6">
              <p className="leading-relaxed">
                This assessment opens once you have attended the session. It checks what you
                learned, so it comes straight after.
              </p>
              {!session && (
                <Link
                  href={sessionHref(deckId)}
                  className="bg-azure text-mist hover:bg-teal hover:text-charcoal mt-5 inline-block rounded-md px-5 py-2.5 text-sm font-semibold transition-colors"
                >
                  Go to the session
                </Link>
              )}
            </section>
          ) : (
            <>
              <div className="text-muted mb-8 space-y-3 leading-relaxed">
                {kind === 'pre' ? (
                  <p>
                    Before the session starts, answer {paper.questions.length} short questions about
                    the subject. This is not a test you can fail. It shows what you already know, so
                    the session can be pitched at the right level for you.
                  </p>
                ) : (
                  <p>
                    Now that the session is over, answer {paper.questions.length} short questions
                    about what it covered. Your score is the share of all the questions you answer
                    correctly, and {PASS_MARK}% or above is a pass. You will see your score as soon
                    as you submit.
                  </p>
                )}
                <p>
                  Choose one answer for each question. A question you leave blank is marked Not
                  attempted and scores nothing. There is no time limit, and you can take it once, so
                  check your answers before you submit.
                </p>
                {paper.sample && (
                  <p className="border-charcoal-line rounded-md border px-3 py-2 text-sm">
                    {SAMPLE_LABEL}: these questions were generated to try the assessment out and
                    have not been checked by a person yet.
                  </p>
                )}
              </div>
              <AssessmentForm
                paper={paper}
                sessionId={session?.id ?? null}
                next={next}
                waiting={waiting}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
