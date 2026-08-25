import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { estimatedMinutes } from '@/lib/deck';
import type { DeckMeta } from '@/lib/deck-types';
import { deckStore, loadDeck } from '@/lib/decks/registry';
import { TRAINER_NAME } from '@/lib/trainer';

// The deck is read from storage per request. Prerendering would bake in whichever
// deck existed when the build ran.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const deck = await loadDeck();
  if (!deck) return {};
  return {
    title: `${deck.meta.owner} | ${deck.meta.title}`,
    description: `A one to one live training session where an AI trainer presents ${deck.meta.title} and answers questions by voice.`,
  };
}

/**
 * What the trainer does, said once for whichever deck is loaded.
 *
 * The first card used to name data centre consultancy, which is true of this deck's
 * audience and meaningless for anyone else's, so it comes off the deck now.
 */
function capabilities(meta: DeckMeta) {
  return [
    {
      title: 'It teaches, it does not read aloud',
      body: `${TRAINER_NAME} works from the slide content and the presenter notes, then explains each point with examples drawn from ${meta.exampleContext}.`,
    },
    {
      title: 'Interrupt whenever you like',
      body: 'Start speaking and the trainer stops mid-sentence to listen, the way a person would. Ask again, ask for an example, or ask it to move on.',
    },
    {
      title: 'Questions answered in context',
      body: 'Answers come from this deck first. If a question needs something the deck does not carry, the trainer says so instead of inventing policy.',
    },
    {
      title: 'It follows your pace',
      body: 'Nothing advances until you are ready. Jump back to any slide, ask for a point again, or ask to be tested on what you have covered.',
    },
  ];
}

export default async function HomePage() {
  const deck = await loadDeck();

  // Whether this deployment can take an upload at all. A seeded, read-only
  // deployment presents the demo and nothing else, and offering an upload there
  // sends the visitor to a page that can only tell them no.
  const writable = deckStore().writable;

  // No default deck means either an empty library or one whose seed deck was
  // deleted. The library page says so usefully; a 404 on the front door does not.
  if (!deck) redirect('/decks');

  const { meta, slides } = deck;

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">
          AI-led awareness training
        </p>

        <h1 className="mt-3 text-4xl leading-tight font-bold sm:text-5xl">{meta.title}</h1>

        <p className="text-muted mt-3 max-w-2xl text-lg">{meta.subtitle}</p>

        <p className="mt-6 max-w-2xl text-base leading-relaxed sm:text-lg">
          A one to one session with {TRAINER_NAME}, an AI trainer who presents the deck, answers
          your questions out loud, and waits for you rather than running to a script. Roughly{' '}
          {estimatedMinutes(deck)} minutes of narration across {slides.length} slides, plus however
          long your questions take.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/session"
            className="bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-6 py-3 text-base font-semibold transition-colors"
          >
            Start the session
          </Link>
          {writable && (
            <Link
              href="/decks/new"
              className="border-charcoal-line text-mist hover:border-teal hover:text-teal rounded-md border px-6 py-3 text-base font-semibold transition-colors"
            >
              Upload your own deck
            </Link>
          )}
          <p className="text-muted text-sm">
            You will be asked for microphone access. Headphones are recommended.
          </p>
        </div>

        <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
          This session is the worked example, and it stays here so anyone can see how the trainer
          behaves before trusting it with a deck of their own.{' '}
          {writable
            ? 'Upload a PDF and it is read, analysed and taught the same way.'
            : 'Uploading is not configured on this deployment.'}{' '}
          <Link href="/decks" className="hover:text-teal underline transition-colors">
            Browse the deck library
          </Link>
        </p>

        <section className="mt-14 grid gap-4 sm:grid-cols-2">
          {capabilities(meta).map((item) => (
            <article
              key={item.title}
              className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5"
            >
              {/* Azure rule as the section marker, per the brand layout rules. */}
              <div className="bg-azure mb-3 h-0.5 w-10 rounded-full" />
              <h2 className="text-lg font-semibold">{item.title}</h2>
              <p className="text-muted mt-2 text-sm leading-relaxed">{item.body}</p>
            </article>
          ))}
        </section>

        <section className="mt-14">
          <h2 className="text-xl font-semibold">What the session covers</h2>
          <ol className="divide-charcoal-line border-charcoal-line mt-4 divide-y overflow-hidden rounded-xl border">
            {slides.map((slide) => (
              <li key={slide.id} className="bg-charcoal-soft flex items-baseline gap-4 px-5 py-3.5">
                <span className="text-azure-bright w-6 shrink-0 text-sm font-bold tabular-nums">
                  {slide.id}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{slide.title}</p>
                  <p className="text-muted mt-0.5 text-sm">{slide.summary}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-charcoal-line text-muted border-t px-5 py-6 text-sm sm:px-8">
        <p>
          {meta.owner} internal awareness training. Slide content is reproduced from the approved
          deck.
        </p>
      </footer>
    </div>
  );
}
