'use client';

/**
 * Uploading a deck.
 *
 * The reading and rendering happen here rather than on the server, so this screen
 * is where the work is visible. It matters that it is visible: a 60-page deck takes
 * the better part of a minute, and a spinner for a minute reads as broken.
 *
 * The order is deliberate. The text pass runs first and is fast, the deck is created
 * from it, and only then does the slow page-by-page rendering start. That way the
 * progress bar counts against a real total from the first second, and if rendering
 * fails halfway there is still a deck holding everything that did work.
 */

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';

import { extractSpeakerNotes, isPowerPoint } from '@/lib/pptx/notes';

import { pageAssetName } from '@/lib/decks/asset-paths';
import { readOutline, renderPage } from '@/lib/pdf/render';

interface Progress {
  phase: 'reading' | 'creating' | 'rendering' | 'done';
  pagesTotal: number;
  pagesDone: number;
  bytesUploaded: number;
  /** Data URL of the most recent render, so the trainer can see it is working. */
  preview?: string;
}

interface Finished {
  deckId: string;
  title: string;
  pages: number;
  bytes: number;
  failures: string[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadDeck() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (file: File, powerPoint?: File) => {
    setError(null);
    setFinished(null);
    setProgress({ phase: 'reading', pagesTotal: 0, pagesDone: 0, bytesUploaded: 0 });

    let previewUrl: string | undefined;

    try {
      // --- pass one: text and page sizes -------------------------------
      const { outline, doc, close } = await readOutline(file);

      // --- the notes, if a PowerPoint came with it ---------------------
      //
      // Read here rather than uploaded: the PowerPoint never leaves this machine,
      // which is the same promise the PDF already makes. Only the notes go, and
      // they go straight into internalNotes, which the trainer never says aloud
      // until somebody has read them and moved them across.
      const notes = powerPoint
        ? extractSpeakerNotes(await powerPoint.arrayBuffer())
        : new Map<number, string[]>();

      const pages = outline.pages.map((page) => ({
        ...page,
        notes: notes.get(page.pageNumber),
      }));

      setProgress({
        phase: 'creating',
        pagesTotal: outline.pageCount,
        pagesDone: 0,
        bytesUploaded: 0,
      });

      // --- create the deck from the outline ----------------------------
      const created = await fetch('/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          documentTitle: outline.documentTitle,
          pages,
        }),
      });

      const createdBody = (await created.json()) as {
        deck?: { id: string; title: string };
        error?: string;
      };
      if (!created.ok || !createdBody.deck) {
        throw new Error(createdBody.error ?? 'The deck could not be created.');
      }

      const deckId = createdBody.deck.id;
      const failures: string[] = [];
      let bytesUploaded = 0;

      // --- pass two: render and upload, one page at a time -------------
      for (const page of outline.pages) {
        setProgress({
          phase: 'rendering',
          pagesTotal: outline.pageCount,
          pagesDone: page.pageNumber - 1,
          bytesUploaded,
          preview: previewUrl,
        });

        try {
          const rendered = await renderPage(doc, page.pageNumber);

          for (const [variant, blob] of [
            ['full', rendered.full],
            ['thumb', rendered.thumb],
          ] as const) {
            const name = pageAssetName(page.pageNumber, variant);
            const response = await fetch(`/api/decks/${deckId}/assets/${name}`, {
              method: 'PUT',
              headers: { 'Content-Type': blob.type || 'image/webp' },
              body: blob,
            });
            if (!response.ok) {
              const body = (await response.json().catch(() => ({}))) as { error?: string };
              throw new Error(body.error ?? `Upload failed with ${response.status}.`);
            }
            bytesUploaded += blob.size;
          }

          // Replacing the preview each time, and revoking the previous one: sixty
          // object URLs held open is sixty full-resolution bitmaps kept alive.
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          previewUrl = URL.createObjectURL(rendered.full);
        } catch (pageError) {
          failures.push(`Page ${page.pageNumber}: ${(pageError as Error).message}`);
        }
      }

      setProgress({
        phase: 'done',
        pagesTotal: outline.pageCount,
        pagesDone: outline.pageCount,
        bytesUploaded,
        preview: previewUrl,
      });

      setFinished({
        deckId,
        title: createdBody.deck.title,
        pages: outline.pageCount,
        bytes: bytesUploaded,
        failures,
      });

