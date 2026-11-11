'use client';

/**
 * The deck's lesson plan, on its page (AI-43): what it is, how it lines up with the
 * slides, where they differ, and the way to upload, check, change or remove it.
 *
 * Reading a plan in saves nothing. The administrator is shown what was read, sections and
 * outcomes, as a form, with the slides each section matched and any gaps, and saves it
 * only once it is right. That matters most for a plan the model read, which is a guess
 * until somebody has looked at it.
 *
 * The Benchmark administrator's alone, as the rest of the deck tools are: the page shows
 * this only to them, and the route checks again.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { LessonPlanGaps } from '@/components/LessonPlanGaps';
import { LESSON_PLAN_ACCEPT, lessonPlanFileText } from '@/lib/lesson-plan/extract';
import {
  describeGap,
  LESSON_PLAN_LIMITS,
  type LessonPlanAlignment,
  type LessonPlanDraft,
} from '@/lib/lesson-plan/types';
import type { LessonPlanView } from '@/lib/lesson-plan/view';

interface Props {
  deckId: string;
  plan: LessonPlanView | null;
  slides: { id: number; title: string }[];
}

/** A section as the form holds it: everything as typed, checked when it is saved. */
interface SectionForm {
  title: string;
  minutes: string;
  objective: string;
  slides: string;
}

interface Form {
  title: string;
  sourceName?: string;
  sections: SectionForm[];
  outcomes: string;
}

const SAMPLE = '/samples/lesson-plan-data-centre.txt';
const SAMPLE_WITH_GAP = '/samples/lesson-plan-data-centre-with-gap.txt';

const INPUT =
  'bg-charcoal-soft text-mist ring-charcoal-line focus:ring-teal mt-1 w-full rounded-md px-3 py-2 text-sm ring-1 ring-inset';
const PRIMARY =
  'bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY =
  'border-charcoal-line text-mist hover:border-teal rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

function spanOf(ids: readonly number[]): string {
  if (ids.length === 0) return '';
  const runs: string[] = [];
  let start = ids[0];
  let previous = ids[0];
  for (const id of [...ids.slice(1), Number.NaN]) {
    if (id === previous + 1) {
      previous = id;
      continue;
    }
    runs.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = id;
    previous = id;
  }
  return runs.join(', ');
}

function formFrom(draft: LessonPlanDraft | LessonPlanView): Form {
  return {
    title: draft.title ?? '',
    sourceName: draft.sourceName,
    sections: draft.sections.map((section) => ({
      title: section.title,
      minutes: section.minutes ? String(section.minutes) : '',
      objective: section.objective ?? '',
      slides: section.slides ? spanOf(section.slides) : '',
    })),
    outcomes: draft.outcomes.join('\n'),
  };
}

function onDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function LessonPlan({ deckId, plan, slides }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [preview, setPreview] = useState<LessonPlanAlignment | null>(null);
  const [readVia, setReadVia] = useState<'outline' | 'model' | null>(null);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState<'reading' | 'saving' | 'removing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const titleOf = (id: number) => slides.find((slide) => slide.id === id)?.title ?? `Slide ${id}`;
  const base = `/api/decks/${encodeURIComponent(deckId)}/lesson-plan`;

  async function readIn(text: string, fileName?: string) {
    setBusy('reading');
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, fileName }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        draft?: LessonPlanDraft;
        via?: 'outline' | 'model';
        alignment?: LessonPlanAlignment;
        error?: string;
      };
      if (!response.ok || !body.draft) throw new Error(body.error ?? 'That did not work.');
      setForm(formFrom(body.draft));
      setPreview(body.alignment ?? null);
      setReadVia(body.via ?? null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function readFile(file: File) {
    setError(null);
    try {
      const text = await lessonPlanFileText(file);
      if (!text.trim()) throw new Error('No text could be read from that file.');
      await readIn(text, file.name);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function save() {
    if (!form) return;
    setBusy('saving');
    setError(null);
    try {
      const response = await fetch(base, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: {
            title: form.title,
            sourceName: form.sourceName,
            sections: form.sections.map((section) => ({
              title: section.title,
              minutes: section.minutes.trim() ? Number(section.minutes) : undefined,
              objective: section.objective,
              slides: section.slides,
            })),
            outcomes: form.outcomes.split('\n'),
          },
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        problems?: string[];
      };
      if (!response.ok) {
        throw new Error([body.error, ...(body.problems ?? [])].filter(Boolean).join(' '));
      }
      setForm(null);
      setPreview(null);
      setPasted('');
      setMessage(
        'Lesson plan saved. If the deck was approved, it needs approving again before anybody new is given it.',
      );
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (
      !window.confirm('Remove the lesson plan from this deck? Nova will teach from the deck alone.')
    ) {
      return;
    }
    setBusy('removing');
    setError(null);
    try {
      const response = await fetch(base, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'That did not work.');
      }
      setMessage('Lesson plan removed.');
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const editSection = (index: number, patch: Partial<SectionForm>) =>
    setForm((current) =>
      current
        ? {
            ...current,
            sections: current.sections.map((section, at) =>
              at === index ? { ...section, ...patch } : section,
            ),
          }
        : current,
    );

  const moveSection = (index: number, by: -1 | 1) =>
    setForm((current) => {
      if (!current) return current;
      const sections = [...current.sections];
      const target = index + by;
      if (target < 0 || target >= sections.length) return current;
      [sections[index], sections[target]] = [sections[target], sections[index]];
      return { ...current, sections };
    });

  return (
    <section
      aria-labelledby="lesson-plan-heading"
      className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5"
    >
      <p className="text-muted text-xs font-semibold tracking-wide uppercase">Lesson plan</p>
      <h2 id="lesson-plan-heading" className="mt-1 text-lg font-semibold">
        {plan ? (plan.title ?? 'The lesson plan for this deck') : 'No lesson plan yet'}
      </h2>
      <p className="text-muted mt-2 text-sm leading-relaxed">
        {plan
          ? `${plan.sections.length} sections${plan.sourceName ? `, from ${plan.sourceName}` : ''}, saved ${onDate(plan.updatedAt)}. Nova teaches each slide towards its section's objective and time, and follows the deck wherever the two differ.`
          : 'Upload the session flow and learning outcomes, and Nova will teach each slide towards its section of the plan. Word, PDF, text or CSV, or paste it in.'}{' '}
        <a href={SAMPLE} download className="text-teal hover:underline">
          Download the sample lesson plan
        </a>{' '}
        or{' '}
        <a href={SAMPLE_WITH_GAP} download className="text-teal hover:underline">
          the sample with a deliberate gap
        </a>
        .
      </p>

      {plan && !form && (
        <>
          <ol className="mt-4 space-y-2">
            {plan.sections.map((section, index) => (
              <li key={`${index}-${section.title}`} className="text-sm">
                <p className="font-semibold">
                  <span className="text-muted mr-2 tabular-nums">{index + 1}</span>
                  {section.title}
                  {section.minutes ? (
                    <span className="text-muted ml-2 font-normal">{section.minutes} min</span>
                  ) : null}
                </p>
                {section.objective && <p className="text-muted mt-0.5">{section.objective}</p>}
                <p className="text-muted mt-0.5 text-xs">
                  {section.matched.length > 0
                    ? `Slides ${spanOf(section.matched)}: ${section.matched.map(titleOf).join('; ')}${section.slides ? ' (set by hand)' : ''}`
                    : 'No slide in this deck'}
                </p>
              </li>
            ))}
          </ol>
          {plan.outcomes.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-semibold">Learning outcomes</h3>
              <ul className="text-muted mt-1 list-inside list-disc space-y-0.5 text-sm">
                {plan.outcomes.map((outcome) => (
                  <li key={outcome}>{outcome}</li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-4">
            <LessonPlanGaps gaps={plan.gaps} audience="administrator" />
            {plan.gaps.length === 0 && (
              <p className="text-teal text-sm">
                Every section of the plan has its slides, in order.
              </p>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className={SECONDARY} onClick={() => setForm(formFrom(plan))}>
              Edit the plan
            </button>
            <button
              type="button"
              className={SECONDARY}
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              {busy === 'removing' ? 'Removing' : 'Remove the plan'}
            </button>
          </div>
        </>
      )}

      {!form && (
        <div className="mt-5 space-y-3">
          <div>
            <label htmlFor="lesson-plan-file" className="block text-sm font-semibold">
              {plan ? 'Replace it with a file' : 'Upload a lesson plan'}
            </label>
            <input
              id="lesson-plan-file"
              type="file"
              accept={LESSON_PLAN_ACCEPT}
              disabled={busy !== null}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void readFile(file);
              }}
              className="text-muted mt-1 block text-sm"
            />
          </div>
          <div>
            <label htmlFor="lesson-plan-paste" className="block text-sm font-semibold">
              Or paste it
            </label>
            <textarea
              id="lesson-plan-paste"
              rows={5}
              value={pasted}
              maxLength={LESSON_PLAN_LIMITS.textChars}
              onChange={(event) => setPasted(event.target.value)}
              placeholder={
                'Session flow\n1. Introduction (5 min)\n   Objective: ...\n\nLearning outcomes\n- ...'
              }
              className={`${INPUT} resize-y font-mono`}
            />
            <button
              type="button"
              className={`${PRIMARY} mt-2`}
              disabled={busy !== null || !pasted.trim()}
              onClick={() => void readIn(pasted)}
            >
              {busy === 'reading' ? 'Reading' : 'Read it'}
            </button>
          </div>
        </div>
      )}

      {form && (
        <div className="mt-5 space-y-4">
          <p className="text-sm leading-relaxed">
            {readVia === 'model'
              ? 'This plan was not laid out as the sample is, so it was read by the model. Check every section, time and objective before saving.'
              : 'Check what was read, correct anything that is wrong, then save. Nothing is used until it is saved.'}
          </p>
          {preview && preview.gaps.length > 0 && (
            <LessonPlanGaps
              gaps={preview.gaps.map((gap) => describeGap(gap))}
              audience="administrator"
              compact
            />
          )}
          <div>
            <label htmlFor="lesson-plan-title" className="block text-sm font-semibold">
              Name of the plan <span className="text-muted font-normal">optional</span>
            </label>
            <input
              id="lesson-plan-title"
              value={form.title}
              maxLength={LESSON_PLAN_LIMITS.titleChars}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              className={INPUT}
            />
          </div>

          <ol className="space-y-3">
            {form.sections.map((section, index) => (
              <li
                key={index}
                className="border-charcoal-line rounded-lg border p-3"
                aria-label={`Section ${index + 1}`}
              >
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_8rem]">
                  <label className="text-muted text-xs font-semibold">
                    Section {index + 1}
                    <input
                      value={section.title}
                      maxLength={LESSON_PLAN_LIMITS.titleChars}
                      onChange={(event) => editSection(index, { title: event.target.value })}
                      className={INPUT}
                    />
                  </label>
                  <label className="text-muted text-xs font-semibold">
                    Minutes
                    <input
                      inputMode="numeric"
                      value={section.minutes}
                      onChange={(event) => editSection(index, { minutes: event.target.value })}
                      className={INPUT}
                    />
                  </label>
                  <label className="text-muted text-xs font-semibold">
                    Slides <span className="font-normal">if not matched</span>
                    <input
                      value={section.slides}
                      placeholder="e.g. 4-5"
                      onChange={(event) => editSection(index, { slides: event.target.value })}
                      className={INPUT}
                    />
                  </label>
                </div>
                <label className="text-muted mt-2 block text-xs font-semibold">
                  Objective
                  <textarea
                    rows={2}
                    value={section.objective}
                    maxLength={LESSON_PLAN_LIMITS.objectiveChars}
                    onChange={(event) => editSection(index, { objective: event.target.value })}
                    className={`${INPUT} resize-y`}
                  />
                </label>
                {preview && preview.sections.length === form.sections.length && (
                  <p className="text-muted mt-1 text-xs">
                    {preview.sections[index].slides.length > 0
                      ? `Matched slides ${spanOf(preview.sections[index].slides)}`
                      : 'Matched no slide'}
                  </p>
                )}
                <div className="mt-2 flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-muted hover:text-teal"
                    onClick={() => moveSection(index, -1)}
                    disabled={index === 0}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="text-muted hover:text-teal"
                    onClick={() => moveSection(index, 1)}
                    disabled={index === form.sections.length - 1}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    className="text-muted hover:text-logo-red"
                    onClick={() => {
                      setPreview(null);
                      setForm({
                        ...form,
                        sections: form.sections.filter((_, at) => at !== index),
                      });
                    }}
                  >
                    Remove section
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className={SECONDARY}
            disabled={form.sections.length >= LESSON_PLAN_LIMITS.sections}
            onClick={() => {
              setPreview(null);
              setForm({
                ...form,
                sections: [...form.sections, { title: '', minutes: '', objective: '', slides: '' }],
              });
            }}
          >
            Add a section
          </button>

          <div>
            <label htmlFor="lesson-plan-outcomes" className="block text-sm font-semibold">
              Learning outcomes <span className="text-muted font-normal">one per line</span>
            </label>
            <textarea
              id="lesson-plan-outcomes"
              rows={5}
              value={form.outcomes}
              onChange={(event) => setForm({ ...form, outcomes: event.target.value })}
              className={`${INPUT} resize-y`}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={PRIMARY}
              disabled={busy !== null}
              onClick={() => void save()}
            >
              {busy === 'saving' ? 'Saving' : 'Save the lesson plan'}
            </button>
            <button
              type="button"
              className={SECONDARY}
              disabled={busy !== null}
              onClick={() => {
                setForm(null);
                setPreview(null);
              }}
            >
              Cancel
            </button>
          </div>
          <p className="text-muted text-xs leading-relaxed">
            Saving changes what this deck teaches, so an approved deck will need approving again
            before anybody new is given it.
          </p>
        </div>
      )}

      {message && <p className="text-teal mt-4 text-sm">{message}</p>}
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
