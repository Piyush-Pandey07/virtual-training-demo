import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { estimatedMinutes } from '@/lib/deck';
import { loadDeck } from '@/lib/decks/registry';
import { TRAINER_NAME } from '@/lib/trainer';

const CAPABILITIES = [
  {
    title: 'It teaches, it does not read aloud',
    body: `${TRAINER_NAME} works from the slide content and the presenter notes, then explains each point with examples drawn from data centre consultancy work.`,
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

export default async function HomePage() {
  const deck = await loadDeck();
  if (!deck) notFound();

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
          <p className="text-muted text-sm">
            You will be asked for microphone access. Headphones are recommended.
          </p>
        </div>

        <section className="mt-14 grid gap-4 sm:grid-cols-2">
          {CAPABILITIES.map((item) => (
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
          Technavious internal awareness training. Slide content is reproduced from the approved
          ISMS deck.
        </p>
      </footer>
    </div>
  );
}
