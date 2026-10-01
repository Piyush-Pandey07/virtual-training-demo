'use client';

/**
 * Deleting a deck, for good.
 *
 * The server could always do this, through DELETE /api/decks/[id], which unassigns
 * everybody first, then removes the slide images, then the record. Nothing on screen
 * ever called it, so an administrator had no way to remove a deck at all; that came to
 * light when one was asked to.
 *
 * Two steps, because it cannot be undone: the original PDF is never stored, so a deleted
 * deck comes back only by being uploaded and analysed again. The second step says what
 * will go, including the people who will have it taken off their list, since the
 * administrator deleting a deck is often not the one who assigned it.
 *
 * Not offered for a read-only deck, which the server refuses to remove anyway. The
 * example deck is read-only only when the app runs with no storage; in a customer's
 * library it is an ordinary copy, which they are allowed to delete.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface DeleteDeckProps {
  deckId: string;
  title: string;
  /** How many people have it assigned, said before they lose it. */
  assignedCount: number;
}

function people(count: number): string {
  return count === 1 ? '1 person' : `${count} people`;
}

export function DeleteDeck({ deckId, title, assignedCount }: DeleteDeckProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `The deck could not be deleted (${response.status}).`);
      }
      router.push('/decks');
      router.refresh();
    } catch (caught) {
      // The server leaves the deck in place when anything fails part-way, and says so.
      setError((caught as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="border-logo-red/30 rounded-xl border p-5">
      <h2 className="text-lg font-semibold">Delete this deck</h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        Removes the deck and its slide images for good. It comes back only by uploading and
        analysing it again.
      </p>

      {confirming ? (
        <div role="alertdialog" aria-labelledby="delete-deck-confirm" className="mt-4">
          <p id="delete-deck-confirm" className="text-mist text-sm leading-relaxed">
            <span className="font-semibold">Delete &ldquo;{title}&rdquo;?</span> This cannot be
            undone.{' '}
            {assignedCount > 0
              ? `${people(assignedCount)} assigned it will have it taken off their list.`
              : 'Nobody has it assigned.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="bg-logo-red text-mist hover:bg-logo-red/80 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? 'Deleting' : 'Yes, delete it'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="text-muted hover:text-mist ring-charcoal-line rounded-md px-4 py-2 text-sm font-semibold ring-1 transition-colors ring-inset disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-logo-red ring-logo-red/40 hover:bg-logo-red/10 mt-4 rounded-md px-4 py-2 text-sm font-semibold ring-1 transition-colors ring-inset"
        >
          Delete deck
        </button>
      )}

      {error && (
        <p role="alert" className="text-logo-red mt-3 text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
