/**
 * The deck library.
 *
 * Additive on purpose. `/` still opens the deck a client is here to see, because a
 * demo whose front door is a list of one item is a worse demo. This is where decks
 * are managed once there is more than one, and where uploading will live.
 */

import Link from 'next/link';

import { BrandHeader } from '@/components/BrandHeader';
import { requireAdminPage } from '@/lib/auth/guard';
import { deckStore, listDecks } from '@/lib/decks/registry';

// Read at request time. Prerendering this would bake in whichever decks existed
// when the build ran, so an uploaded deck would never appear.
export const dynamic = 'force-dynamic';

const STORE_DESCRIPTION: Record<string, string> = {
  blob: 'Decks are stored in blob storage and persist across deployments.',
  filesystem: 'Decks are stored on this machine, under .data/decks.',
  seeded:
    'No deck storage is configured, so this deployment presents the built-in deck only. Set BLOB_READ_WRITE_TOKEN to enable uploading.',
};

function formatDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || at.getTime() === 0) return 'unknown';
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default async function DeckLibraryPage() {
  // The library is an administrator's tool. A trainee gets a 404 rather than a
  // refusal: what decks exist is not something they need told.
  const admin = await requireAdminPage('/decks');

  const decks = await listDecks(admin.orgId);
  const store = deckStore(admin.orgId);

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <Link href="/" className="text-muted hover:text-teal text-sm transition-colors">
          Home
        </Link>
      </BrandHeader>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Deck library</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">
          {decks.length} {decks.length === 1 ? 'deck' : 'decks'}
        </h1>
        <p className="text-muted mt-3 max-w-2xl text-base leading-relaxed">
          {STORE_DESCRIPTION[store.kind]}
        </p>

        {store.writable && (
          <Link
            href="/decks/new"
            className="bg-azure text-mist hover:bg-teal hover:text-charcoal mt-6 inline-block rounded-md px-5 py-2.5 text-sm font-semibold transition-colors"
          >
            Upload a deck
          </Link>
        )}

        {decks.length === 0 ? (
          <p className="border-charcoal-line text-muted mt-10 rounded-xl border border-dashed p-8 text-center text-sm">
            There are no decks. The built-in deck may have been removed from storage.
          </p>
        ) : (
          <ul className="mt-10 grid gap-4">
            {decks.map((deck) => (
              <li
                key={deck.id}
                className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold">{deck.title}</h2>
                    <p className="text-muted mt-1 text-sm">{deck.subtitle}</p>
                  </div>

                  <span
                    className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${
                      deck.status === 'published'
                        ? 'bg-teal/15 text-teal'
                        : 'bg-charcoal-line text-muted'
                    }`}
                  >
                    {deck.status === 'published' ? 'Published' : 'Draft'}
                  </span>
                </div>

                <dl className="text-muted mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                  <div className="flex gap-1.5">
                    <dt>Slides</dt>
                    <dd className="text-mist tabular-nums">{deck.slideCount}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt>Narration</dt>
                    <dd className="text-mist tabular-nums">{deck.estimatedMinutes} min</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt>Updated</dt>
                    <dd className="text-mist">{formatDate(deck.updatedAt)}</dd>
                  </div>
                  {deck.readOnly && (
                    <div className="flex gap-1.5">
                      <dt>Source</dt>
                      <dd className="text-mist">built in, read-only</dd>
                    </div>
                  )}
                </dl>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href={`/session?deck=${encodeURIComponent(deck.id)}`}
                    className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                      deck.status === 'published'
                        ? 'bg-azure text-mist hover:bg-teal hover:text-charcoal'
                        : 'border-charcoal-line text-muted hover:text-mist border'
                    }`}
                  >
                    {deck.status === 'published' ? 'Run this session' : 'Preview the draft'}
                  </Link>
                  <Link
                    href={`/decks/${encodeURIComponent(deck.id)}/progress`}
                    className="border-charcoal-line text-muted hover:text-mist rounded-md border px-4 py-2 text-sm font-semibold transition-colors"
                  >
                    Who has attended
                  </Link>
                  {!deck.readOnly && (
                    <Link
                      href={`/decks/${encodeURIComponent(deck.id)}`}
                      className="border-charcoal-line text-muted hover:text-mist rounded-md border px-4 py-2 text-sm font-semibold transition-colors"
                    >
                      Review and analyse
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
