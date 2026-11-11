/**
 * What a trainee sees when they sign in.
 *
 * Their assigned training and nothing else: no library, no upload, no other person's
 * anything. Those pages return 404 for a trainee rather than 403, so this is not
 * merely the absence of links.
 *
 * Ordered by what to do next — unfinished first, soonest due first — because a list
 * of mandatory training is a queue rather than a catalogue.
 */

import Link from 'next/link';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { ProgressBar } from '@/components/ProgressBar';
import { COMPLETION_THRESHOLD } from '@/lib/roster/completion';
import type { ProgressRow, SignedInPerson } from '@/lib/roster/types';
import { TRAINER_NAME } from '@/lib/trainer';
import type { JourneyStep, SessionJourney } from '@/lib/training/journey';

function formatDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'unknown';
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function dueLabel(
  dueAt: string | null,
  completed: boolean,
): { text: string; late: boolean } | null {
  if (!dueAt || completed) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  const late = due.getTime() < Date.now();
  return { text: `${late ? 'Was due' : 'Due'} ${formatDate(dueAt)}`, late };
}

function TrainingCard({ row }: { row: ProgressRow }) {
  const complete = row.completedAt !== null;
  const started = row.startedAt !== null && row.percent > 0;
  const due = dueLabel(row.dueAt, complete);

  return (
    <li className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">
            {row.deckTitle ?? 'A deck that no longer exists'}
          </h3>
          <p className="text-muted mt-1 text-sm">
            {complete
              ? `Completed ${formatDate(row.completedAt!)}`
              : started
                ? `Last attended ${formatDate(row.lastSeenAt!)}`
                : `Assigned ${formatDate(row.assignedAt)}`}
          </p>
        </div>

        <span
          className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${
            complete
              ? 'bg-teal/15 text-teal'
              : started
                ? 'bg-azure/20 text-azure-bright'
                : 'bg-charcoal-line text-muted'
          }`}
        >
          {complete ? 'Complete' : started ? `${row.percent}%` : 'Not started'}
        </span>
      </div>

      <div className="mt-4">
        <ProgressBar
          percent={row.percent}
          complete={complete}
          label={`${row.deckTitle ?? row.deckId} progress`}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {row.deckTitle === null ? (
          <span className="text-muted text-sm">
            This deck has been removed, so there is nothing to attend.
          </span>
        ) : (
          <>
            <Link
              href={`/session?deck=${encodeURIComponent(row.deckId)}`}
              className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                complete
                  ? 'border-charcoal-line text-muted hover:text-mist border'
                  : 'bg-azure text-mist hover:bg-teal hover:text-charcoal'
              }`}
            >
              {complete ? 'Attend again' : started ? 'Resume' : 'Start'}
            </Link>

            {started && !complete && (
              <span className="text-muted text-sm">
                You are {row.percent}% through
                {row.lastSlideId !== null ? `, on slide ${row.lastSlideId}` : ''}.
              </span>
            )}

            {due && (
              <span
                className={`text-sm ${due.late ? 'text-logo-red font-semibold' : 'text-muted'}`}
              >
                {due.text}
              </span>
            )}
          </>
        )}
      </div>
    </li>
  );
}

const STEP_TONE: Record<JourneyStep['state'], string> = {
  done: 'text-teal',
  open: 'text-mist',
  locked: 'text-muted',
  'not needed': 'text-muted',
};

const STEP_MARK: Record<JourneyStep['state'], string> = {
  done: 'Done',
  open: 'To do',
  locked: 'Not yet',
  'not needed': 'Not needed',
};

/** One trainer-led session's steps, in the order they have to be done (AI-26). */
function JourneyCard({ journey }: { journey: SessionJourney }) {
  return (
    <li className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5">
      <p className="text-mist font-semibold">{journey.deckTitle}</p>
      <p className="text-muted mt-1 text-sm">
        Trainer-led{journey.when ? `, ${journey.when}` : ''}
      </p>
      <ol className="mt-4 space-y-2">
        {journey.steps.map((step, index) => (
          <li key={step.label} className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted w-5 shrink-0">{index + 1}.</span>
            <span className={`min-w-0 flex-1 ${STEP_TONE[step.state]}`}>
              {step.href ? (
                <Link href={step.href} className="text-teal font-semibold hover:underline">
                  {step.label}
                </Link>
              ) : (
                step.label
              )}
              {step.note && <span className="text-muted block text-xs">{step.note}</span>}
            </span>
            <span className={`text-xs ${STEP_TONE[step.state]}`}>{STEP_MARK[step.state]}</span>
          </li>
        ))}
      </ol>
    </li>
  );
}

export function HomeForTrainee({
  person,
  rows: allRows,
  journeys = [],
}: {
  person: SignedInPerson;
  rows: ProgressRow[];
  journeys?: SessionJourney[];
}) {
  // A deck taught in a trainer-led session is assigned so its steps can be done here,
  // but it is attended in the room, so it is not offered as a session to start alone.
  const inTheRoom = new Set(journeys.map((journey) => journey.deckId));
  const rows = allRows.filter((row) => !inTheRoom.has(row.deckId));
  const outstanding = rows.filter((row) => row.completedAt === null);
  const done = rows.filter((row) => row.completedAt !== null);

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-muted hidden text-sm sm:inline">{person.name || person.email}</span>
          <MainNav person={person} current="/" />
        </div>
      </BrandHeader>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Your training</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">
          {person.name ? `Hello, ${person.name.split(' ')[0]}` : 'Your training'}
        </h1>

        <p className="text-muted mt-3 max-w-2xl text-base leading-relaxed">
          {rows.length === 0
            ? 'Nothing has been assigned to you yet. When it is, it will appear here.'
            : outstanding.length === 0
              ? 'You are up to date. Everything assigned to you is complete.'
              : `${outstanding.length} ${outstanding.length === 1 ? 'session' : 'sessions'} to attend. ${TRAINER_NAME} presents each one and answers your questions out loud, and you can stop and pick up where you left off.`}
        </p>

        {journeys.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold">Trainer-led sessions</h2>
            <p className="text-muted mt-1 text-sm">
              The session runs in the room. Do each step here, on your own device, in order.
            </p>
            <ul className="mt-4 grid gap-4">
              {journeys.map((journey) => (
                <JourneyCard key={journey.sessionId} journey={journey} />
              ))}
            </ul>
          </section>
        )}

        {rows.length === 0 && journeys.length > 0 ? null : rows.length === 0 ? (
          <p className="border-charcoal-line text-muted mt-10 rounded-xl border border-dashed p-8 text-center text-sm">
            Nothing assigned yet.
          </p>
        ) : (
          <>
            {outstanding.length > 0 && (
              <section className="mt-10">
                <h2 className="text-xl font-semibold">To attend</h2>
                <ul className="mt-4 grid gap-4">
                  {outstanding.map((row) => (
                    <TrainingCard key={row.deckId} row={row} />
                  ))}
                </ul>
              </section>
            )}

            {done.length > 0 && (
              <section className="mt-12">
                <h2 className="text-xl font-semibold">Completed</h2>
                <ul className="mt-4 grid gap-4">
                  {done.map((row) => (
                    <TrainingCard key={row.deckId} row={row} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <p className="text-muted mt-12 text-sm leading-relaxed">
          A session counts as complete once {TRAINER_NAME} has finished teaching{' '}
          {COMPLETION_THRESHOLD}% of it, measured by how long each slide takes to present rather
          than by how many slides you have clicked past. Skipping ahead does not count as attending.
        </p>
      </main>
    </div>
  );
}
