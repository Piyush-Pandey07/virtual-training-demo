import { ProgressBar } from '@/components/ProgressBar';
import { duration, employeeStats } from '@/lib/roster/stats';
import type { ProgressRow } from '@/lib/roster/types';

/**
 * How one employee is doing, above the list of what they were given.
 *
 * The list below this was already complete -- every deck, every percentage, every due
 * date. What it could not do was answer the question the page is opened for, because
 * that meant reading eight rows and adding them up. So this says it once: how far
 * through everything they are, what is left, whether anything is late, and how much
 * time they have actually spent in a session.
 *
 * Every figure is derived from the same rows the list renders, so the two cannot
 * disagree.
 */

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'unknown';
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warn';
}) {
  return (
    <div>
      <p
        className={`text-2xl font-bold tabular-nums ${
          tone === 'good' ? 'text-teal' : tone === 'warn' ? 'text-logo-red' : ''
        }`}
      >
        {value}
      </p>
      <p className="text-muted mt-0.5 text-xs">{label}</p>
    </div>
  );
}

export function EmployeeStats({
  rows,
  joinedAt,
  lastSignedInAt,
}: {
  rows: ProgressRow[];
  joinedAt: string;
  lastSignedInAt: string | null;
}) {
  const stats = employeeStats(rows);

  if (stats.assigned === 0) {
    return (
      <section className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5">
        <p className="text-muted text-sm leading-relaxed">
          Nothing assigned yet, so there is nothing to report. Added{' '}
          {formatDate(joinedAt)}
          {lastSignedInAt === null
            ? ' and has never signed in.'
            : ` · last signed in ${formatDate(lastSignedInAt)}.`}
        </p>
      </section>
    );
  }

  return (
    <section className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Where they are</h2>
        <p className="text-muted text-xs">
          Added {formatDate(joinedAt)}
          {lastSignedInAt === null
            ? ' · has never signed in'
            : ` · last signed in ${formatDate(lastSignedInAt)}`}
        </p>
      </div>

      <div className="mt-4">
        <ProgressBar
          percent={stats.percent}
          complete={stats.completed === stats.assigned && stats.assigned > 0}
        />
        <p className="text-muted mt-2 text-xs">
          {stats.percent}% of everything assigned, weighted by how long each deck runs —{' '}
          {stats.slidesTaught} of {stats.slidesAssigned} slides taught
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Figure label="assigned" value={String(stats.assigned)} />
        <Figure
          label="completed"
          value={String(stats.completed)}
          tone={stats.completed > 0 ? 'good' : undefined}
        />
        <Figure label="part-way" value={String(stats.inProgress)} />
        <Figure label="not started" value={String(stats.notStarted)} />
        <Figure
          label={stats.overdue === 1 ? 'overdue' : 'overdue'}
          value={String(stats.overdue)}
          tone={stats.overdue > 0 ? 'warn' : undefined}
        />
        {/* Time actually taught, not time the deck would take. The difference is the
            point: it is what says whether somebody sat through it or clicked past. */}
        <Figure label="time in sessions" value={duration(stats.secondsSpent)} />
      </div>

      <p className="text-muted mt-4 text-xs">
        {stats.lastActiveAt
          ? `Last in a session ${formatDate(stats.lastActiveAt)}`
          : 'Has never started a session'}
        {stats.nextDueAt && ` · next due ${formatDate(stats.nextDueAt)}`}
        {` · ${duration(stats.secondsAssigned)} of material assigned in total`}
      </p>
    </section>
  );
}
