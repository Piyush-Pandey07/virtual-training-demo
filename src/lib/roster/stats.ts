import type { ProgressRow } from './types';

/**
 * One employee's training, totalled.
 *
 * The profile already listed every deck they had been given. What it could not answer
 * without the reader adding up rows themselves was "how are they doing" -- how much is
 * left, how much time they have actually spent, whether anything is late. That is the
 * question a company administrator opens somebody's page to ask.
 *
 * Derived from rows rather than read from storage, so there is nothing to keep in step
 * and no second source of truth to disagree with the list underneath it.
 *
 * Pure: takes rows, returns numbers. No imports beyond the row type, so the client half
 * of a page can call it too.
 */

export interface EmployeeStats {
  assigned: number;
  completed: number;
  /** Started and not finished. */
  inProgress: number;
  notStarted: number;
  /** Past its due date and not complete. Counted separately because it is the one
      number that means somebody has to do something about it. */
  overdue: number;
  /**
   * Progress across everything assigned, weighted by deck length.
   *
   * Weighted rather than an average of percentages, so a half-finished ninety-minute
   * deck does not count the same as a half-finished five-minute one.
   */
  percent: number;
  /** Seconds of material actually taught to them, summed across decks. */
  secondsSpent: number;
  /** Seconds of material they have been given in total. */
  secondsAssigned: number;
  slidesTaught: number;
  slidesAssigned: number;
  /** The most recent moment they were in any session, or null if never. */
  lastActiveAt: string | null;
  /** The soonest due date still outstanding, or null. */
  nextDueAt: string | null;
}

export function employeeStats(rows: ProgressRow[], now = new Date()): EmployeeStats {
  const today = now.toISOString();

  let completed = 0;
  let inProgress = 0;
  let notStarted = 0;
  let overdue = 0;
  let secondsSpent = 0;
  let secondsAssigned = 0;
  let slidesTaught = 0;
  let slidesAssigned = 0;
  let lastActiveAt: string | null = null;
  let nextDueAt: string | null = null;

  for (const row of rows) {
    secondsSpent += row.coverage.coveredSeconds;
    secondsAssigned += row.coverage.totalSeconds;
    slidesTaught += row.coverage.coveredCount;
    slidesAssigned += row.coverage.slideCount;

    if (row.lastSeenAt && (lastActiveAt === null || row.lastSeenAt > lastActiveAt)) {
      lastActiveAt = row.lastSeenAt;
    }

    if (row.completedAt !== null) {
      completed += 1;
      continue;
    }

    if (row.startedAt === null) notStarted += 1;
    else inProgress += 1;

    if (row.dueAt !== null) {
      if (row.dueAt < today) overdue += 1;
      if (nextDueAt === null || row.dueAt < nextDueAt) nextDueAt = row.dueAt;
    }
  }

  return {
    assigned: rows.length,
    completed,
    inProgress,
    notStarted,
    overdue,
    /**
     * Finished first, seconds second.
     *
     * A deck is marked complete at `COMPLETION_THRESHOLD`, which is 90 rather than 100:
     * the last slide of a deck is usually a closing card, and somebody who heard
     * everything that teaches anything has finished. So a trainee who has completed
     * every deck they were given still has coverage short of the full budget, and
     * dividing seconds would put "94%" directly above a list reading "1 of 1 complete".
     * Two numbers disagreeing on one screen is worse than either alone, and the app's
     * own definition of done is the one that should win.
     *
     * The zero-seconds branch stays underneath: a deck uploaded and never analysed has
     * no budget at all, and dividing by it would print NaN% on somebody's profile.
     */
    percent:
      rows.length > 0 && completed === rows.length
        ? 100
        : secondsAssigned > 0
          ? Math.min(100, Math.round((secondsSpent / secondsAssigned) * 100))
          : 0,
    secondsSpent,
    secondsAssigned,
    slidesTaught,
    slidesAssigned,
    lastActiveAt,
    nextDueAt,
  };
}

/** "1 h 20 m", "45 m", "—". Long enough to read at a glance, short enough for a row. */
export function duration(seconds: number): string {
  if (seconds <= 0) return '—';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}
