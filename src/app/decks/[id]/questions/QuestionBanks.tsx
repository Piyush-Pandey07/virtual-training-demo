'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  CSV_TEMPLATE,
  CSV_TEMPLATE_FILENAME,
  parseBankCsv,
  type ParsedBank,
} from '@/lib/assessments/csv';
import { bandsOf, describeBands } from '@/lib/assessments/scoring';
import {
  BANK_KIND_LABELS,
  MAX_OPTIONS,
  PASS_MARK,
  SAMPLE_LABEL,
  type BankKind,
  type BankVersionSummary,
  type LevelBands,
  type QuestionBank,
} from '@/lib/assessments/types';
import { LevelBandsForm } from '@/components/LevelBandsForm';
import { describeFailure, readFailure } from '@/lib/failures/codes';

/**
 * The administrator's question banks for one deck: upload, preview, sample generation,
 * and the pre-session level bands.
 *
 * An upload is parsed here, by the same parser the server uses, and shown in full before
 * anything is saved: every question, its options, which one is marked correct, and every
 * problem with the row it is on. A file with any problem cannot be saved, so the preview
 * is never a promise the save then breaks.
 */

const BUTTON =
  'bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const QUIET_BUTTON =
  'border-charcoal-line text-mist hover:border-teal hover:text-teal rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`;

function onDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function letter(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index);
}

