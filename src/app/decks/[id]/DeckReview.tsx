'use client';

/**
 * Reviewing a deck before anyone is taught from it.
 *
 * This screen is the safeguard, not a convenience. Everything the analysis produced
 * is a guess that reads like a fact, and several of these fields are spliced into
 * the trainer's own sentences and spoken to a trainee: `owner` becomes "the deck is
 * the authority on ___ policy". A trainer who cannot correct that has no way to stop
 * the session asserting something false about their own organisation.
 *
 * So every generated field is editable here, the publish gate says plainly what is
 * missing, and the analysis can be re-run.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import { pageAssetName } from '@/lib/decks/asset-paths';
import type { DeckMeta, SlideRole } from '@/lib/deck-types';

/** What the server sends down: enough to review, without the trainer's material. */
export interface ReviewSlide {
  id: number;
  title: string;
  shortLabel: string;
  summary: string;
  role?: SlideRole;
  teaches: boolean;
  targetSeconds: number;
  printedTitle?: string;
  bulletCount: number;
  narrationBrief: string;
  keyPoints: string[];
  discussionPrompts: string[];
  /** The brief opens as a description of the page rather than as instructions. */
  briefLooksLikeSummary: boolean;
  width?: number;
  height?: number;
}

export interface ReviewDeck {
  id: string;
  status: 'draft' | 'published';
  readOnly: boolean;
  /** True for a deck a person wrote. Analysis is refused on those. */
  authored: boolean;
  meta: DeckMeta;
  slides: ReviewSlide[];
  blocking: string[];
  analysed: boolean;
}

const META_LABELS: Array<{ field: keyof DeckMeta; label: string; hint: string }> = [
  { field: 'title', label: 'Title', hint: 'Shown on the page and in the browser tab.' },
  { field: 'subtitle', label: 'Subtitle', hint: 'One line under the title.' },
  {
    field: 'spokenSubject',
    label: 'Spoken subject',
    hint: 'Said out loud in the opening welcome, so write it the way a person says it.',
  },
  {
    field: 'owner',
    label: 'Organisation',
    hint: 'Spoken as "the deck is the authority on ___ policy". Left general unless the deck named one.',
  },
  {
    field: 'ownerDescription',
    label: 'What they do',
    hint: "Spoken once, in the trainer's introduction.",
  },
  { field: 'trainerRole', label: 'Trainer role', hint: 'How the trainer introduces themselves.' },
  {
    field: 'practitionerCredential',
    label: 'Why they are credible',
    hint: 'Kept general on purpose. A named certification here would be an invented claim.',
  },
  {
    field: 'exampleDomain',
    label: 'Things the audience recognises',
    hint: "Used to ground examples in the trainee's own work.",
  },
  { field: 'exampleContext', label: 'Their working world', hint: 'For "an example from ___".' },
  {
    field: 'closingReminder',
    label: 'Closing reminder',
    hint: 'The one practical thing the last turn reminds them of.',
  },
];

const ROLE_OPTIONS: Array<{ value: SlideRole; label: string; hint: string }> = [
  { value: 'title', label: 'Cover', hint: 'Teaches nothing. Questions never land here.' },
  { value: 'content', label: 'Content', hint: 'Ordinary teaching material.' },
  { value: 'divider', label: 'Divider', hint: 'A section marker. Worth a sentence.' },
  { value: 'closing', label: 'Closing', hint: 'A final recap or thank-you.' },
];

interface Progress {
  step: number;
  total: number;
  label: string;
}

