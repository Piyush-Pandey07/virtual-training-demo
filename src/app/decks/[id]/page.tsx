/**
 * The review route.
 *
 * A server component so the deck is read and narrowed here. The review screen needs
 * more than a trainee does, since the trainer is checking generated content, but
 * still nothing that would be a problem in a browser: titles, summaries, roles and
 * budgets. Presenter notes and author-only notes do not cross, and the slide text
 * is reduced to a count.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { briefReadsAsSummary } from '@/lib/analysis/slide-detail';
import { checkReadyToPublish } from '@/lib/decks/serialise';
import { loadStoredDeck } from '@/lib/decks/registry';
import { DeckReview, type ReviewDeck } from './DeckReview';

export const dynamic = 'force-dynamic';

/** Matches THUMB_WIDTH in the renderer. Kept here so the markup declares the truth. */
const THUMB_WIDTH = 768;

function thumbSize(width?: number, height?: number): { width?: number; height?: number } {
  if (!width || !height) return {};
  const thumbWidth = Math.min(THUMB_WIDTH, width);
  return { width: thumbWidth, height: Math.round((height / width) * thumbWidth) };
}

interface ReviewPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ReviewPageProps): Promise<Metadata> {
  const { id } = await params;
  const stored = await loadStoredDeck(id).catch(() => undefined);
  return stored ? { title: `Review ${stored.record.meta.title}` } : {};
}

export default async function DeckReviewPage({ params }: ReviewPageProps) {
  const { id } = await params;

  // A bad id throws from the store rather than returning nothing, and a bad link
  // should be a 404 rather than a stack trace.
  const stored = await loadStoredDeck(id).catch(() => undefined);
  if (!stored) notFound();

  const { record } = stored;

  const review: ReviewDeck = {
    id: record.meta.id,
    status: stored.status,
    readOnly: stored.readOnly,
    meta: record.meta,
    slides: record.slides.map((slide) => ({
      id: slide.id,
      title: slide.title,
      shortLabel: slide.shortLabel,
      summary: slide.summary,
      role: slide.role,
      teaches: slide.teaches,
      targetSeconds: slide.targetSeconds,
      printedTitle: slide.printedTitle,
      // A count rather than the text. The trainer can see the page itself in the
      // thumbnail, and sending every bullet would put the whole deck in the browser
      // again for no gain.
      bulletCount: slide.bullets.length,
      // The three fields the teaching pass generates. They reach the spoken prompt
      // directly and are the most freely invented thing on the slide, so the screen
      // whose whole job is review has to show them.
      narrationBrief: slide.narrationBrief,
      keyPoints: slide.keyPoints,
      discussionPrompts: slide.discussionPrompts,
      briefLooksLikeSummary: briefReadsAsSummary(slide.narrationBrief),
      // The thumbnail's own size, not the full render's. Same ratio, but declaring
      // 1600 wide for an image that is 768 wide is a small lie in the markup.
      ...thumbSize(slide.width, slide.height),
    })),
    blocking: checkReadyToPublish(record),
    analysed: Boolean(record.meta.outlineAnalysedAt),
    authored: record.meta.origin === 'authored',
  };

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <Link href="/decks" className="text-muted hover:text-teal text-sm transition-colors">
          Deck library
        </Link>
      </BrandHeader>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">
          {stored.status === 'published' ? 'Published deck' : 'Draft deck'}
        </p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{record.meta.title}</h1>
        <p className="text-muted mt-3 max-w-2xl text-base leading-relaxed">
          {review.analysed
            ? 'This deck has been read. Everything below was generated from it, which means everything below is a suggestion. Read it before you publish.'
            : 'This deck has been rendered but not read. Analysing it fills in the titles, summaries and pacing from the pages themselves.'}
        </p>

        <div className="mt-8">
          <DeckReview initial={review} />
        </div>
      </main>
    </div>
  );
}
