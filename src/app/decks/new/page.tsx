/**
 * The upload route.
 *
 * A server component so it can say up front whether uploading is even possible in
 * this deployment. Finding out only after choosing a file and watching it render
 * would waste a minute of someone's time to reach the same answer.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { BrandHeader } from '@/components/BrandHeader';
import { requireAdminPage } from '@/lib/auth/guard';
import { assetStore, deckStore } from '@/lib/decks/registry';
import { UploadDeck } from './UploadDeck';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Upload a deck' };

export default async function NewDeckPage() {
  await requireAdminPage('/decks/new');

  const decks = deckStore();
  const assets = assetStore();
  const canUpload = decks.writable && assets.writable;

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <Link href="/decks" className="text-muted hover:text-teal text-sm transition-colors">
          Deck library
        </Link>
      </BrandHeader>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-12 sm:px-8">
        <Link
          href="/"
          className="text-muted hover:text-teal mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Back
        </Link>

        <p className="text-teal text-sm font-semibold tracking-wide uppercase">New deck</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Upload a PDF</h1>
        <p className="text-muted mt-3 text-base leading-relaxed">
          The deck is read and rendered in your browser, and only the rendered pages are sent here.
          Each page becomes a slide, and the text printed on it becomes what the trainer works from.
        </p>

        {canUpload ? (
          <div className="mt-8">
            <UploadDeck />
          </div>
        ) : (
          <div
            role="alert"
            className="border-logo-red/40 bg-logo-red/10 mt-8 rounded-md border p-4 text-sm"
          >
            <p className="font-semibold">Uploading is not available in this deployment.</p>
            <p className="text-muted mt-1">
              There is no deck storage configured, so there is nowhere to put the rendered pages.
              Whoever deployed this needs to set <code>BLOB_READ_WRITE_TOKEN</code> and redeploy.
              The built-in deck still runs.
            </p>
          </div>
        )}

        <section className="border-charcoal-line mt-12 border-t pt-8">
          <h2 className="text-lg font-semibold">What this does and does not do yet</h2>
          <ul className="text-muted mt-3 space-y-2 text-sm leading-relaxed">
            <li>
              Every page is rendered twice: once for the trainee to look at, and once small for the
              analysis step to read.
            </li>
            <li>
              The text on each page is extracted, so the trainer has the slide content rather than
              only a picture of it.
            </li>
            <li>
              Nothing is analysed yet. The deck is saved as a draft, and until it has been analysed
              the trainer has no expertise behind the slides and will say so.
            </li>
            <li>
              A PDF carries no presenter notes. That is the one thing a PowerPoint has that survives
              nothing else, and it is why PPTX is worth supporting directly.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
