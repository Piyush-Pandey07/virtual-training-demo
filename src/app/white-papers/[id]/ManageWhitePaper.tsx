'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { readPaperPdf, sendPaper } from '@/lib/white-papers/send';
import {
  MAX_WHITE_PAPER_SUMMARY,
  MAX_WHITE_PAPER_TITLE,
  type WhitePaperApprovalView,
  type WhitePaperSummaryView,
} from '@/lib/white-papers/types';

/**
 * Everything that can be done to one white paper (AI-46): approve it, rename it or change
 * its summary, replace its PDF with a new version, withdraw it or put it back, delete it.
 *
 * The approve button is offered only to the approver; the server checks again either
 * way. Each action says what it costs: anything that changes what the trainer is given,
 * or withdrawing the paper, means approving it again.
 */

const BUTTON =
  'bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const QUIET_BUTTON =
  'border-charcoal-line text-mist hover:border-teal hover:text-teal rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const FIELD =
  'border-charcoal-line bg-charcoal text-mist focus:border-teal mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none';

function onDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function describe(
  approval: WhitePaperApprovalView,
  withdrawn: boolean,
): { heading: string; body: string } {
  if (withdrawn) {
    return {
      heading: 'Withdrawn',
      body: 'No deck draws on it. Putting it back in use means approving it again.',
    };
  }
  if (approval.state === 'approved') {
    return {
      heading: `Approved by ${approval.by} on ${onDate(approval.at)}`,
      body: `Version ${approval.version} is approved, and the decks it is attached to draw on it. A new PDF, a new title or withdrawing it will need a fresh approval.`,
    };
  }
  if (approval.state === 'changed') {
    return {
      heading:
        approval.reason === 'withdrawn'
          ? 'Withdrawn since approval: needs approving again'
          : 'Changed since approval: needs approving again',
      body: `${approval.by} approved version ${approval.version} on ${onDate(approval.at)}. No deck draws on it until it is approved again.`,
    };
  }
  return {
    heading: 'Needs approval',
    body: 'No deck draws on it until the deck approver has approved it.',
  };
}

interface ManageWhitePaperProps {
  paper: WhitePaperSummaryView;
  mayApprove: boolean;
}

export function ManageWhitePaper({ paper, mayApprove }: ManageWhitePaperProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [title, setTitle] = useState(paper.title);
  const [summary, setSummary] = useState(paper.summary);
  const [file, setFile] = useState<File | null>(null);

  const base = `/api/white-papers/${encodeURIComponent(paper.id)}`;

  async function act(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      await work();
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message || 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  async function send(url: string, method: string, body?: unknown) {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(result.error ?? 'That did not work.');
    }
  }

  const withdrawn = paper.status === 'withdrawn';
  const approved = !withdrawn && paper.approval.state === 'approved';
  const { heading, body } = describe(paper.approval, withdrawn);
  const renaming = title.trim() !== paper.title;

  return (
    <div className="space-y-6">
      <section
        className={`rounded-xl border p-5 ${
          approved ? 'border-teal/40 bg-teal/10' : 'border-charcoal-line bg-charcoal-soft'
        }`}
        aria-labelledby="paper-approval-heading"
      >
        <p className="text-muted text-xs font-semibold tracking-wide uppercase">Approval</p>
        <h2 id="paper-approval-heading" className="mt-1 text-lg font-semibold">
          {heading}
        </h2>
        <p className="text-muted mt-2 text-sm leading-relaxed">{body}</p>
        {!approved && !withdrawn && mayApprove && (
          <button
            type="button"
            className={`${BUTTON} mt-4`}
            disabled={busy !== null}
            onClick={() => void act('Approving', () => send(`${base}/approval`, 'POST'))}
          >
            {busy === 'Approving' ? 'Approving' : `Approve version ${paper.version}`}
          </button>
        )}
      </section>

      <section
        aria-labelledby="paper-details-heading"
        className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5"
      >
        <h2 id="paper-details-heading" className="text-lg font-semibold">
          Title and summary
        </h2>
        <div className="mt-3 grid gap-4">
          <label className="block text-sm">
            <span className="text-muted">Title</span>
            <input
              className={FIELD}
              value={title}
              maxLength={MAX_WHITE_PAPER_TITLE}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Summary</span>
            <textarea
              className={`${FIELD} min-h-20`}
              value={summary}
              maxLength={MAX_WHITE_PAPER_SUMMARY}
              onChange={(event) => setSummary(event.target.value)}
            />
          </label>
        </div>
        {renaming && paper.approval.state === 'approved' && (
          <p className="text-muted mt-2 text-sm">
            The title heads the paper&apos;s passages in what the trainer is given, so a new title
            needs approving again. The summary does not.
          </p>
        )}
        <button
          type="button"
          className={`${QUIET_BUTTON} mt-3`}
          disabled={busy !== null || (!renaming && summary === paper.summary)}
          onClick={() =>
            void act('Saving', () => send(base, 'PATCH', { action: 'edit', title, summary }))
          }
        >
          {busy === 'Saving' ? 'Saving' : 'Save'}
        </button>
      </section>

      <section
        aria-labelledby="paper-replace-heading"
        className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5"
      >
        <h2 id="paper-replace-heading" className="text-lg font-semibold">
          Replace the PDF
        </h2>
        <p className="text-muted mt-1 text-sm">
          Its text becomes version {paper.version + 1}, which needs approving before any deck draws
          on it again. The decks it is attached to keep it attached.
        </p>
        <input
          type="file"
          accept="application/pdf,.pdf"
          className={FIELD}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          className={`${QUIET_BUTTON} mt-3`}
          disabled={!file || busy !== null}
          onClick={() =>
            void act('Replacing', async () => {
              const read = await readPaperPdf(file!);
              const { originalNote } = await sendPaper(file!, {
                url: base,
                method: 'PATCH',
                body: { action: 'replace', fileName: file!.name, pages: read.pages },
              });
              if (originalNote) setNote(originalNote);
            })
          }
        >
          {busy === 'Replacing' ? 'Replacing' : 'Replace'}
        </button>
      </section>

      <section
        aria-labelledby="paper-use-heading"
        className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5"
      >
        <h2 id="paper-use-heading" className="text-lg font-semibold">
          {withdrawn ? 'Put it back in use' : 'Withdraw or delete'}
        </h2>
        <p className="text-muted mt-1 text-sm">
          {withdrawn
            ? 'It stays attached to its decks, and is used again once it is approved again.'
            : 'Withdrawing stops every deck drawing on it and keeps it here. Deleting removes it, its text and its original, and takes it off every deck.'}
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            className={QUIET_BUTTON}
            disabled={busy !== null}
            onClick={() =>
              void act('Updating', () =>
                send(base, 'PATCH', { action: withdrawn ? 'reinstate' : 'withdraw' }),
              )
            }
          >
            {withdrawn ? 'Put back in use' : 'Withdraw'}
          </button>
          <button
            type="button"
            className={QUIET_BUTTON}
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm(`Delete "${paper.title}"? This cannot be undone.`)) return;
              setBusy('Deleting');
              setError(null);
              send(base, 'DELETE')
                .then(() => router.push('/white-papers'))
                .catch((cause: Error) => {
                  setError(cause.message);
                  setBusy(null);
                });
            }}
          >
            {busy === 'Deleting' ? 'Deleting' : 'Delete'}
          </button>
        </div>
      </section>

      {note && (
        <p role="status" className="border-charcoal-line rounded-md border p-3 text-sm">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="border-logo-red/40 bg-logo-red/10 rounded-md border p-3 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
