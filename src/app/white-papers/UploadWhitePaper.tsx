'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { readPaperPdf, sendPaper } from '@/lib/white-papers/send';
import { MAX_WHITE_PAPER_SUMMARY, MAX_WHITE_PAPER_TITLE } from '@/lib/white-papers/types';

/**
 * Adding a white paper to the library (AI-46): a PDF, a title and an optional summary.
 *
 * The PDF is read here, in the browser, and its text is sent page by page; the original
 * follows when it is small enough to keep. Afterwards the paper's own page opens, where
 * it is read, approved and, once approved, offered to the decks.
 */

const BUTTON =
  'bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const FIELD =
  'border-charcoal-line bg-charcoal text-mist focus:border-teal mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none';

export function UploadWhitePaper() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setError(null);
    try {
      setBusy('Reading the PDF');
      const read = await readPaperPdf(file);
      const chosenTitle =
        title.trim() || read.documentTitle?.trim() || file.name.replace(/\.pdf$/i, '');
      setBusy('Saving the text');
      // Whether the original was kept is shown on the paper's own page, from the record,
      // so the note about it is not needed here.
      const { paper } = await sendPaper(file, {
        url: '/api/white-papers',
        method: 'POST',
        body: {
          title: chosenTitle.slice(0, MAX_WHITE_PAPER_TITLE),
          summary,
          fileName: file.name,
          pages: read.pages,
        },
      });
      router.push(`/white-papers/${encodeURIComponent(paper.id)}`);
    } catch (cause) {
      setError((cause as Error).message || 'That did not work.');
      setBusy(null);
    }
  }

  return (
    <section
      aria-labelledby="upload-heading"
      className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5"
    >
      <h2 id="upload-heading" className="text-lg font-semibold">
        Upload a white paper
      </h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        A PDF with selectable text. It starts unapproved, and no deck draws on it until the deck
        approver has approved it and it is attached to the deck.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">PDF</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            className={FIELD}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">Title (taken from the PDF when left empty)</span>
          <input
            className={FIELD}
            value={title}
            maxLength={MAX_WHITE_PAPER_TITLE}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">Summary (optional, for the people choosing it)</span>
          <textarea
            className={`${FIELD} min-h-20`}
            value={summary}
            maxLength={MAX_WHITE_PAPER_SUMMARY}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          className={BUTTON}
          disabled={!file || busy !== null}
          onClick={() => void upload()}
        >
          {busy ?? 'Upload'}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="border-logo-red/40 bg-logo-red/10 mt-4 rounded-md border p-3 text-sm"
        >
          {error}
        </p>
      )}
    </section>
  );
}
