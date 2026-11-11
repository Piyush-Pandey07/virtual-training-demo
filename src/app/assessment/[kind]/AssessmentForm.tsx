'use client';

import { useState } from 'react';

import type { AssessmentPaper, ResultSummary } from '@/lib/assessments/types';
import { ResultCard, type NextLink } from './ResultCard';

/**
 * Taking an assessment: every question on one page, one choice each, then submit once.
 *
 * No timer, as AI-29 asks. The submit button stays available rather than greying out
 * until everything is answered, because a disabled button cannot say why; pressing it
 * early instead names the first question still to answer and moves to it.
 *
 * The paper this is given has no answers in it. The server marks what is sent.
 */

interface AssessmentFormProps {
  paper: AssessmentPaper;
  sessionId: string | null;
  /** Where to go once it is submitted. */
  next: NextLink | null;
  waiting: string | null;
}

export function AssessmentForm({ paper, sessionId, next, waiting }: AssessmentFormProps) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultSummary | null>(null);

  const answered = paper.questions.filter((question) => answers[question.id] !== undefined).length;

  async function submit() {
    const missing = paper.questions.findIndex((question) => answers[question.id] === undefined);
    if (missing >= 0) {
      setError(`Question ${missing + 1} has not been answered yet.`);
      document.getElementById(`question-${paper.questions[missing]!.id}`)?.focus();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckId: paper.deckId,
          kind: paper.kind,
          version: paper.version,
          answers,
          sessionId,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        result?: ResultSummary;
        error?: string;
      };
      // A second attempt is refused with the first result, which is what should be shown.
      if (body.result) {
        setResult(body.result);
        window.scrollTo({ top: 0 });
        return;
      }
      setError(body.error ?? 'Your answers could not be sent. Try again in a moment.');
    } catch {
      setError(
        'Your answers could not be sent because the connection dropped. Try again once it is back.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (result) return <ResultCard result={result} next={next} waiting={waiting} />;

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
    >
      <ol className="space-y-6">
        {paper.questions.map((question, index) => (
          <li key={question.id}>
            <fieldset
              id={`question-${question.id}`}
              tabIndex={-1}
              className="border-charcoal-line bg-charcoal-soft min-w-0 rounded-xl border p-5"
            >
              <legend className="sr-only">
                Question {index + 1} of {paper.questions.length}
              </legend>
              <p className="text-muted text-sm font-semibold" aria-hidden="true">
                Question {index + 1} of {paper.questions.length}
              </p>
              <p className="mt-2 text-lg leading-relaxed font-semibold">{question.question}</p>
              <div className="mt-4 space-y-2">
                {question.options.map((option, optionIndex) => {
                  const chosen = answers[question.id] === optionIndex;
                  return (
                    <label
                      key={optionIndex}
                      className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors ${
                        chosen
                          ? 'border-teal bg-teal/10'
                          : 'border-charcoal-line hover:border-muted'
                      }`}
                    >
                      <input
                        type="radio"
                        name={question.id}
                        value={optionIndex}
                        checked={chosen}
                        onChange={() =>
                          setAnswers((current) => ({ ...current, [question.id]: optionIndex }))
                        }
                        className="accent-teal mt-1 shrink-0"
                      />
                      <span className="leading-relaxed">{option}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>

      <div className="border-charcoal-line bg-charcoal-soft sticky bottom-0 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted text-sm" aria-live="polite">
            {answered} of {paper.questions.length} answered
          </p>
          <button
            type="submit"
            disabled={busy}
            className="bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Sending' : 'Submit my answers'}
          </button>
        </div>
        {error && (
          <p role="alert" className="text-logo-red mt-3 text-sm font-semibold">
            {error}
          </p>
        )}
        <p className="text-muted mt-2 text-xs">
          You can take this once. Check your answers before you submit.
        </p>
      </div>
    </form>
  );
}
