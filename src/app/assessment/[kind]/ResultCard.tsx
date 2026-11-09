import Link from 'next/link';

import { LEVEL_LABELS, type ResultSummary } from '@/lib/assessments/types';

/**
 * A participant's own result, as they see it straight after submitting and whenever they
 * come back to the page.
 *
 * The score and what it means, and nothing about which questions were right: that would
 * hand the answer key to the next person in the room.
 */

export interface NextLink {
  href: string;
  label: string;
}

function onDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function ResultCard({
  result,
  next,
  waiting,
}: {
  result: ResultSummary;
  /** Where to go from here, when there is somewhere. */
  next?: NextLink | null;
  /** What to say instead of a link, such as waiting for a facilitator. */
  waiting?: string | null;
}) {
  const score = `${result.correct} out of ${result.total} (${result.percent}%)`;
  const date = onDate(result.submittedAt);

  return (
    <section
      className="border-charcoal-line bg-charcoal-soft rounded-xl border p-6"
      aria-labelledby="result-heading"
    >
      {result.kind === 'pre' ? (
        <>
          <h2 id="result-heading" className="text-xl font-semibold">
            Your starting level: {result.level ? LEVEL_LABELS[result.level] : 'recorded'}
          </h2>
          <p className="text-muted mt-3 leading-relaxed">
            You scored {score}. This is a check of what you already know, not a test you can fail,
            and it is recorded so the session can be pitched at the right level for you.
          </p>
        </>
      ) : (
        <>
          <p
            className={`inline-block rounded-md px-3 py-1 text-sm font-bold ${
              result.passed ? 'bg-teal/15 text-teal' : 'bg-logo-red/15 text-logo-red'
            }`}
          >
            {result.passed ? 'Pass' : 'Fail'}
          </p>
          <h2 id="result-heading" className="mt-3 text-xl font-semibold">
            You scored {score}
          </h2>
          <p className="text-muted mt-3 leading-relaxed">
            {result.passed
              ? `Well done. The pass mark is ${result.passMark ?? 70}%, and you reached it.`
              : `The pass mark is ${result.passMark ?? 70}%, so this is recorded as not passed. Your facilitator or administrator can see this result and will tell you what happens next.`}
          </p>
        </>
      )}

      <p className="text-muted mt-3 text-sm">
        Each assessment can be taken once, so this result is final
        {date ? `. Submitted ${date}.` : '.'}
      </p>

      {next ? (
        <Link
          href={next.href}
          className="bg-azure text-mist hover:bg-teal hover:text-charcoal mt-5 inline-block rounded-md px-5 py-2.5 text-sm font-semibold transition-colors"
        >
          {next.label}
        </Link>
      ) : waiting ? (
        <p className="mt-5 text-sm leading-relaxed">{waiting}</p>
      ) : (
        <Link href="/" className="text-teal mt-5 inline-block text-sm hover:underline">
          Back to your training
        </Link>
      )}
    </section>
  );
}
