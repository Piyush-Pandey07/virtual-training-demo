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
import { requireAdminPage } from '@/lib/auth/guard';
import { loadStoredDeck } from '@/lib/decks/registry';
import { rosterStore } from '@/lib/roster/registry';
import { effectiveRole } from '@/lib/auth/roles';
import { AssignDeck, type Assignee, type Candidate } from './AssignDeck';
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
  await requireAdminPage();
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

  // Who could attend this, and who already has it.
  //
  // Read here rather than in the panel so the browser is never handed the roster of a
  // deck somebody is only allowed to look at: this page is behind requireAdminPage, and
  // what crosses is a name, an address and a due date, which is what the screen shows.
  //
  // A roster that is not configured is not an error. The deck half of this app works
  // without one, and a review screen that 500s because nobody has set up Firestore
  // would take the whole upload flow down with it.
  let assigned: Assignee[] = [];
  let candidates: Candidate[] = [];
  let rosterAvailable = false;

  const store = rosterStore();
  if (store.writable) {
    try {
      const [people, assignments] = await Promise.all([
        store.listPeople(),
        store.listAssignmentsForDeck(id),
      ]);

      const byId = new Map(people.map((person) => [person.id, person]));
      assigned = assignments.flatMap((assignment) => {
        const person = byId.get(assignment.personId);
        return person
          ? [
              {
                id: person.id,
                name: person.name,
                email: person.email,
                dueAt: assignment.dueAt,
                assignedAt: assignment.assignedAt,
              },
            ]
          : [];
      });

      // Administrators are included, marked as such.
      //
      // They can open any deck without being assigned one, so listing them looks
      // redundant — but an assignment is the record of who *must* complete something,
      // not a grant of access. Whoever runs ISMS training has to sit through ISMS
      // training, and leaving them off the list means the one person who could notice
      // that gap is the one person who cannot be tracked against it.
      const taken = new Set(assignments.map((assignment) => assignment.personId));
      candidates = people
        .filter((person) => !taken.has(person.id))
        .map((person) => ({
          id: person.id,
          name: person.name,
          email: person.email,
          admin: effectiveRole(person) === 'admin',
        }));

      rosterAvailable = true;
    } catch {
      // Left unavailable. The panel says so rather than the page failing.
      rosterAvailable = false;
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <div className="flex items-center gap-4">
          {/* Where somebody lands after publishing, which is exactly when they want to
              know who it went to. */}
          <Link
            href={`/decks/${encodeURIComponent(id)}/progress`}
            className="text-muted hover:text-teal text-sm transition-colors"
          >
            Who has attended
          </Link>
          <Link href="/decks" className="text-muted hover:text-teal text-sm transition-colors">
            Deck library
          </Link>
        </div>
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

        <div className="mt-8 space-y-8">
          <DeckReview initial={review} />

          {rosterAvailable && (
            <AssignDeck
              deckId={review.id}
              published={stored.status === 'published'}
              candidates={candidates}
              assigned={assigned}
            />
          )}
        </div>
      </main>
    </div>
  );
}
