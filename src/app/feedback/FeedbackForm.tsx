'use client';

import Link from 'next/link';
import { useState } from 'react';

import { RATING_MAX, RATING_MIN, type FeedbackQuestionSet } from '@/lib/assessments/types';

/**
 * Session feedback: a rating for each question, and an optional comment (AI-31).
 *
 * Drawn from the question set it is given rather than written out here, so Benchmark's
 * own questions replace the interim ones without touching this screen.
 */

interface FeedbackFormProps {
  deckId: string;
  sessionId: string | null;
  set: FeedbackQuestionSet;
}

const SCALE = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, index) => RATING_MIN + index);

export function FeedbackForm({ deckId, sessionId, set }: FeedbackFormProps) {
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    const missing = set.questions.findIndex(
      (question) => question.kind === 'rating' && ratings[question.id] === undefined,
    );
    if (missing >= 0) {
      setError(`Choose a rating for "${set.questions[missing]!.prompt}"`);
      document.getElementById(`feedback-${set.questions[missing]!.id}`)?.focus();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckId, sessionId, questionSetId: set.id, ratings, comments }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      // Feedback already given is done, whichever device gave it.
      if (response.ok || (response.status === 409 && /already/i.test(body.error ?? ''))) {
        setDone(true);
        window.scrollTo({ top: 0 });
        return;
      }
      setError(body.error ?? 'Your feedback could not be sent. Try again in a moment.');
    } catch {
      setError(
        'Your feedback could not be sent because the connection dropped. Try again once it is back.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="border-charcoal-line bg-charcoal-soft rounded-xl border p-6">
        <h2 className="text-xl font-semibold">Thank you</h2>
        <p className="text-muted mt-3 leading-relaxed">
          Your feedback has been sent. That is everything for this session.
        </p>
        <Link
          href="/"
          className="bg-azure text-mist hover:bg-teal hover:text-charcoal mt-5 inline-block rounded-md px-5 py-2.5 text-sm font-semibold transition-colors"
        >
          Back to your training
        </Link>
      </section>
    );
  }

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {set.questions.map((question) =>
        question.kind === 'rating' ? (
          <fieldset
            key={question.id}
            id={`feedback-${question.id}`}
            tabIndex={-1}
            className="border-charcoal-line bg-charcoal-soft min-w-0 rounded-xl border p-5"
          >
            <legend className="sr-only">{question.prompt}</legend>
            <p className="font-semibold" aria-hidden="true">
              {question.prompt}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {SCALE.map((value) => {
                const chosen = ratings[question.id] === value;
                const words =
                  value === RATING_MIN
                    ? `${value}, ${question.low}`
                    : value === RATING_MAX
                      ? `${value}, ${question.high}`
                      : String(value);
                return (
                  <label
                    key={value}
                    className={`has-focus-visible:outline-teal flex min-w-12 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 ${
                      chosen
                        ? 'border-teal bg-teal/15 text-teal'
                        : 'border-charcoal-line hover:border-muted'
                    }`}
                  >
                    <input
                      type="radio"
                      name={question.id}
                      value={value}
                      checked={chosen}
                      onChange={() =>
                        setRatings((current) => ({ ...current, [question.id]: value }))
                      }
                      className="sr-only"
                      aria-label={words}
                    />
                    <span aria-hidden="true">{value}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-muted mt-2 flex justify-between gap-4 text-xs" aria-hidden="true">
              <span>
                {RATING_MIN} is {question.low.toLowerCase()}
              </span>
              <span>
                {RATING_MAX} is {question.high.toLowerCase()}
              </span>
            </p>
          </fieldset>
        ) : (
          <div
            key={question.id}
            className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5"
          >
            <label htmlFor={`feedback-${question.id}`} className="font-semibold">
              {question.prompt}
            </label>
            <textarea
              id={`feedback-${question.id}`}
              value={comments[question.id] ?? ''}
              maxLength={question.maxLength}
              rows={4}
              onChange={(event) =>
                setComments((current) => ({ ...current, [question.id]: event.target.value }))
              }
              className="border-charcoal-line bg-charcoal focus:border-teal mt-3 w-full rounded-md border px-3 py-2 text-sm leading-relaxed outline-none"
            />
            <p className="text-muted mt-1 text-right text-xs">
              {(comments[question.id] ?? '').length} of {question.maxLength} characters
            </p>
          </div>
        ),
      )}

      <div>
        <button
          type="submit"
          disabled={busy}
          className="bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Sending' : 'Send my feedback'}
        </button>
        {error && (
          <p role="alert" className="text-logo-red mt-3 text-sm font-semibold">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
