'use client';

/**
 * Setting up trainer-led sessions and batches.
 *
 * One screen for both, because a session is usually set up from a batch and the two
 * are looked after by the same person. The participant picker is searchable because a
 * group has no set size and UAT tests it with fifty.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import type { Role } from '@/lib/roster/types';
import { formatSessionTime } from '@/lib/time';
import type { Batch, TrainingSession } from '@/lib/training/types';

interface PersonOption {
  id: string;
  name: string;
  email: string;
  role: Role;
}

interface Props {
  me: { id: string; role: Role; platform: boolean };
  sessions: TrainingSession[];
  batches: Batch[];
  /** Every deck, for the titles of sessions; those that cannot be run say why. */
  decks: { id: string; title: string; unavailable?: string }[];
  people: PersonOption[];
}

const FIELD =
  'bg-charcoal text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal mt-2 w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset';
const BUTTON =
  'bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const PANEL = 'border-charcoal-line bg-charcoal-soft rounded-xl border p-5';

const STATUS_LABEL: Record<TrainingSession['status'], string> = {
  scheduled: 'Scheduled',
  open: 'In progress',
  closed: 'Closed',
};

function formatWhen(iso: string | null): string {
  if (!iso) return 'No date set';
  return formatSessionTime(iso);
}

/** Search box and checkboxes, for choosing participants out of a long list. */
function ParticipantPicker({
  people,
  chosen,
  onChange,
  idPrefix,
}: {
  people: PersonOption[];
  chosen: string[];
  onChange: (ids: string[]) => void;
  idPrefix: string;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? people.filter(
          (person) =>
            person.name.toLowerCase().includes(needle) ||
            person.email.toLowerCase().includes(needle),
        )
      : people;
  }, [people, query]);
  const toggle = (id: string) =>
    onChange(chosen.includes(id) ? chosen.filter((entry) => entry !== id) : [...chosen, id]);

  return (
    <fieldset className="mt-4 min-w-0">
      <legend className="text-sm font-semibold">
        Participants <span className="text-muted ml-2 font-normal">{chosen.length} chosen</span>
      </legend>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by name or email"
        aria-label="Search participants"
        className={FIELD}
      />
      <div className="mt-2 flex gap-3 text-xs">
        <button
          type="button"
          className="text-teal hover:underline"
          onClick={() => onChange([...new Set([...chosen, ...shown.map((person) => person.id)])])}
        >
          Choose all shown
        </button>
        <button type="button" className="text-muted hover:underline" onClick={() => onChange([])}>
          Clear
        </button>
      </div>
      <ul className="border-charcoal-line mt-2 max-h-64 overflow-y-auto rounded-md border">
        {shown.map((person) => (
          <li key={person.id} className="border-charcoal-line border-b last:border-b-0">
            <label
              htmlFor={`${idPrefix}-${person.id}`}
              className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
            >
              <input
                id={`${idPrefix}-${person.id}`}
                type="checkbox"
                checked={chosen.includes(person.id)}
                onChange={() => toggle(person.id)}
                className="accent-teal size-4 shrink-0"
              />
              <span className="text-mist">{person.name}</span>
              <span className="text-muted truncate text-xs">{person.email}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="text-muted px-3 py-2 text-sm">Nobody matches.</li>}
      </ul>
    </fieldset>
  );
}

export function SessionsBoard({ me, sessions, batches, decks, people }: Props) {
  const router = useRouter();
  const facilitatorChoice = me.role !== 'facilitator';
  // Only an administrator sets up batches and sessions; a facilitator runs theirs.
  const organiser = me.platform || me.role === 'admin';
  const facilitators = people.filter(
    (person) => person.role === 'facilitator' || person.role === 'admin',
  );
  const participants = people.filter((person) => person.role === 'trainee');
  const nameOf = (id: string | null) =>
    people.find((person) => person.id === id)?.name ?? 'Unknown';

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [deckId, setDeckId] = useState(decks.find((deck) => !deck.unavailable)?.id ?? '');
  const [sessionFacilitator, setSessionFacilitator] = useState(facilitators[0]?.id ?? '');
  const [batchId, setBatchId] = useState('');
  const [sessionPeople, setSessionPeople] = useState<string[]>([]);
  const [when, setWhen] = useState('');

  const [batchName, setBatchName] = useState('');
  const [batchFacilitator, setBatchFacilitator] = useState(facilitators[0]?.id ?? '');
  const [batchPeople, setBatchPeople] = useState<string[]>([]);

  async function send(url: string, body: unknown, method = 'POST'): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const reply = (await response.json().catch(() => ({}))) as { error?: string };
        setError(reply.error ?? 'That did not work. Try again.');
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError('The connection dropped. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createSession() {
    const done = await send('/api/training-sessions', {
      deckId,
      facilitatorId: facilitatorChoice ? sessionFacilitator : undefined,
      batchId: batchId || undefined,
      participantIds: sessionPeople,
      scheduledFor: when ? new Date(when).toISOString() : undefined,
    });
    if (done) {
      setSessionPeople([]);
      setBatchId('');
      setWhen('');
    }
  }

  async function createBatch() {
    const done = await send('/api/batches', {
      name: batchName,
      facilitatorId: facilitatorChoice ? batchFacilitator : undefined,
      participantIds: batchPeople,
    });
    if (done) {
      setBatchName('');
      setBatchPeople([]);
    }
  }

  return (
    <div className="space-y-10">
      {error && (
        <p role="alert" className="border-logo-red/40 bg-logo-red/10 rounded-md border p-3 text-sm">
          {error}
        </p>
      )}

      <section aria-labelledby="sessions-heading">
        <h2 id="sessions-heading" className="text-xl font-bold">
          Sessions
        </h2>
        {sessions.length === 0 ? (
          <p className="text-muted mt-3 text-sm">No trainer-led sessions yet.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {sessions.map((session) => (
              <li key={session.id} className={`${PANEL} flex flex-wrap items-center gap-4`}>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/sessions/${session.id}`}
                    className="text-mist hover:text-teal font-semibold"
                  >
                    {decks.find((deck) => deck.id === session.deckId)?.title ?? 'Deck removed'}
                  </Link>
                  <p className="text-muted mt-1 text-sm">
                    {formatWhen(session.scheduledFor)} &middot; {session.participantIds.length}{' '}
                    {session.participantIds.length === 1 ? 'participant' : 'participants'} &middot;{' '}
                    {nameOf(session.facilitatorId)}
                  </p>
                </div>
                <span className="text-muted text-sm">{STATUS_LABEL[session.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {organiser && (
        <section aria-labelledby="new-session-heading" className={PANEL}>
          <h2 id="new-session-heading" className="text-lg font-bold">
            Set up a session
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="session-deck" className="block text-sm font-semibold">
                Deck
              </label>
              <select
                id="session-deck"
                value={deckId}
                onChange={(event) => setDeckId(event.target.value)}
                className={FIELD}
              >
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id} disabled={Boolean(deck.unavailable)}>
                    {deck.unavailable ? `${deck.title} (${deck.unavailable})` : deck.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="session-when" className="block text-sm font-semibold">
                When <span className="text-muted ml-2 font-normal">optional</span>
              </label>
              <input
                id="session-when"
                type="datetime-local"
                value={when}
                onChange={(event) => setWhen(event.target.value)}
                className={FIELD}
              />
            </div>
            {facilitatorChoice && (
              <div>
                <label htmlFor="session-facilitator" className="block text-sm font-semibold">
                  Facilitator
                </label>
                <select
                  id="session-facilitator"
                  value={sessionFacilitator}
                  onChange={(event) => setSessionFacilitator(event.target.value)}
                  className={FIELD}
                >
                  {facilitators.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="session-batch" className="block text-sm font-semibold">
                From a batch <span className="text-muted ml-2 font-normal">optional</span>
              </label>
              <select
                id="session-batch"
                value={batchId}
                onChange={(event) => setBatchId(event.target.value)}
                className={FIELD}
              >
                <option value="">No batch</option>
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.name} ({batch.participantIds.length})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ParticipantPicker
            people={participants}
            chosen={sessionPeople}
            onChange={setSessionPeople}
            idPrefix="session-person"
          />
          <p className="text-muted mt-2 text-xs">
            Anybody in the batch is listed as well. Setting the session up assigns the deck to
            everybody listed, so they can do their own steps on their own device.
          </p>
          <button
            type="button"
            onClick={() => void createSession()}
            disabled={busy || !deckId || (sessionPeople.length === 0 && !batchId)}
            className={`${BUTTON} mt-4`}
          >
            Set up session
          </button>
        </section>
      )}

      <section aria-labelledby="batches-heading">
        <h2 id="batches-heading" className="text-xl font-bold">
          Batches
        </h2>
        {batches.length === 0 ? (
          <p className="text-muted mt-3 text-sm">No batches yet.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {batches.map((batch) => (
              <li key={batch.id} className={`${PANEL} flex flex-wrap items-center gap-4`}>
                <div className="min-w-0 flex-1">
                  <p className="text-mist font-semibold">{batch.name}</p>
                  <p className="text-muted mt-1 text-sm">
                    {batch.participantIds.length}{' '}
                    {batch.participantIds.length === 1 ? 'participant' : 'participants'} &middot;{' '}
                    {nameOf(batch.facilitatorId)}
                  </p>
                </div>
                {organiser && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void send(`/api/batches/${batch.id}`, {}, 'DELETE')}
                    className="text-muted hover:text-logo-red text-sm font-semibold"
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {organiser && (
        <section aria-labelledby="new-batch-heading" className={PANEL}>
          <h2 id="new-batch-heading" className="text-lg font-bold">
            Create a batch
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="batch-name" className="block text-sm font-semibold">
                Name
              </label>
              <input
                id="batch-name"
                value={batchName}
                onChange={(event) => setBatchName(event.target.value)}
                placeholder="For example, Chennai ops, November"
                className={FIELD}
              />
            </div>
            {facilitatorChoice && (
              <div>
                <label htmlFor="batch-facilitator" className="block text-sm font-semibold">
                  Facilitator
                </label>
                <select
                  id="batch-facilitator"
                  value={batchFacilitator}
                  onChange={(event) => setBatchFacilitator(event.target.value)}
                  className={FIELD}
                >
                  {facilitators.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <ParticipantPicker
            people={participants}
            chosen={batchPeople}
            onChange={setBatchPeople}
            idPrefix="batch-person"
          />
          <button
            type="button"
            onClick={() => void createBatch()}
            disabled={busy || !batchName.trim()}
            className={`${BUTTON} mt-4`}
          >
            Create batch
          </button>
        </section>
      )}
    </div>
  );
}
