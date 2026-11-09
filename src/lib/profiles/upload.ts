/**
 * Turning a checked upload into people and prefilled profiles (BRD v2.3, AI-28).
 *
 * Each row creates the person in the uploader's organisation, as a participant, or finds
 * them if they are already there, and stores the profile the file gave them, marked as
 * uploaded and not yet confirmed. Nothing here makes a profile reach the trainer: that
 * waits for the participant to see it, finish it and agree to the notice.
 *
 * The roster's `upsertPerson` creates people, as adding somebody by hand on the people
 * screen does. It is called for new people only. On somebody already there it would
 * also stamp them as seen just now, which would turn "has never signed in" into a lie for
 * everybody in the file; and their name is theirs to correct, on their profile, which
 * the upload does fill in.
 */

import 'server-only';

import type { DocumentStore } from '../roster/documents';
import type { RosterStore } from '../roster/store';
import type { Person, SignedInPerson } from '../roster/types';
import type { UploadRow } from './csv';
import { saveUploadedProfile, type UploadOutcome } from './store';

/** What happened to one row, as the uploader is shown it. */
export interface UploadResult {
  line: number;
  email: string;
  status: 'created' | 'updated' | 'rejected';
  /** Why a row was refused. */
  reason?: string;
  /** Required fields the participant will be asked for on their first visit. */
  missing?: string[];
  /** Whether the profile was prefilled, or kept because the participant had confirmed it. */
  profile?: UploadOutcome;
}

export interface UploadSummary {
  created: number;
  updated: number;
  rejected: number;
  incomplete: number;
}

export interface ImportOptions {
  roster: RosterStore;
  /** The document store profiles are written to, before scoping. For the tests. */
  store?: DocumentStore;
  now?: Date;
  /** How many rows are written at once. */
  concurrency?: number;
}

/**
 * A few rows at a time rather than one, so a batch of fifty takes a second or two
 * rather than ten, and not all at once, so a thousand rows does not open a thousand
 * writes against Firestore together.
 */
const CONCURRENCY = 8;

async function pooled<T, R>(items: readonly T[], width: number, work: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next;
      next += 1;
      results[at] = await work(items[at]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return results;
}

export async function importParticipants(
  uploader: SignedInPerson,
  rows: readonly UploadRow[],
  options: ImportOptions,
): Promise<UploadResult[]> {
  const { roster } = options;
  const now = options.now ?? new Date();

  // Read once, rather than once per row. The file has already been checked for an
  // address appearing twice, so no two rows below can race to create one person.
  const people = new Map<string, Person>(
    (await roster.listPeople()).map((person) => [person.emailKey, person]),
  );

  return pooled(rows, options.concurrency ?? CONCURRENCY, async (row): Promise<UploadResult> => {
    if (!row.ok) {
      return { line: row.line, email: row.email, status: 'rejected', reason: row.error };
    }

    const existing = people.get(row.emailKey);
    if (existing && existing.role !== 'trainee') {
      // A participant upload is not the way to change what an administrator or a
      // facilitator is, or to write a profile they did not ask for.
      return {
        line: row.line,
        email: row.email,
        status: 'rejected',
        reason: 'This address belongs to an administrator or facilitator here, not a participant.',
      };
    }

    try {
      const person =
        existing ??
        (await roster.upsertPerson({
          email: row.email,
          name: row.details.name,
          role: 'trainee',
          orgId: uploader.orgId,
        }));

      const profile = await saveUploadedProfile(
        { id: person.id, orgId: uploader.orgId, emailKey: person.emailKey },
        row.details,
        uploader.id,
        { store: options.store },
        now,
      );

      return {
        line: row.line,
        email: row.email,
        status: existing ? 'updated' : 'created',
        profile,
        missing: profile === 'prefilled' ? row.missing.map((field) => field.label) : [],
      };
    } catch {
      // One row failing to save says nothing about the next, so it is reported and the
      // rest carry on. The message stays general: the uploader can do nothing with a
      // storage error but try that row again.
      return {
        line: row.line,
        email: row.email,
        status: 'rejected',
        reason: 'This row could not be saved. Upload it again.',
      };
    }
  });
}

export function summarise(results: readonly UploadResult[]): UploadSummary {
  return {
    created: results.filter((result) => result.status === 'created').length,
    updated: results.filter((result) => result.status === 'updated').length,
    rejected: results.filter((result) => result.status === 'rejected').length,
    incomplete: results.filter((result) => (result.missing?.length ?? 0) > 0).length,
  };
}
