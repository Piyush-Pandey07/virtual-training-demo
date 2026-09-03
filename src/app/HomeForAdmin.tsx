/**
 * What HR or a manager sees when they sign in.
 *
 * The product home: upload a deck, see what is in the library and what state it is
 * in, and get to the two things that only exist once there are trainees — who has
 * been given what, and how far each of them has got.
 */

import Link from 'next/link';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import type { DeckSummary } from '@/lib/decks/store';
import type { SignedInPerson } from '@/lib/roster/types';
import { TRAINER_NAME } from '@/lib/trainer';

const STEPS = [
  {
    title: 'Upload a PDF',
    body: 'The deck is read and rendered in the browser, so the file itself never leaves the machine it was opened on. Only the rendered pages and the text printed on them are uploaded.',
  },
  {
    title: 'It reads the deck',
    body: 'Three passes: what each page is and how long it deserves, how to teach it rather than summarise it, and the expertise a practitioner would bring to the questions it raises.',
  },
  {
    title: 'Assign it, then watch',
    body: 'Publish the deck, give it to the people who need it, and see who has attended and who has not. Progress counts what the trainer actually taught, not slides clicked past.',
  },
];

export interface AdminHomeData {
  person: SignedInPerson;
  uploaded: DeckSummary[];
  demo: DeckSummary | undefined;
  canUpload: boolean;
  peopleCount: number;
  outstanding: number;
  rosterReady: boolean;
}

export function HomeForAdmin({
  person,
  uploaded,
  demo,
  canUpload,
  peopleCount,
  outstanding,
  rosterReady,
}: AdminHomeData) {
  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={person} current="/" />
      </BrandHeader>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">
          AI-led training sessions
        </p>

        <h1 className="mt-3 max-w-3xl text-4xl leading-tight font-bold sm:text-5xl">
          Turn a deck into a live training session
        </h1>

        <p className="text-muted mt-4 max-w-2xl text-lg leading-relaxed">
          Upload a presentation and {TRAINER_NAME} presents it one to one: explaining each slide,
          answering questions out loud, and waiting for the trainee rather than running to a script.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {canUpload ? (
            <Link
              href="/decks/new"
              className="bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-6 py-3 text-base font-semibold transition-colors"
            >
              Upload a deck
            </Link>
          ) : (
            <span className="border-charcoal-line text-muted rounded-md border border-dashed px-6 py-3 text-base font-semibold">
              Uploading is not configured
            </span>
          )}

          {/* The sample session, and the only place it is offered. */}
          {demo && (
            <Link
              href={`/session?deck=${encodeURIComponent(demo.id)}`}
              className="border-charcoal-line text-mist hover:border-teal hover:text-teal rounded-md border px-6 py-3 text-base font-semibold transition-colors"
            >
              See a worked example
            </Link>
          )}
        </div>

        {!rosterReady && (
          <div
            role="alert"
            className="border-logo-red/40 bg-logo-red/10 mt-6 rounded-md border p-4 text-sm"
          >
            <p className="font-semibold">Nobody can be assigned anything yet.</p>
            <p className="text-muted mt-1 leading-relaxed">
              This deployment has no roster storage, so people, assignments and progress cannot be
              saved. Decks still work; the training records do not.
            </p>
          </div>
        )}

        <section className="mt-14 grid gap-4 sm:grid-cols-3">
          <Link
            href="/people"
            className="border-charcoal-line bg-charcoal-soft hover:border-teal rounded-xl border p-5 transition-colors"
          >
            <p className="text-muted text-sm">People</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{peopleCount}</p>
            <p className="text-muted mt-1 text-sm">Assign training and see who has done it</p>
          </Link>

          <div className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5">
            <p className="text-muted text-sm">Still to attend</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{outstanding}</p>
            <p className="text-muted mt-1 text-sm">Assignments nobody has finished yet</p>
          </div>

          <Link
            href="/decks"
            className="border-charcoal-line bg-charcoal-soft hover:border-teal rounded-xl border p-5 transition-colors"
          >
            <p className="text-muted text-sm">Decks</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{uploaded.length}</p>
            <p className="text-muted mt-1 text-sm">Uploaded and ready to assign</p>
          </Link>
        </section>

        <section className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-xl font-semibold">Your decks</h2>
            {uploaded.length > 0 && (
              <Link href="/decks" className="text-muted hover:text-teal text-sm transition-colors">
                Manage all {uploaded.length}
              </Link>
            )}
          </div>

          {uploaded.length === 0 ? (
            <p className="border-charcoal-line text-muted mt-4 rounded-xl border border-dashed p-8 text-center text-sm leading-relaxed">
              Nothing uploaded yet.
              {canUpload ? (
                <>
                  {' '}
                  <Link href="/decks/new" className="text-teal hover:underline">
                    Upload your first deck
                  </Link>{' '}
                  and it will appear here once it has been read.
                </>
              ) : (
                ' Configure blob storage to enable uploading.'
              )}
            </p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {uploaded.slice(0, 5).map((deck) => (
                <li
                  key={deck.id}
                  className="border-charcoal-line bg-charcoal-soft flex flex-wrap items-center justify-between gap-4 rounded-xl border px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">{deck.title}</p>
                    <p className="text-muted mt-0.5 text-sm">
                      {deck.slideCount} slides · {deck.estimatedMinutes} min ·{' '}
                      {deck.status === 'published' ? 'Published' : 'Draft'}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Link
                      href={`/decks/${encodeURIComponent(deck.id)}/progress`}
                      className="border-charcoal-line text-muted hover:text-mist rounded-md border px-4 py-2 text-sm font-semibold transition-colors"
                    >
                      Progress
                    </Link>
                    <Link
                      href={`/decks/${encodeURIComponent(deck.id)}`}
                      className="border-charcoal-line text-muted hover:text-mist rounded-md border px-4 py-2 text-sm font-semibold transition-colors"
                    >
                      Review
                    </Link>
                    <Link
                      href={`/session?deck=${encodeURIComponent(deck.id)}`}
                      className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                        deck.status === 'published'
                          ? 'bg-azure text-mist hover:bg-teal hover:text-charcoal'
                          : 'border-charcoal-line text-muted hover:text-mist border'
                      }`}
                    >
                      {deck.status === 'published' ? 'Run' : 'Preview'}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-14">
          <h2 className="text-xl font-semibold">How it works</h2>
          <ol className="mt-5 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5"
              >
                <span className="text-azure-bright text-sm font-bold tabular-nums">
                  {index + 1}
                </span>
                <h3 className="mt-2 font-semibold">{step.title}</h3>
                <p className="text-muted mt-2 text-sm leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-charcoal-line text-muted border-t px-5 py-6 text-sm sm:px-8">
        <p>Technavious internal training platform. Signed in as {person.email}.</p>
      </footer>
    </div>
  );
}