      await close();
    } catch (caught) {
      setError((caught as Error).message);
      setProgress(null);
    }
  }, []);

  const busy = progress !== null && progress.phase !== 'done';
  const percent =
    progress && progress.pagesTotal > 0
      ? Math.round((progress.pagesDone / progress.pagesTotal) * 100)
      : 0;

  return (
    <div>
      <label
        htmlFor="deck-file"
        className={`border-charcoal-line bg-charcoal-soft block cursor-pointer rounded-xl border border-dashed p-8 text-center transition-colors ${
          busy ? 'cursor-not-allowed opacity-60' : 'hover:border-teal'
        }`}
      >
        <p className="font-semibold">Choose a PDF</p>
        <p className="text-muted mt-1 text-sm">
          Add the PowerPoint alongside it and the speaker notes come too. Both are read in your
          browser; only the rendered pages and the notes are uploaded.
        </p>
        <input
          ref={inputRef}
          id="deck-file"
          type="file"
          multiple
          accept="application/pdf,.pdf,.pptx"
          disabled={busy}
          className="sr-only"
          onChange={(event) => {
            const chosen = [...(event.target.files ?? [])];
            // Cleared so choosing the same file twice fires a change event again.
            event.target.value = '';
            if (chosen.length === 0) return;

            // The PDF carries the slides. Nothing in a browser renders PowerPoint, so
            // a PowerPoint on its own has notes and no pictures, and saying so beats
            // starting an upload that cannot finish.
            const pdf = chosen.find((entry) => /\.pdf$/i.test(entry.name));
            const pptx = chosen.find((entry) => isPowerPoint(entry.name));

            if (!pdf) {
              setError(
                pptx
                  ? 'A PDF is needed as well: the slide images come from it. Export the PowerPoint to PDF and choose both together.'
                  : 'Choose a PDF.',
              );
              return;
            }

            void upload(pdf, pptx);
          }}
        />
      </label>

      {error && (
        <div
          role="alert"
          className="border-logo-red/40 bg-logo-red/10 mt-6 rounded-md border p-4 text-sm"
        >
          <p className="font-semibold">That did not work.</p>
          <p className="text-muted mt-1">{error}</p>
        </div>
      )}

      {progress && (
        <div className="border-charcoal-line bg-charcoal-soft mt-6 rounded-xl border p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold">
              {progress.phase === 'reading' && 'Reading the PDF'}
              {progress.phase === 'creating' && 'Creating the deck'}
              {progress.phase === 'rendering' && 'Rendering pages'}
              {progress.phase === 'done' && 'Finished'}
            </p>
            <p className="text-muted text-xs tabular-nums">
              {progress.pagesTotal > 0 && `${progress.pagesDone} / ${progress.pagesTotal} pages`}
              {progress.bytesUploaded > 0 && ` · ${formatBytes(progress.bytesUploaded)} uploaded`}
            </p>
          </div>

          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="bg-charcoal-line mt-3 h-1.5 overflow-hidden rounded-full"
          >
            <div
              className="bg-azure h-full rounded-full transition-all duration-200"
              style={{ width: `${progress.phase === 'reading' ? 4 : percent}%` }}
            />
          </div>

          {progress.preview && (
            // Deliberately a plain img: the source is an object URL for a blob that
            // exists only in this tab, which next/image cannot optimise.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={progress.preview}
              alt="Most recently rendered page"
              className="border-charcoal-line mt-4 w-full rounded-md border bg-white"
            />
          )}
        </div>
      )}

      {finished && (
        <div className="border-teal/40 bg-teal/5 mt-6 rounded-xl border p-5">
          <p className="font-semibold">{finished.title}</p>
          <p className="text-muted mt-1 text-sm">
            {finished.pages} pages, {formatBytes(finished.bytes)} of renders. Saved as a draft: it
            has no expertise behind it until it is analysed, so the trainer can only work from what
            is printed on the slides.
          </p>

          {finished.failures.length > 0 && (
            <div className="border-logo-red/40 bg-logo-red/10 mt-4 rounded-md border p-3 text-sm">
              <p className="font-semibold">
                {finished.failures.length} page
                {finished.failures.length === 1 ? '' : 's'} did not render
              </p>
              <ul className="text-muted mt-1 list-inside list-disc">
                {finished.failures.slice(0, 5).map((failure) => (
                  <li key={failure}>{failure}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={`/session?deck=${encodeURIComponent(finished.deckId)}`}
              className="bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2 text-sm font-semibold transition-colors"
            >
              Preview the session
            </Link>
            <Link
              href="/decks"
              className="border-charcoal-line text-muted hover:text-mist rounded-md border px-4 py-2 text-sm font-semibold transition-colors"
            >
              Back to the library
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
