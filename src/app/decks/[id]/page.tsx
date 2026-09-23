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
import { cache } from 'react';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { briefReadsAsSummary } from '@/lib/analysis/slide-detail';
import { checkReadyToPublish } from '@/lib/decks/serialise';
import { requireAdminPage } from '@/lib/auth/guard';
import { currentPerson } from '@/lib/auth/session';
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

/**
 * The deck, read once per request.
 *
 * `generateMetadata` and the page both need it, and they run alongside each other, so
 * without this every visit loaded the whole deck twice: the record, then its slides and
 * topics, about half a second each time. Scoped to one request by React, so an edit is
 * visible on the very next load.
 */
const loadDeckOnce = cache((orgId: string, id: string) => loadStoredDeck(orgId, id));

interface ReviewPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ReviewPageProps): Promise<Metadata> {
  const { id } = await params;
  // Asks who is signed in rather than reading blind. `generateMetadata` runs before
  // the page body and so outside its guard, so without this it would read a deck by
  // id for somebody with no right to it -- and now, with no customer to read it from.
  const viewer = await currentPerson();
  if (!viewer) return {};

  const stored = await loadDeckOnce(viewer.orgId, id).catch(() => undefined);
  return stored ? { title: `Review ${stored.record.meta.title}` } : {};
}

export default async function DeckReviewPage({ params }: ReviewPageProps) {
  // The id first, so a signed-out visitor is sent back to this deck after signing in
  // rather than to the home page, which is where a link in an email used to land.
  const { id } = await params;
  const admin = await requireAdminPage(`/decks/${encodeURIComponent(id)}`);

  // Who could attend this, and who already has it. Started now rather than after the
  // deck arrives, because it needs only the customer and the id and was otherwise
  // queued behind half a second of deck loading for no reason.
  //
  // Scoped to this admin's own customer, which requireAdminPage has already settled,
  // so reading it before the deck is confirmed exposes nothing: a bad id still 404s
  // below before any of it is rendered.
  const store = rosterStore(admin.orgId);
  const rosterRead = store.writable
    ? Promise.all([store.listPeople(), store.listAssignmentsForDeck(id)])
    : undefined;
  // Awaited inside a try below. This covers the one path where it never is: a bad id
  // reaching notFound() first, which would otherwise leave a rejection unhandled.
  rosterRead?.catch(() => undefined);

  // A bad id throws from the store rather than returning nothing, and a bad link
  // should be a 404 rather than a stack trace.
  const stored = await loadDeckOnce(admin.orgId, id).catch(() => undefined);
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

  if (rosterRead) {
    try {
      const [people, assignments] = await rosterRead;

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
          <MainNav person={admin} />
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
