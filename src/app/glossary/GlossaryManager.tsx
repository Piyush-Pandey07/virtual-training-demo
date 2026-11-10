'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import {
  GLOSSARY_SECTIONS,
  SECTION_LABELS,
  type GlossaryRecord,
  type GlossarySection,
} from '@/lib/glossary/types';
import {
  checkEntry,
  checkReason,
  MAX_ACRONYM,
  MAX_DEFINITION,
  MAX_EXPANSION,
  MAX_REASON,
  MAX_TERM,
} from '@/lib/glossary/validate';

/**
 * The administrator's glossary screen: search, add, change, hold and release, delete,
 * and reset to the imported file.
 *
 * Every form is checked here by the same rules the server runs, so a refusal is shown
 * before anything is sent, and the server's own refusal is shown as it worded it. After
 * each change the page is read again from the server, so what is listed is what is stored.
 */

const BUTTON =
  'bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const QUIET_BUTTON =
  'border-charcoal-line text-mist hover:border-teal hover:text-teal rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const FIELD =
  'border-charcoal-line bg-charcoal text-mist focus:border-teal mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none';

interface Draft {
  term: string;
  acronym: string;
  expansion: string;
  aliases: string;
  definition: string;
  section: GlossarySection;
}

const EMPTY: Draft = {
  term: '',
  acronym: '',
  expansion: '',
  aliases: '',
  definition: '',
  section: 'foundation',
};

function draftOf(entry: GlossaryRecord): Draft {
  return {
    term: entry.term,
    acronym: entry.acronym ?? '',
    expansion: entry.expansion ?? '',
    aliases: (entry.aliases ?? []).join(', '),
    definition: entry.definition,
    section: entry.section,
  };
}

function onDate(iso: string | undefined): string {
  if (!iso) return '';
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Sends one change, and returns the server's refusal in its own words, or null. */
async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.ok) return null;
    const answer = (await response.json().catch(() => ({}))) as { error?: string };
    return answer.error ?? 'That could not be saved. Try again.';
  } catch {
    return 'The server could not be reached. Check the connection and try again.';
  }
}

function EntryForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (entry: unknown) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof Draft) => (value: string) => setDraft({ ...draft, [key]: value });

  async function submit() {
    const checked = checkEntry(draft);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    setError(null);
    const refused = await onSubmit(checked.value);
    setBusy(false);
    if (refused) setError(refused);
    else if (!onCancel) setDraft(EMPTY);
  }

  const text = (key: keyof Draft, label: string, max: number, hint?: string) => (
    <label className="block text-sm">
      <span className="text-muted">{label}</span>
      <input
        className={FIELD}
        value={draft[key]}
        maxLength={max}
        onChange={(event) => set(key)(event.target.value)}
      />
      {hint && <span className="text-muted mt-1 block text-xs">{hint}</span>}
    </label>
  );

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {text('term', 'Term', MAX_TERM)}
      {text(
        'acronym',
        'Acronym (optional)',
        MAX_ACRONYM,
        'As written in documents, in capitals: UPS, N+1, HV/MV. Matched only as written.',
      )}
      {text('expansion', 'Expansion (optional)', MAX_EXPANSION, 'What the acronym stands for.')}
      {text(
        'aliases',
        'Other names (optional)',
        400,
        'Separated by commas. Each is matched as well as the term.',
      )}
      <label className="block text-sm sm:col-span-2">
        <span className="text-muted">Definition</span>
        <textarea
          className={`${FIELD} min-h-20`}
          value={draft.definition}
          maxLength={MAX_DEFINITION}
          onChange={(event) => set('definition')(event.target.value)}
        />
        <span className="text-muted mt-1 block text-xs">
          How Technavious defines it, in one or two sentences. The trainer puts it in its own words.
        </span>
      </label>
      <label className="block text-sm">
        <span className="text-muted">Section</span>
        <select
          className={FIELD}
          value={draft.section}
          onChange={(event) => set('section')(event.target.value)}
        >
          {GLOSSARY_SECTIONS.map((section) => (
            <option key={section} value={section}>
              {SECTION_LABELS[section]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-3">
        <button type="submit" className={BUTTON} disabled={busy}>
          {busy ? 'Saving' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className={QUIET_BUTTON} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-logo-red text-sm sm:col-span-2">
          {error}
        </p>
      )}
    </form>
  );
}

function ReasonForm({
  label,
  onSubmit,
  onCancel,
}: {
  label: string;
  onSubmit: (reason: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const checked = checkReason(reason);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    setError(null);
    const refused = await onSubmit(checked.value);
    setBusy(false);
    if (refused) setError(refused);
  }

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="block min-w-64 flex-1 text-sm">
        <span className="text-muted">Reason</span>
        <input
          className={FIELD}
          value={reason}
          maxLength={MAX_REASON}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <button type="submit" className={BUTTON} disabled={busy}>
        {busy ? 'Saving' : label}
      </button>
      <button type="button" className={QUIET_BUTTON} onClick={onCancel} disabled={busy}>
        Cancel
      </button>
      {error && (
        <p role="alert" className="text-logo-red w-full text-sm">
          {error}
        </p>
      )}
    </form>
  );
}

type Mode = 'view' | 'edit' | 'hold' | 'release' | 'delete';

function EntryRow({ entry, onChanged }: { entry: GlossaryRecord; onChanged: () => void }) {
  const [mode, setMode] = useState<Mode>('view');
  const [error, setError] = useState<string | null>(null);
  const url = `/api/glossary/${encodeURIComponent(entry.id)}`;

  const done = (refused: string | null) => {
    if (!refused) {
      setMode('view');
      onChanged();
    }
    return refused;
  };

  return (
    <li className="border-charcoal-line border-t px-5 py-4">
      {mode === 'edit' ? (
        <EntryForm
          initial={draftOf(entry)}
          submitLabel="Save changes"
          onSubmit={async (changed) =>
            done(await send(url, 'PATCH', { action: 'edit', entry: changed }))
          }
          onCancel={() => setMode('view')}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="font-semibold">
              {entry.term}
              {entry.acronym && entry.acronym !== entry.term && (
                <span className="text-teal ml-2 font-mono text-sm">{entry.acronym}</span>
              )}
              {entry.expansion && (
                <span className="text-muted ml-2 text-sm font-normal">{entry.expansion}</span>
              )}
            </h3>
            <span className="text-muted text-xs">
              {SECTION_LABELS[entry.section]}
              {entry.origin === 'administrator' ? ', added by an administrator' : ''}
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed">{entry.definition}</p>
          {entry.aliases && entry.aliases.length > 0 && (
            <p className="text-muted mt-1 text-xs">Also: {entry.aliases.join(', ')}</p>
          )}
          {entry.held && (
            <p className="border-logo-red/50 mt-2 rounded-md border px-3 py-2 text-sm">
              <span className="font-semibold">Held back from the trainer</span>
              {entry.heldAt ? ` since ${onDate(entry.heldAt)}` : ''}: {entry.held}
            </p>
          )}
          {!entry.held && entry.released && (
            <p className="text-muted mt-1 text-xs">
              Released on {onDate(entry.released.at)}: {entry.released.reason}
            </p>
          )}

          {mode === 'view' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={QUIET_BUTTON} onClick={() => setMode('edit')}>
                Edit
              </button>
              <button
                type="button"
                className={QUIET_BUTTON}
                onClick={() => setMode(entry.held ? 'release' : 'hold')}
              >
                {entry.held ? 'Release' : 'Hold'}
              </button>
              <button type="button" className={QUIET_BUTTON} onClick={() => setMode('delete')}>
                Delete
              </button>
            </div>
          )}
          {(mode === 'hold' || mode === 'release') && (
            <ReasonForm
              label={mode === 'hold' ? 'Hold it back' : 'Release it'}
              onSubmit={async (reason) => done(await send(url, 'PATCH', { action: mode, reason }))}
              onCancel={() => setMode('view')}
            />
          )}
          {mode === 'delete' && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span>
                Delete {entry.term}? The trainer stops being given it. Holding it keeps the words.
              </span>
              <button
                type="button"
                className={BUTTON}
                onClick={async () => setError(done(await send(url, 'DELETE')))}
              >
                Delete it
              </button>
              <button type="button" className={QUIET_BUTTON} onClick={() => setMode('view')}>
                Cancel
              </button>
              {error && (
                <p role="alert" className="text-logo-red w-full">
                  {error}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}

function matches(entry: GlossaryRecord, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [entry.term, entry.acronym, entry.expansion, entry.definition, ...(entry.aliases ?? [])]
    .filter((text): text is string => Boolean(text))
    .some((text) => text.toLowerCase().includes(needle));
}

export function GlossaryManager({ entries }: { entries: GlossaryRecord[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<GlossarySection | 'all'>('all');
  const [heldOnly, setHeldOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(
    () =>
      entries.filter(
        (entry) =>
          matches(entry, query.trim()) &&
          (section === 'all' || entry.section === section) &&
          (!heldOnly || Boolean(entry.held)),
      ),
    [entries, query, section, heldOnly],
  );

  const refresh = () => router.refresh();

  async function reset() {
    setBusy(true);
    setResetError(null);
    const refused = await send('/api/glossary/reset', 'POST', { confirm: 'reset' });
    setBusy(false);
    if (refused) setResetError(refused);
    else {
      setResetting(false);
      refresh();
    }
  }

  return (
    <>
      <section className="border-charcoal-line bg-charcoal-soft mt-8 rounded-xl border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Add a term</h2>
          {!adding && (
            <button type="button" className={BUTTON} onClick={() => setAdding(true)}>
              Add a term
            </button>
          )}
        </div>
        {adding && (
          <div className="mt-4">
            <EntryForm
              initial={EMPTY}
              submitLabel="Add it"
              onSubmit={async (entry) => {
                const refused = await send('/api/glossary', 'POST', { entry });
                if (!refused) {
                  setAdding(false);
                  refresh();
                }
                return refused;
              }}
            />
          </div>
        )}
      </section>

      <section className="mt-8" aria-labelledby="terms-heading">
        <div className="flex flex-wrap items-end gap-4">
          <label className="block min-w-64 flex-1 text-sm">
            <span className="text-muted">Search</span>
            <input
              type="search"
              className={FIELD}
              placeholder="A term, an acronym or a word from a definition"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Section</span>
            <select
              className={FIELD}
              value={section}
              onChange={(event) => setSection(event.target.value as GlossarySection | 'all')}
            >
              <option value="all">Every section</option>
              {GLOSSARY_SECTIONS.map((each) => (
                <option key={each} value={each}>
                  {SECTION_LABELS[each]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={heldOnly}
              onChange={(event) => setHeldOnly(event.target.checked)}
            />
            Held only
          </label>
        </div>

        <h2 id="terms-heading" className="text-muted mt-6 text-sm">
          {shown.length === entries.length
            ? `${entries.length} terms`
            : `${shown.length} of ${entries.length} terms`}
        </h2>
        {shown.length === 0 ? (
          <p className="border-charcoal-line text-muted mt-3 rounded-xl border border-dashed p-8 text-center text-sm">
            Nothing matches that search.
          </p>
        ) : (
          <ul className="border-charcoal-line bg-charcoal-soft mt-3 overflow-hidden rounded-xl border [&>li:first-child]:border-t-0">
            {shown.map((entry) => (
              <EntryRow key={`${entry.id}-${entry.updatedAt}`} entry={entry} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>

      <section className="border-charcoal-line mt-12 border-t pt-6">
        <h2 className="text-lg font-semibold">Reset to the imported file</h2>
        <p className="text-muted mt-1 max-w-3xl text-sm leading-relaxed">
          Puts the glossary back to the Benchmark team&rsquo;s file as it was imported. Every term
          added here is removed, every change is undone, and the holds are those of the file.
        </p>
        {resetting ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span>This cannot be undone. Reset the glossary?</span>
            <button type="button" className={BUTTON} onClick={() => void reset()} disabled={busy}>
              {busy ? 'Resetting' : 'Reset it'}
            </button>
            <button
              type="button"
              className={QUIET_BUTTON}
              onClick={() => setResetting(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`${QUIET_BUTTON} mt-3`}
            onClick={() => setResetting(true)}
          >
            Reset the glossary
          </button>
        )}
        {resetError && (
          <p role="alert" className="text-logo-red mt-2 text-sm">
            {resetError}
          </p>
        )}
      </section>
    </>
  );
}