export function DeckReview({ initial }: { initial: ReviewDeck }) {
  const router = useRouter();
  const [meta, setMeta] = useState(initial.meta);
  const [slides, setSlides] = useState(initial.slides);
  const [status, setStatus] = useState(initial.status);
  const [blocking, setBlocking] = useState(initial.blocking);
  const [analysed, setAnalysed] = useState(initial.analysed);

  const [progress, setProgress] = useState<Progress | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const busy = progress !== null || saving;

  const editMeta = useCallback((field: keyof DeckMeta, value: string) => {
    setMeta((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setMessage(null);
  }, []);

  const editSlide = useCallback((id: number, patch: Partial<ReviewSlide>) => {
    setSlides((current) =>
      current.map((slide) => (slide.id === id ? { ...slide, ...patch } : slide)),
    );
    setDirty(true);
    setMessage(null);
  }, []);

  /** Sends the edits, and optionally a status change, in one request. */
  const save = useCallback(
    async (nextStatus?: 'draft' | 'published') => {
      setSaving(true);
      setError(null);
      setMessage(null);

      try {
        const response = await fetch(`/api/decks/${initial.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meta,
            slides: slides.map((slide) => ({
              id: slide.id,
              title: slide.title,
              shortLabel: slide.shortLabel,
              summary: slide.summary,
              role: slide.role,
              targetSeconds: slide.targetSeconds,
              narrationBrief: slide.narrationBrief,
              keyPoints: slide.keyPoints,
              discussionPrompts: slide.discussionPrompts,
            })),
            ...(nextStatus ? { status: nextStatus } : {}),
          }),
        });

        const body = (await response.json()) as {
          blocking?: string[];
          error?: string;
          problems?: string[];
        };

        if (!response.ok) {
          if (body.blocking) setBlocking(body.blocking);
          throw new Error([body.error, ...(body.problems ?? [])].filter(Boolean).join(' '));
        }

        setBlocking(body.blocking ?? []);
        if (nextStatus) setStatus(nextStatus);
        setDirty(false);
        setMessage(nextStatus === 'published' ? 'Published.' : 'Saved.');

        // The badge above this component, the page title and the tab all come from
        // the server, which does not know anything just changed. Without this the
        // button says "Unpublish" beside a heading still reading "Draft deck", and
        // the only way to find out which one is telling the truth is to reload.
        // `refresh` rather than a full reload: the edits are saved, so re-rendering
        // the server half is enough and the page does not jump back to the top.
        router.refresh();
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [initial.id, meta, slides, router],
  );

  /**
   * Runs the outline pass to completion, one step per request.
   *
   * The loop lives here rather than on the server because a whole deck does not fit
   * inside one function timeout, and because a trainer watching six steps go past
   * knows it is working.
   */
  const analyse = useCallback(async () => {
    setError(null);
    setMessage(null);
    setProgress({ step: 0, total: 1, label: 'Reading the deck' });

    try {
      let step = 0;
      let total = 1;

      for (;;) {
        const response = await fetch(`/api/decks/${initial.id}/analyse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step }),
        });

        const body = (await response.json()) as {
          step: number;
          totalSteps: number;
          done: boolean;
          label: string;
          error?: string;
        };

        if (!response.ok) throw new Error(body.error ?? `Analysis failed at step ${step}.`);

        total = body.totalSteps;
        setProgress({ step: body.step + 1, total, label: body.label });

        if (body.done) break;
        step += 1;
      }

      setMessage('Analysis finished. Everything below is a suggestion: read it before publishing.');
      setAnalysed(true);
      // Reloading rather than merging a response: the analysis rewrote most of the
      // deck, and reconciling that against unsaved edits in the browser is a good
      // way to show the trainer a mixture of both.
      window.location.reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setProgress(null);
    }
  }, [initial.id]);

  const ownerIsGeneric = useMemo(
    () => /^your organisation$/i.test(meta.owner.trim()),
    [meta.owner],
  );

  if (initial.readOnly) {
    return (
      <div className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5 text-sm">
        <p className="font-semibold">This deck is built in and cannot be edited.</p>
        <p className="text-muted mt-1">
          It lives in the build rather than in storage, so any change here would be lost on the next
          deploy. Upload a copy if you want to change it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ---------------------------------------------------------- actions */}
      <div className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5">
        <div className="flex flex-wrap items-center gap-3">
          {!initial.authored && (
            <button
              type="button"
              onClick={() => void analyse()}
              disabled={busy}
              className="bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analysed ? 'Analyse again' : 'Analyse this deck'}
            </button>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !dirty}
            className="border-charcoal-line text-mist hover:border-teal rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving' : 'Save changes'}
          </button>

          {status === 'draft' ? (
            <button
              type="button"
              onClick={() => void save('published')}
              disabled={busy || blocking.length > 0}
              title={blocking.length > 0 ? 'Not ready to publish yet' : undefined}
              className="bg-teal text-charcoal hover:bg-teal/80 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              Publish
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void save('draft')}
              disabled={busy}
              className="border-charcoal-line text-muted hover:text-mist rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              Unpublish
            </button>
          )}

          <Link
            href={`/session?deck=${encodeURIComponent(initial.id)}`}
            className="text-muted hover:text-teal ml-auto text-sm transition-colors"
          >
            Preview the session
          </Link>
        </div>

        {progress && (
          <div className="mt-4">
            <p className="text-muted text-sm">
              {progress.label} · step {progress.step} of {progress.total}
            </p>
            <div className="bg-charcoal-line mt-2 h-1.5 overflow-hidden rounded-full">
              <div
                className="bg-azure h-full rounded-full transition-all"
                style={{ width: `${Math.round((progress.step / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {message && <p className="text-teal mt-4 text-sm">{message}</p>}
        {error && (
          <p role="alert" className="text-logo-red mt-4 text-sm">
            {error}
          </p>
        )}
      </div>

      {initial.authored && (
        <div className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5 text-sm">
          <p className="font-semibold">This deck was written by hand.</p>
          <p className="text-muted mt-1 leading-relaxed">
            Its wording and its standard references have been checked by a person, so it is not
            offered for analysis: generated text would be a downgrade. You can still edit it here.
            Upload a copy if you want to see what the analysis makes of it.
          </p>
        </div>
      )}

      {/* ------------------------------------------------- publish readiness */}
      {blocking.length > 0 && (
        <div className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5">
          <p className="text-sm font-semibold">
            Not ready to publish yet
            <span className="text-muted ml-2 font-normal">
              {blocking.length} thing{blocking.length === 1 ? '' : 's'} outstanding
            </span>
          </p>
          <ul className="text-muted mt-2 list-inside list-disc space-y-1 text-sm">
            {blocking.slice(0, 8).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <p className="text-muted mt-3 text-xs leading-relaxed">
            A deck can be uploaded, described and previewed before it has any expertise behind it.
            Until it does, the trainer can only work from what is printed on the slides, and it says
            so rather than pretending otherwise.
          </p>
        </div>
      )}

      {/* -------------------------------------------------------------- meta */}
      <section>
        <h2 className="text-lg font-semibold">What this deck is</h2>
        <p className="text-muted mt-1 text-sm">
          Every one of these is spoken aloud at some point. Read them as though you were about to
          say them.
        </p>

        {ownerIsGeneric && (
          <p className="border-charcoal-line text-muted mt-4 rounded-md border border-dashed p-3 text-xs leading-relaxed">
            The deck never names an organisation, so this was left general on purpose rather than
            guessed at. Fill it in if you want the trainer to name yours.
          </p>
        )}

        <div className="mt-4 space-y-4">
          {META_LABELS.map(({ field, label, hint }) => (
            <div key={field}>
              <label htmlFor={`meta-${field}`} className="block text-sm font-semibold">
                {label}
              </label>
              <p className="text-muted mt-0.5 text-xs">{hint}</p>
              <textarea
                id={`meta-${field}`}
                value={String(meta[field] ?? '')}
                onChange={(event) => editMeta(field, event.target.value)}
                rows={field === 'exampleDomain' || field === 'practitionerCredential' ? 2 : 1}
                className="bg-charcoal-soft text-mist ring-charcoal-line focus:ring-teal mt-1.5 w-full resize-y rounded-md px-3 py-2 text-sm ring-1 ring-inset"
              />
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ slides */}
      <section>
        <h2 className="text-lg font-semibold">
          The slides
          <span className="text-muted ml-2 text-sm font-normal">{slides.length} pages</span>
        </h2>

        <ul className="mt-4 space-y-4">
          {slides.map((slide) => (
            <li
              key={slide.id}
              className="border-charcoal-line bg-charcoal-soft grid gap-4 rounded-xl border p-4 sm:grid-cols-[200px_minmax(0,1fr)]"
            >
              <div>
                <Image
                  src={`/api/decks/${initial.id}/assets/${pageAssetName(slide.id, 'thumb')}`}
                  alt={`Page ${slide.id}`}
                  width={slide.width ?? 768}
                  height={slide.height ?? 432}
                  unoptimized
                  className="border-charcoal-line w-full rounded-md border bg-white"
                />
                <p className="text-muted mt-2 text-xs tabular-nums">
                  Page {slide.id} · {slide.bulletCount} lines of text
                </p>
                {slide.printedTitle && (
                  <p className="text-muted mt-1 text-xs">
                    Largest text: <span className="text-mist">{slide.printedTitle}</span>
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <label
                    htmlFor={`title-${slide.id}`}
                    className="text-muted block text-xs font-semibold"
                  >
                    Title
                  </label>
                  <input
                    id={`title-${slide.id}`}
                    value={slide.title}
                    onChange={(event) => editSlide(slide.id, { title: event.target.value })}
                    className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-1 w-full rounded-md px-3 py-2 text-sm font-semibold ring-1 ring-inset"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`label-${slide.id}`}
                      className="text-muted block text-xs font-semibold"
                    >
                      Rail label
                    </label>
                    <input
                      id={`label-${slide.id}`}
                      value={slide.shortLabel}
                      maxLength={24}
                      onChange={(event) => editSlide(slide.id, { shortLabel: event.target.value })}
                      className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-1 w-full rounded-md px-3 py-2 text-sm ring-1 ring-inset"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`role-${slide.id}`}
                      className="text-muted block text-xs font-semibold"
                    >
                      What this page is
                    </label>
                    <select
                      id={`role-${slide.id}`}
                      value={slide.role ?? 'content'}
                      onChange={(event) =>
                        editSlide(slide.id, {
                          role: event.target.value as SlideRole,
                          teaches: event.target.value !== 'title',
                        })
                      }
                      className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-1 w-full rounded-md px-3 py-2 text-sm ring-1 ring-inset"
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor={`summary-${slide.id}`}
                    className="text-muted block text-xs font-semibold"
                  >
                    Summary
                  </label>
                  <textarea
                    id={`summary-${slide.id}`}
                    value={slide.summary}
                    rows={2}
                    onChange={(event) => editSlide(slide.id, { summary: event.target.value })}
                    className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-1 w-full resize-y rounded-md px-3 py-2 text-sm ring-1 ring-inset"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`brief-${slide.id}`}
                    className="text-muted block text-xs font-semibold"
                  >
                    How to teach it
                    <span className="ml-2 font-normal">
                      not spoken; the trainer works from this
                    </span>
                  </label>
                  <textarea
                    id={`brief-${slide.id}`}
                    value={slide.narrationBrief}
                    rows={3}
                    onChange={(event) =>
                      editSlide(slide.id, { narrationBrief: event.target.value })
                    }
                    className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-1 w-full resize-y rounded-md px-3 py-2 text-sm ring-1 ring-inset"
                  />
                  {slide.briefLooksLikeSummary && (
                    <p className="text-muted mt-1 text-xs">
                      This reads as a description of the page rather than instructions for teaching
                      it. The trainer already has the summary above.
                    </p>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`points-${slide.id}`}
                      className="text-muted block text-xs font-semibold"
                    >
                      Must cover
                      <span className="ml-2 font-normal">one per line</span>
                    </label>
                    <textarea
                      id={`points-${slide.id}`}
                      value={slide.keyPoints.join('\n')}
                      rows={4}
                      onChange={(event) =>
                        editSlide(slide.id, {
                          keyPoints: event.target.value.split('\n'),
                        })
                      }
                      className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-1 w-full resize-y rounded-md px-3 py-2 text-xs ring-1 ring-inset"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`prompts-${slide.id}`}
                      className="text-muted block text-xs font-semibold"
                    >
                      Ways to open a conversation
                      <span className="ml-2 font-normal">one per line</span>
                    </label>
                    <textarea
                      id={`prompts-${slide.id}`}
                      value={slide.discussionPrompts.join('\n')}
                      rows={4}
                      onChange={(event) =>
                        editSlide(slide.id, {
                          discussionPrompts: event.target.value.split('\n'),
                        })
                      }
                      className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal mt-1 w-full resize-y rounded-md px-3 py-2 text-xs ring-1 ring-inset"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <label
                    htmlFor={`seconds-${slide.id}`}
                    className="text-muted text-xs font-semibold"
                  >
                    Time to spend
                  </label>
                  <input
                    id={`seconds-${slide.id}`}
                    type="range"
                    min={15}
                    max={300}
                    step={5}
                    value={slide.targetSeconds}
                    onChange={(event) =>
                      editSlide(slide.id, { targetSeconds: Number(event.target.value) })
                    }
                    className="accent-azure max-w-[220px] flex-1"
                  />
                  <span className="text-mist text-xs tabular-nums">
                    {slide.targetSeconds}s
                    <span className="text-muted ml-1">
                      ≈ {Math.round((slide.targetSeconds / 60) * 150)} words
                    </span>
                  </span>
                  {!slide.teaches && (
                    <span className="bg-charcoal-line text-muted rounded px-2 py-0.5 text-xs">
                      questions never land here
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
