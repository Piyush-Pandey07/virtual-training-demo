import type { Metadata } from 'next';
import Link from 'next/link';

import { BrandHeader } from '@/components/BrandHeader';
import { DEFAULT_DECK_ID, deckStore, listDecks } from '@/lib/decks/registry';
import { TRAINER_NAME } from '@/lib/trainer';

// The library is read per request. Prerendering would bake in whichever decks
// existed when the build ran, so an uploaded deck would never appear here.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Technavious | AI-led training sessions',
  description:
    'Upload a deck and run a one to one training session where an AI trainer presents it and answers questions by voice.',
};

/**
 * What the trainer does, said without reference to any one deck.
 *
 * This page used to be the ISMS deck's own front door: its title as the heading, its
 * slide list, its running time, its audience in the copy. That was right when there
 * was one deck and wrong the moment a trainer could upload their own, because it
 * described the sample rather than the software.
 */
const CAPABILITIES = [
  {
    title: 'It teaches, it does not read aloud',
    body: `${TRAINER_NAME} works from what is printed on each slide and from the expertise the analysis wrote behind it, then explains each point in its own words with examples the audience would recognise.`,
  },
  {
    title: 'Interrupt whenever you like',
    body: 'The trainee starts speaking and the trainer stops mid-sentence to listen, the way a person would. Ask again, ask for an example, or ask it to move on.',
  },
  {
    title: 'Questions move the deck',
    body: 'A question about something three slides ahead brings that slide up and answers it there, so the trainee is never told about something they cannot see.',
  },
  {
    title: 'It follows the trainee',
    body: 'Nothing advances until they are ready. They can jump back, ask for a point again, or ask to be tested on what has been covered so far.',
  },
];

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
    title: 'Review, then run',
    body: 'Nothing is published until a trainer has read what was written and corrected anything wrong. Then it runs as a live session, one trainee at a time.',
  },
];

export default async function HomePage() {
  const store = deckStore();
  const decks = await listDecks();

  // Uploaded decks only. The built-in deck is reachable from the one button in the
  // hero, and listing it here as well would put the sample back in the middle of a
  // page that is meant to be about the trainer's own decks.
  //
  // Keyed on origin rather than readOnly, because seeding the built-in deck into a
  // writable store makes it editable without making it the trainer's.
  const uploaded = decks.filter((deck) => deck.origin !== 'authored');
  const demo = decks.find((deck) => deck.id === DEFAULT_DECK_ID);

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <Link href="/decks" className="text-muted hover:text-teal text-sm transition-colors">
          Deck library
        </Link>
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
          {store.writable ? (
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

          {/* The sample session, and the only place on this page it is offered. */}
          {demo && (
            <Link
              href={`/session?deck=${encodeURIComponent(demo.id)}`}
              className="border-charcoal-line text-mist hover:border-teal hover:text-teal rounded-md border px-6 py-3 text-base font-semibold transition-colors"
            >
              See a worked example
            </Link>
          )}
        </div>

        <p className="text-muted mt-4 text-sm">
          {store.writable
            ? 'PDF, read in your browser. Sessions need microphone access, and headphones are recommended.'
            : 'This deployment presents its built-in deck only. Blob storage has not been configured.'}
        </p>

        <section className="mt-16">
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
              {store.writable ? (
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

                  <div className="flex shrink-0 gap-2">
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
          <h2 className="text-xl font-semibold">What the trainer does</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {CAPABILITIES.map((item) => (
              <article
                key={item.title}
                className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5"
              >
                {/* Azure rule as the section marker, per the brand layout rules. */}
                <div className="bg-azure mb-3 h-0.5 w-10 rounded-full" />
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="text-muted mt-2 text-sm leading-relaxed">{item.body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-charcoal-line text-muted border-t px-5 py-6 text-sm sm:px-8">
        <p>Technavious internal training platform.</p>
      </footer>
    </div>
  );
}
