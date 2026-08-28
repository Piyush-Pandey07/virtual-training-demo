/**
 * Everybody who was given this deck, and how far each of them has got.
 *
 * The other axis of the same data as a person's profile, and the one an administrator
 * actually chases people from. Sorted least-progressed first, because the rows worth
 * looking at are at the top.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { ProgressBar } from '@/components/ProgressBar';
import { SignOutButton } from '@/components/SignOutButton';
import { requireAdminPage } from '@/lib/auth/guard';
import { loadStoredDeck } from '@/lib/decks/registry';
import { progressForDeck } from '@/lib/roster/report';

export const dynamic = 'force-dynamic';

interface ProgressPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ProgressPageProps): Promise<Metadata> {
  const { id } = await params;
  const stored = await loadStoredDeck(id).catch(() => undefined);
  return { title: stored ? `Progress: ${stored.record.meta.title}` : 'Technavious' };
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'unknown';
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default async function DeckProgressPage({ params }: ProgressPageProps) {
  await requireAdminPage();
  const { id } = await params;

  const stored = await loadStoredDeck(id).catch(() => undefined);
  if (!stored) notFound();

  const rows = await progressForDeck(id);
  const complete = rows.filter((row) => row.completedAt !== null).length;
  const started = rows.filter((row) => row.percent > 0 && row.completedAt === null).length;
  const notStarted = rows.length - complete - started;

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <div className="flex items-center gap-4">
          <Link href="/decks" className="text-muted hover:text-teal text-sm transition-colors">
            Deck library
          </Link>
          <SignOutButton />
        </div>
      </BrandHeader>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8">
        <Link
          href={`/decks/${encodeURIComponent(id)}`}
          className="text-muted hover:text-teal mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Back to the deck
        </Link>

        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Progress</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{stored.record.meta.title}</h1>

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5">
            <p className="text-muted text-sm">Complete</p>
            <p className="text-teal mt-1 text-3xl font-bold tabular-nums">{complete}</p>
          </div>
          <div className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5">
            <p className="text-muted text-sm">In progress</p>
            <p className="text-azure-bright mt-1 text-3xl font-bold tabular-nums">{started}</p>
          </div>
          <div className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5">
            <p className="text-muted text-sm">Not started</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{notStarted}</p>
          </div>
        </section>

        {rows.length === 0 ? (
          <p className="border-charcoal-line text-muted mt-10 rounded-xl border border-dashed p-8 text-center text-sm leading-relaxed">
            Nobody has been given this deck yet. Assign it from{' '}
            <Link href="/people" className="text-teal hover:underline">
              a person&rsquo;s profile
            </Link>
            .
          </p>
        ) : (
          <section className="mt-10">
            <h2 className="text-xl font-semibold">
              {rows.length} {rows.length === 1 ? 'person' : 'people'}
            </h2>

            <ul className="mt-4 grid gap-3">
              {rows.map((row) => (
                <li
                  key={row.personId}
                  className="border-charcoal-line bg-charcoal-soft rounded-xl border px-5 py-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Link
                      href={`/people/${encodeURIComponent(row.personId)}`}
                      className="hover:text-teal min-w-0 font-semibold transition-colors"
                    >
                      {row.personName}
                    </Link>
                    <span
                      className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${
                        row.completedAt
                          ? 'bg-teal/15 text-teal'
                          : row.percent > 0
                            ? 'bg-azure/20 text-azure-bright'
                            : 'bg-charcoal-line text-muted'
                      }`}
                    >
                      {row.completedAt
                        ? 'Complete'
                        : row.percent > 0
                          ? `${row.percent}%`
                          : 'Not started'}
                    </span>
                  </div>

                  <div className="mt-3">
                    <ProgressBar
                      percent={row.percent}
                      complete={row.completedAt !== null}
                      label={`${row.personName} progress`}
                    />
                  </div>

                  <p className="text-muted mt-2 flex flex-wrap gap-x-4 text-sm">
                    <span>
                      {row.coverage.coveredCount} of {row.coverage.slideCount} slides
                    </span>
                    <span>Assigned {formatDate(row.assignedAt)}</span>
                    {row.dueAt && <span>Due {formatDate(row.dueAt)}</span>}
                    <span>Last attended {formatDate(row.lastSeenAt)}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