function QuestionList({
  questions,
}: {
  questions: Pick<QuestionBank['questions'][number], 'question' | 'options' | 'correctIndex'>[];
}) {
  return (
    <ol className="space-y-4">
      {questions.map((question, index) => (
        <li key={index} className="border-charcoal-line rounded-md border p-4">
          <p className="font-semibold">
            {index + 1}. {question.question}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {question.options.map((option, optionIndex) => (
              <li
                key={optionIndex}
                className={
                  optionIndex === question.correctIndex ? 'text-teal font-semibold' : 'text-muted'
                }
              >
                {letter(optionIndex)}. {option}
                {optionIndex === question.correctIndex && <span> (correct)</span>}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function BandsEditor({ deckId, bank }: { deckId: string; bank: QuestionBank }) {
  const router = useRouter();
  const current = bandsOf(bank);

  async function save(bands: LevelBands): Promise<string | null> {
    const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/questions/pre`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bands }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) return body.error ?? 'The bands could not be saved.';
    router.refresh();
    return null;
  }

  return (
    <div className="border-charcoal-line mt-6 border-t pt-5">
      <h3 className="font-semibold">Level bands</h3>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        Where a participant&rsquo;s pre-session score places them. {describeBands(current)} A
        trainer-led session starts with these, and its facilitator can change them for that session.
      </p>
      <div className="mt-4">
        <LevelBandsForm
          current={current}
          onSave={save}
          savedText="Saved. Results already given keep the level they were given."
        />
      </div>
    </div>
  );
}

/** The versions kept of a bank, newest first, each with the results taken on it. */
function VersionHistory({ versions }: { versions: BankVersionSummary[] }) {
  if (versions.length < 2) return null;
  return (
    <details className="mt-3">
      <summary className="hover:text-teal cursor-pointer text-sm">
        {versions.length} versions kept. Every result is marked against the version it was taken on.
      </summary>
      <ul className="text-muted mt-2 space-y-1 text-sm">
        {[...versions].reverse().map((each) => (
          <li key={each.version}>
            Version {each.versionNumber}: {each.questions}{' '}
            {each.questions === 1 ? 'question' : 'questions'},{' '}
            {each.source === 'upload' ? 'uploaded' : 'sample'} {onDate(each.savedAt)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function BankPanel({
  deckId,
  kind,
  bank,
  versions,
}: {
  deckId: string;
  kind: BankKind;
  bank: QuestionBank | null;
  versions: BankVersionSummary[];
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<{ name: string; text: string; parsed: ParsedBank } | null>(
    null,
  );
  const [busy, setBusy] = useState<'save' | 'sample' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<ParsedBank['problems']>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // Remounts the file input after a save or cancel, so choosing the same file again still
  // fires a change.
  const [inputKey, setInputKey] = useState(0);

  const base = `/api/decks/${encodeURIComponent(deckId)}/questions/${kind}`;
  const uploaded = bank?.source === 'upload';

  async function choose(file: File | undefined) {
    setError(null);
    setNotice(null);
    setProblems([]);
    if (!file) return;
    const text = await file.text();
    setPreview({ name: file.name, text, parsed: parseBankCsv(text) });
  }

  function reset() {
    setPreview(null);
    setInputKey((key) => key + 1);
  }

  async function save() {
    if (!preview) return;
    setBusy('save');
    setError(null);
    try {
      const response = await fetch(base, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: preview.text }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        problems?: ParsedBank['problems'];
        questions?: number;
      };
      if (!response.ok) {
        setProblems(body.problems ?? []);
        throw new Error(body.error ?? 'The bank could not be saved.');
      }
      setNotice(`Saved ${body.questions} questions.`);
      reset();
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    if (
      bank &&
      !window.confirm('This replaces the current sample questions with new ones. Carry on?')
    )
      return;
    setBusy('sample');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${base}/sample`, { method: 'POST' });
      if (!response.ok) throw new Error(describeFailure(await readFailure(response)));
      const body = (await response.json()) as { questions: number };
      setNotice(
        `Generated ${body.questions} sample questions. Read them before anybody takes them.`,
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof TypeError
          ? 'The request did not reach the server. Check the connection and try again.'
          : (cause as Error).message,
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (
      !window.confirm(
        `Remove the ${BANK_KIND_LABELS[kind].toLowerCase()} for this deck? Results already given are kept.`,
      )
    ) {
      return;
    }
    setBusy('remove');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(base, { method: 'DELETE' });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'The bank could not be removed.');
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const headingId = `bank-${kind}`;

  return (
    <section
      aria-labelledby={headingId}
      className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-lg font-semibold">
            {BANK_KIND_LABELS[kind]}
          </h2>
          <p className="text-muted mt-1 text-sm">
            {kind === 'pre'
              ? 'Taken before the session. Nobody fails it: it only places each participant at Beginner, Intermediate or Advanced, and must be completed before they can start.'
              : `Taken straight after the session. A single pass mark, ${PASS_MARK}% or above, and no level bands. Each participant has one attempt.`}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${
            !bank
              ? 'bg-charcoal-line text-muted'
              : uploaded
                ? 'bg-teal/15 text-teal'
                : 'bg-logo-red/15 text-logo-red'
          }`}
        >
          {!bank ? 'No bank yet' : uploaded ? 'Uploaded' : SAMPLE_LABEL}
        </span>
      </div>

      {bank && (
        <details className="mt-4">
          <summary className="hover:text-teal cursor-pointer text-sm font-semibold">
            {bank.versionNumber ? `Version ${bank.versionNumber}: ` : ''}
            {bank.questions.length} {bank.questions.length === 1 ? 'question' : 'questions'}, saved{' '}
            {onDate(bank.savedAt)}. Show them with their answers.
          </summary>
          <div className="mt-4">
            <QuestionList questions={bank.questions} />
          </div>
        </details>
      )}
      <VersionHistory versions={versions} />

      <div className="border-charcoal-line mt-5 border-t pt-5">
        <h3 className="font-semibold">{bank ? 'Replace with a CSV' : 'Upload a CSV'}</h3>
        <p className="text-muted mt-1 text-sm leading-relaxed">
          One question per row: the question, two to {MAX_OPTIONS} options, and which option is
          correct as a number (1 to {MAX_OPTIONS}) or a letter (A to F).{' '}
          <a
            href={TEMPLATE_HREF}
            download={CSV_TEMPLATE_FILENAME}
            className="text-teal hover:underline"
          >
            Download the template
          </a>
          .
        </p>
        <label className="mt-3 block text-sm">
          <span className="sr-only">CSV file for the {BANK_KIND_LABELS[kind].toLowerCase()}</span>
          <input
            key={inputKey}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void choose(event.target.files?.[0])}
            className="file:border-charcoal-line file:text-mist hover:file:border-teal text-muted text-sm file:mr-3 file:rounded-md file:border file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-semibold"
          />
        </label>

        {preview && (
          <div className="mt-5">
            <h4 className="text-sm font-semibold">
              Preview of {preview.name}: {preview.parsed.questions.length}{' '}
              {preview.parsed.questions.length === 1 ? 'question' : 'questions'} read
            </h4>
            {preview.parsed.problems.length > 0 ? (
              <div role="alert" className="border-logo-red/50 mt-3 rounded-md border p-4 text-sm">
                <p className="text-logo-red font-semibold">
                  This file cannot be saved until these are fixed. Nothing has been changed.
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {preview.parsed.problems.map((problem, index) => (
                    <li key={index}>
                      Row {problem.row}: {problem.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-muted mt-2 text-sm">
                Check each question and its marked answer.
                {bank
                  ? ` Saving makes this the new version. The ${bank.questions.length} questions there now are kept, with the results taken on them.`
                  : ''}
              </p>
            )}
            {preview.parsed.questions.length > 0 && (
              <div className="scroll-slim mt-4 max-h-96 overflow-y-auto pr-2">
                <QuestionList questions={preview.parsed.questions} />
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className={BUTTON}
                disabled={busy !== null || preview.parsed.problems.length > 0}
                onClick={() => void save()}
              >
                {busy === 'save' ? 'Saving' : 'Save this bank'}
              </button>
              <button
                type="button"
                className={QUIET_BUTTON}
                disabled={busy !== null}
                onClick={reset}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-charcoal-line mt-5 border-t pt-5">
        <h3 className="font-semibold">Sample questions</h3>
        <p className="text-muted mt-1 text-sm leading-relaxed">
          {uploaded
            ? 'This deck has an uploaded bank, so a sample is not offered. Remove the uploaded bank first if you really want one.'
            : `Until the real bank arrives, generate about ten questions from the deck to try the assessment out. They are labelled "${SAMPLE_LABEL}" everywhere, and their answers have not been checked.`}
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          {!uploaded && (
            <button
              type="button"
              className={QUIET_BUTTON}
              disabled={busy !== null}
              onClick={() => void generate()}
            >
              {busy === 'sample'
                ? 'Generating, this takes up to a minute'
                : bank
                  ? 'Generate a new sample'
                  : 'Generate a sample'}
            </button>
          )}
          {bank && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void remove()}
              className="text-muted hover:text-logo-red text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {busy === 'remove' ? 'Removing' : 'Remove this bank'}
            </button>
          )}
        </div>
      </div>

      {(error || notice) && (
        <div className="mt-4 text-sm" aria-live="polite">
          {error && (
            <div role="alert" className="text-logo-red font-semibold">
              <p>{error}</p>
              {problems.length > 0 && (
                <ul className="mt-2 list-disc pl-5 font-normal">
                  {problems.map((problem, index) => (
                    <li key={index}>
                      Row {problem.row}: {problem.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {notice && <p className="text-teal">{notice}</p>}
        </div>
      )}

      {kind === 'pre' && bank && <BandsEditor deckId={deckId} bank={bank} />}
    </section>
  );
}

export function QuestionBanks({
  deckId,
  banks,
  versions,
}: {
  deckId: string;
  banks: Record<BankKind, QuestionBank | null>;
  versions: Record<BankKind, BankVersionSummary[]>;
}) {
  return (
    <div className="space-y-8">
      <BankPanel deckId={deckId} kind="pre" bank={banks.pre} versions={versions.pre} />
      <BankPanel deckId={deckId} kind="post" bank={banks.post} versions={versions.post} />
    </div>
  );
}
