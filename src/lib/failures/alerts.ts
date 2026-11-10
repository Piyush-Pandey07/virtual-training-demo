/**
 * What the developer log says needs somebody to act on, for the administrator's home page
 * (AI-11).
 *
 * A provider out of credit, or refusing its key, fails every request until a person
 * does something about it, and trainees only ever see a standard message. So the
 * administrator is told, by name and time, from the last two days of the log.
 */

import 'server-only';

import { entriesFor, type DevLogEntry } from './devlog';

/** The kinds that do not clear on their own. */
const NEEDS_A_PERSON = new Set(['out_of_credit', 'bad_key', 'not_configured']);

export interface ProviderAlert {
  provider: string;
  kind: string;
  /** The latest time it happened, ISO 8601. */
  lastAt: string;
  /** How many times across the window, counting repeats folded into one entry. */
  count: number;
}

/** Folds log entries into one alert per provider and kind, newest first. */
export function alertsFrom(entries: readonly DevLogEntry[]): ProviderAlert[] {
  const byKey = new Map<string, ProviderAlert>();
  for (const entry of entries) {
    if (entry.source !== 'server' || !NEEDS_A_PERSON.has(entry.kind)) continue;
    const key = `${entry.provider}|${entry.kind}`;
    const current = byKey.get(key);
    const count = (current?.count ?? 0) + (entry.repeats ?? 1);
    const lastAt = current && current.lastAt > entry.at ? current.lastAt : entry.at;
    byKey.set(key, { provider: entry.provider, kind: entry.kind, lastAt, count });
  }
  return [...byKey.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** Today's and yesterday's alerts. Empty if the log cannot be read. */
export async function recentProviderAlerts(now = new Date()): Promise<ProviderAlert[]> {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const [a, b] = await Promise.all([
    entriesFor(today).catch(() => []),
    entriesFor(yesterday).catch(() => []),
  ]);
  return alertsFrom([...a, ...b]);
}
