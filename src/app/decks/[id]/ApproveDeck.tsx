'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Where the deck stands with its approver, and the button that approves it (AI-39).
 *
 * Shown to every administrator who can open the deck, because the person who assigns it
 * needs to know why the assign panel below is closed. The button is offered only to the
 * approver; the server checks again either way.
 */

export type ApprovalView =
  | { state: 'approved'; by: string; at: string }
  | { state: 'changed'; by: string; at: string; reason: 'changed' | 'withdrawn' }
  | { state: 'unapproved' };

interface ApproveDeckProps {
  deckId: string;
  approval: ApprovalView;
  published: boolean;
  mayApprove: boolean;
  /** People who already have the deck, who keep it while it waits for approval. */
  assignedCount: number;
}

function onDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function describe(approval: ApprovalView): { heading: string; body: string } {
  if (approval.state === 'approved') {
    return {
      heading: `Approved by ${approval.by} on ${onDate(approval.at)}`,
      body: 'It can be assigned. Any change to what it teaches, or unpublishing it, will need a fresh approval.',
    };
  }
  if (approval.state === 'changed') {
    return {
      heading:
        approval.reason === 'withdrawn'
          ? 'Withdrawn since approval'
          : 'Changed since approval: needs approving again',
      body: `${approval.by} approved it on ${onDate(approval.at)}, and it has ${
        approval.reason === 'withdrawn' ? 'been withdrawn' : 'changed'
      } since. Nobody new can be given it until it is approved again.`,
    };
  }
  return {
    heading: 'Needs approval',
    body: 'It cannot be assigned to anybody until the deck approver has approved it.',
  };
}

export function ApproveDeck({
  deckId,
  approval,
  published,
  mayApprove,
  assignedCount,
}: ApproveDeckProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/approval`, {
        method: 'POST',
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error ?? 'That did not work.');
      }
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const { heading, body } = describe(approval);
  const approved = approval.state === 'approved';

  return (
    <section
      className={`rounded-xl border p-5 ${
        approved ? 'border-teal/40 bg-teal/10' : 'border-charcoal-line bg-charcoal-soft'
      }`}
      aria-labelledby="approval-heading"
    >
      <p className="text-muted text-xs font-semibold tracking-wide uppercase">Approval</p>
      <h2 id="approval-heading" className="mt-1 text-lg font-semibold">
        {heading}
      </h2>
      <p className="text-muted mt-2 text-sm leading-relaxed">{body}</p>

      {!approved && assignedCount > 0 && (
        <p className="mt-2 text-sm leading-relaxed">
          {assignedCount === 1 ? 'One person already has' : `${assignedCount} people already have`}{' '}
          this deck and keep it, but it needs re-approval before anybody else is given it.
        </p>
      )}

      {!approved && mayApprove && (
        <div className="mt-4">
          {published ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void approve()}
              className="bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Approving' : 'Approve this deck'}
            </button>
          ) : (
            <p className="text-muted text-sm">Publish it first, then approve it here.</p>
          )}
        </div>
      )}

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
