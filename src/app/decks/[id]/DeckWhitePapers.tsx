'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { DeckWhitePaperView } from '@/lib/white-papers/types';

/**
 * Which approved white papers this deck may draw on (AI-46).
 *
 * Technavious only, like every deck tool. Lists the papers attached, each with where it
 * stands, since an attached paper whose approval has cleared is not used until it is
 * approved again; and offers the library's approved papers to attach. Saving sends the
 * whole list, and the server checks again that each new one is approved.
 */

const QUIET_BUTTON =
  'border-charcoal-line text-mist hover:border-teal hover:text-teal rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

function stateOf(paper: DeckWhitePaperView): { label: string; used: boolean } {
  if (paper.withdrawn) return { label: 'Withdrawn: not used', used: false };
  if (paper.approval.state === 'approved') {
    return { label: `Approved, version ${paper.approval.version}: used`, used: true };
  }
  if (paper.approval.state === 'changed') {
    return { label: 'Changed since approval: not used until approved again', used: false };
  }
  return { label: 'Needs approval: not used', used: false };
}

interface DeckWhitePapersProps {
  deckId: string;
  attached: DeckWhitePaperView[];
  available: DeckWhitePaperView[];
}

export function DeckWhitePapers({ deckId, attached, available }: DeckWhitePapersProps) {
  const router = useRouter();
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(paperIds: string[]) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/white-papers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paperIds }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error ?? 'That did not work.');
      }
      setChosen('');
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ids = attached.map((paper) => paper.id);

  return (
    <section
      aria-labelledby="white-papers-heading"
      className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5"
    >
      <p className="text-muted text-xs font-semibold tracking-wide uppercase">White papers</p>
      <h2 id="white-papers-heading" className="mt-1 text-lg font-semibold">
        {attached.length === 0
          ? 'No white papers attached'
          : `${attached.length} white ${attached.length === 1 ? 'paper' : 'papers'} attached`}
      </h2>
      <p className="text-muted mt-2 text-sm leading-relaxed">
        The trainer answers from the deck, the glossary and the approved white papers attached here,
        and is given only the passages that bear on the slide and the question.
      </p>

      {attached.length > 0 && (
        <ul className="mt-4 space-y-2">
          {attached.map((paper) => {
            const state = stateOf(paper);
            return (
              <li
                key={paper.id}
                className="border-charcoal-line flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-2"
              >
                <div>
                  <Link
                    href={`/white-papers/${encodeURIComponent(paper.id)}`}
                    className="hover:text-teal font-semibold transition-colors"
                  >
                    {paper.title}
                  </Link>
                  <p className={`text-sm ${state.used ? 'text-teal' : 'text-muted'}`}>
                    {state.label}
                  </p>
                </div>
                <button
                  type="button"
                  className={QUIET_BUTTON}
                  disabled={busy}
                  onClick={() => void save(ids.filter((id) => id !== paper.id))}
                >
                  Detach
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {available.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block min-w-64 flex-1 text-sm">
            <span className="text-muted">Attach an approved white paper</span>
            <select
              className="border-charcoal-line bg-charcoal text-mist focus:border-teal mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none"
              value={chosen}
              onChange={(event) => setChosen(event.target.value)}
            >
              <option value="">Choose one</option>
              {available.map((paper) => (
                <option key={paper.id} value={paper.id}>
                  {paper.title}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={QUIET_BUTTON}
            disabled={busy || !chosen}
            onClick={() => void save([...ids, chosen])}
          >
            Attach
          </button>
        </div>
      ) : (
        <p className="text-muted mt-4 text-sm">
          No other approved white papers to attach.{' '}
          <Link href="/white-papers" className="text-teal hover:underline">
            The white paper library
          </Link>
        </p>
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
