/**
 * Results and feedback for one deck, or for one trainer-led session of it (BRD v2.3:
 * AI-04, AI-29, AI-31).
 *
 * One row per participant: where the pre-session assessment placed them, their
 * post-session score and whether it passed, and whether they have given feedback. Below,
 * the feedback itself, averaged, with the comments.
 *
 * Open to the administrator, a company administrator and a facilitator, each seeing
 * what `access.ts` allows: a facilitator sees only the people in their own sessions and
 * batches, and a company administrator sees results but no feedback. Anybody else gets
 * a 404. `?session=...` narrows it to one trainer-led session, which a facilitator may
 * open only for a session they run.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireUserPage } from '@/lib/auth/guard';
import { currentPerson } from '@/lib/auth/session';
import { mayManageBanks, mayOpenResults } from '@/lib/assessments/access';
import { banksHref, resultsHref } from '@/lib/assessments/paths';
import {
  assessmentPaper,
  Refused,
  resultsForDeck,
  type DeckResults,
} from '@/lib/assessments/service';
import { LEVEL_LABELS, PASS_MARK, RATING_MAX, SAMPLE_LABEL } from '@/lib/assessments/types';
import { loadStoredDeck } from '@/lib/decks/registry';

export const dynamic = 'force-dynamic';

interface ResultsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session?: string }>;
}

export async function generateMetadata({ params }: ResultsPageProps): Promise<Metadata> {
  const { id } = await params;
  const viewer = await currentPerson();
  if (!viewer || !mayOpenResults(viewer)) return {};
  const stored = await loadStoredDeck(viewer.orgId, id).catch(() => undefined);
  return stored ? { title: `Results: ${stored.record.meta.title}` } : {};
}

function onDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5">
      <p className="text-muted text-sm">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${tone ?? ''}`}>{value}</p>
    </div>
  );
}

function FeedbackSection({ feedback }: { feedback: NonNullable<DeckResults['feedback']> }) {
  return (
    <section className="mt-12" aria-labelledby="feedback-heading">
      <h2 id="feedback-heading" className="text-xl font-semibold">
        Feedback
      </h2>
      <p className="text-muted mt-1 text-sm">
        {feedback.responses} {feedback.responses === 1 ? 'response' : 'responses'},{' '}
        {feedback.pending} still to give it. Ratings are out of {RATING_MAX}.
      </p>

      {feedback.responses > 0 && (
        <>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {feedback.averages.map((rating) => (
              <div
                key={rating.id}
                className="border-charcoal-line bg-charcoal-soft rounded-xl border px-5 py-4"
              >
                <dt className="text-muted text-sm">{rating.prompt}</dt>
                <dd className="mt-1 text-2xl font-bold tabular-nums">
                  {rating.average === null ? 'No ratings' : rating.average.toFixed(1)}
                  <span className="text-muted ml-2 text-sm font-normal">from {rating.count}</span>
                </dd>
              </div>
            ))}
          </dl>

          <h3 className="mt-8 font-semibold">Comments</h3>
          {feedback.comments.length === 0 ? (
            <p className="text-muted mt-2 text-sm">Nobody has left a comment.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {feedback.comments.map((comment, index) => (
                <li
                  key={index}
                  className="border-charcoal-line bg-charcoal-soft rounded-xl border px-5 py-4 text-sm leading-relaxed whitespace-pre-line"
                >
                  {comment.text}
                  <span className="text-muted mt-2 block text-xs">
                    {onDate(comment.submittedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export default async function ResultsPage({ params, searchParams }: ResultsPageProps) {
  const [{ id }, { session: sessionParam }] = await Promise.all([params, searchParams]);
  const sessionId = sessionParam?.trim() || null;

  const person = await requireUserPage(resultsHref(id, sessionId));
  if (!mayOpenResults(person)) notFound();

  const stored = await loadStoredDeck(person.orgId, id).catch(() => undefined);
  if (!stored) notFound();

  let report: DeckResults;
  try {
    report = await resultsForDeck(person, id, sessionId);
  } catch (error) {
    if (error instanceof Refused) notFound();
    throw error;
  }

  const [prePaper, postPaper] = await Promise.all([
    assessmentPaper(person.orgId, id, 'pre'),
    assessmentPaper(person.orgId, id, 'post'),
  ]);

  const { rows, feedback, session } = report;
  const passed = rows.filter((row) => row.post?.passed).length;
  const failed = rows.filter((row) => row.post && !row.post.passed).length;
  const preTaken = rows.filter((row) => row.pre).length;
  const showFeedback = feedback !== null;
  const administrator = person.role === 'admin' || person.platform;

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <div className="flex items-center gap-4">
          {mayManageBanks(person) && (
            <Link
              href={banksHref(id)}
              className="text-muted hover:text-teal text-sm transition-colors"
            >
              Question banks
            </Link>
          )}
          <MainNav person={person} />
        </div>
      </BrandHeader>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-8">
        <Link
          href={administrator ? `/decks/${encodeURIComponent(id)}` : '/'}
          className="text-muted hover:text-teal mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <span aria-hidden="true">&larr;</span> {administrator ? 'Back to the deck' : 'Home'}
        </Link>

        <p className="text-teal text-sm font-semibold tracking-wide uppercase">
          {session ? 'Trainer-led session results' : 'Results and feedback'}
        </p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{stored.record.meta.title}</h1>
        <p className="text-muted mt-3 max-w-2xl text-base leading-relaxed">
          {session?.scheduledFor ? `The session planned for ${onDate(session.scheduledFor)}. ` : ''}
          The pass mark for the post-session assessment is {PASS_MARK}%.
          {showFeedback ? '' : ' Feedback is seen by the administrator and facilitators only.'}
          {session && (
            <>
              {' '}
              <Link href={resultsHref(id)} className="text-teal hover:underline">
                See everybody on this deck
              </Link>
              .
            </>
          )}
        </p>
        {(prePaper?.sample || postPaper?.sample) && (
          <p className="border-logo-red/50 mt-4 max-w-2xl rounded-md border px-4 py-3 text-sm">
            {SAMPLE_LABEL}: the{' '}
            {prePaper?.sample && postPaper?.sample
              ? 'pre and post-session questions were'
              : prePaper?.sample
                ? 'pre-session questions were'
                : 'post-session questions were'}{' '}
            generated to try the assessments out, and nobody has checked their answers. Read these
            results with that in mind.
          </p>
        )}

        <section
          className={`mt-8 grid gap-4 ${showFeedback ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}
        >
          <Tile label="Took the pre-session assessment" value={preTaken} />
          <Tile label="Passed" value={passed} tone="text-teal" />
          <Tile
            label="Did not pass"
            value={failed}
            tone={failed > 0 ? 'text-logo-red' : undefined}
          />
          {showFeedback && <Tile label="Feedback pending" value={feedback.pending} />}
        </section>

        {rows.length === 0 ? (
          <p className="border-charcoal-line text-muted mt-10 rounded-xl border border-dashed p-8 text-center text-sm leading-relaxed">
            Nobody is taking part in this {session ? 'session' : 'deck'} yet that you can see.
          </p>
        ) : (
          <section className="mt-10" aria-labelledby="participants-heading">
            <h2 id="participants-heading" className="text-xl font-semibold">
              {rows.length} {rows.length === 1 ? 'participant' : 'participants'}
            </h2>
            <div className="border-charcoal-line mt-4 overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="bg-charcoal-soft text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Participant
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Starting level
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Post-session score
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Result
                    </th>
                    {showFeedback && (
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Feedback
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.personId} className="border-charcoal-line border-t">
                      <th scope="row" className="px-4 py-3 font-semibold">
                        {row.name}
                        {row.email && row.email !== row.name && (
                          <span className="text-muted block text-xs font-normal">{row.email}</span>
                        )}
                      </th>
                      <td className="px-4 py-3">
                        {row.pre ? (
                          <>
                            {row.pre.level ? LEVEL_LABELS[row.pre.level] : 'Recorded'}
                            <span className="text-muted block text-xs">{row.pre.percent}%</span>
                          </>
                        ) : (
                          <span className="text-muted">
                            {prePaper ? 'Not taken' : 'No assessment'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {row.post ? (
                          <>
                            {row.post.percent}%
                            <span className="text-muted block text-xs">
                              {onDate(row.post.submittedAt)}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted">
                            {postPaper ? 'Not taken' : 'No assessment'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row.post ? (
                          <span
                            className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                              row.post.passed
                                ? 'bg-teal/15 text-teal'
                                : 'bg-logo-red/15 text-logo-red'
                            }`}
                          >
                            {row.post.passed ? 'Pass' : 'Fail'}
                          </span>
                        ) : (
                          <span className="text-muted">Not yet</span>
                        )}
                      </td>
                      {showFeedback && (
                        <td className="px-4 py-3">
                          {row.feedback === 'submitted' ? (
                            <span className="text-teal font-semibold">Submitted</span>
                          ) : (
                            <span className="text-muted">Pending</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {feedback && <FeedbackSection feedback={feedback} />}
      </main>
    </div>
  );
}
