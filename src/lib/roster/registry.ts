/**
 * Which roster storage this deployment has.
 *
 * The same env-descending rule the deck registry uses, and cached the same way, so
 * the two cannot disagree about which deployment they are in.
 *
 *   DATABASE_URL set     → Postgres
 *   else not on Vercel   → the filesystem, under .data/roster
 *   else                 → none, which refuses writes and says why
 */

import 'server-only';

import { FilesystemRosterStore, defaultRosterRoot } from './store-fs';
import { NoRosterStore } from './store-none';
import type { RosterStore } from './store';

let cached: RosterStore | null = null;

export function rosterStore(): RosterStore {
  if (cached) return cached;

  // Postgres lands here once a database is provisioned. Until then a deployment
  // without one falls through to `none`, which refuses honestly rather than
  // pretending to save a trainee's progress.
  const onVercel = Boolean(process.env.VERCEL);
  if (!onVercel) {
    cached = new FilesystemRosterStore(process.env.ROSTER_STORE_DIR ?? defaultRosterRoot());
    return cached;
  }

  cached = new NoRosterStore();
  return cached;
}

/** For tests, which need a fresh store per case rather than a cached one. */
export function resetRosterStore(store?: RosterStore): void {
  cached = store ?? null;
}
