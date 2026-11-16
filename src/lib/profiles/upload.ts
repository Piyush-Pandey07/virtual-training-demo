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
 *
 * A row whose address is on a domain the company has not claimed is refused (AI-59).
 * Sign-in places somebody who has never signed in by the domain of their address, so
 * such a person would be on the roster with a prefilled profile and no way ever to reach
 * it, and nothing on any screen would say why.
 *
 * Each upload is also recorded once in the audit history, with its counts (AI-60), next
 * to the entry for each profile it filled in.
 */

import 'server-only';

import type { DocumentStore } from '../roster/documents';
import type { RosterStore } from '../roster/store';
import { recordAudit, type AuditOptions } from '../audit/log';
import { domainKeyOf } from '../orgs/types';
import type { Person, SignedInPerson } from '../roster/types';
import type { UploadRow } from './csv';
import { saveUploadedProfile, type UploadOutcome } from './store';

/**
 * What happened to one row, as the uploader is shown it: imported, as a new person or
 * one already here; a duplicate of an earlier row, which is the one kept; or failed,
 * with the reason (AI-28).
 */
export interface UploadResult {
  line: number;
  email: string;
  status: 'created' | 'updated' | 'duplicate' | 'rejected';
  /** Why a row was refused, or which row it repeats. */
  reason?: string;
  /** For a duplicate, the row whose address it repeats. */
  duplicateOf?: number;
  /** Required fields the participant will be asked for on their first visit. */
  missing?: string[];
  /** Whether the profile was prefilled, or kept because the participant had confirmed it. */
  profile?: UploadOutcome;
}

export interface UploadSummary {
  created: number;
  updated: number;
  duplicates: number;
  rejected: number;
  incomplete: number;
}

export interface ImportOptions {
  roster: RosterStore;
  /** The document store profiles are written to, before scoping. For the tests. */
  store?: DocumentStore;
  /**
   * The email domains the uploader's organisation has claimed, as its record lists them.
   * Empty or absent refuses nothing: see `offDomainReason`.
   */
  domains?: readonly string[];
  now?: Date;
  /** How many rows are written at once. */
  concurrency?: number;
}

/**
 * A few rows at a time rather than one, so a batch of fifty takes a second or two
 * rather than ten, and not all at once, so a thousand rows does not open a thousand
 * writes against Firestore together. Each row is its own writes, never a batched
 * write, so there is no 500-write ceiling on a file either.
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

/**
 * Why a row cannot be imported because of its address's domain, or null when it can.
 *
 * Compared with every domain the organisation claims, since a company may have several,
 * exactly as sign-in compares them: `mail.acme.com` is not `acme.com` there, so it is
 * not here either.
 *
 * An organisation that has claimed no domains at all refuses nothing. Nobody it holds
 * was placed by a domain: Technavious's own staff on personal addresses, a customer
 * still being provisioned, and every organisation on a local build without Firebase,
 * which has none recorded. Refusing every row there would make the upload useless
 * without telling anybody anything they could fix, whereas a company that has named its
 * domains has said which addresses are its own, and a row outside them is a mistake in
 * the file.
 */
export function offDomainReason(
  emailKey: string,
  domains: readonly string[] | undefined,
): string | null {
  if (!domains || domains.length === 0) return null;
  const claimed = [...new Set(domains.map(domainKeyOf))].sort();
  const domain = emailKey.slice(emailKey.lastIndexOf('@') + 1);
  if (claimed.includes(domain)) return null;
  return (
    `The address is not on a domain this company uses (${domain}), so this person could ` +
    `not sign in. This company uses ${claimed.join(', ')}.`
  );
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
      return row.duplicateOf !== undefined
        ? {
            line: row.line,
            email: row.email,
            status: 'duplicate',
            reason: row.error,
            duplicateOf: row.duplicateOf,
          }
        : { line: row.line, email: row.email, status: 'rejected', reason: row.error };
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

    // Somebody already here who has signed in before is found by the directory at sign-in,
    // whatever their domain, so the reason for refusing does not apply to them: they are
    // often on an address placed by hand, such as one Technavious staff moved here.
    const refused = existing?.lastSeenAt ? null : offDomainReason(row.emailKey, options.domains);
    if (refused) {
      return { line: row.line, email: row.email, status: 'rejected', reason: refused };
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
      // One entry per profile written, against the person it is about, so the history
      // of one person's profile shows the upload that filled it in (AI-40). A profile
      // kept because its owner had confirmed it was not changed, so it is not recorded.
      if (profile === 'prefilled') {
        await recordAudit(
          uploader,
          {
            action: 'uploaded',
            subjectType: 'profile',
            subjectId: person.id,
            detail: `Prefilled the profile of ${row.email} from line ${row.line} of an upload`,
          },
          { store: options.store },
        );
      }

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
    duplicates: results.filter((result) => result.status === 'duplicate').length,
    rejected: results.filter((result) => result.status === 'rejected').length,
    incomplete: results.filter((result) => (result.missing?.length ?? 0) > 0).length,
  };
}

/**
 * The one entry an upload adds to the audit history, with its counts (AI-60).
 *
 * The entries for each profile say whom an upload touched; this one says that the upload
 * happened at all and how it went, which is the only record of a file that imported
 * nobody. Failed and refused are one count, as on the upload page, because both are rows
 * the uploader has to put right and send again.
 */
export function uploadAuditDetail(results: readonly UploadResult[]): string {
  const summary = summarise(results);
  const imported = summary.created + summary.updated;
  return (
    `Uploaded a file of ${results.length} ${results.length === 1 ? 'row' : 'rows'}: ` +
    `${imported} imported (${summary.created} new, ${summary.updated} already here), ` +
    `${summary.duplicates} ${summary.duplicates === 1 ? 'duplicate' : 'duplicates'}, ` +
    `${summary.rejected} failed or refused, ${summary.incomplete} to complete`
  );
}

export function recordUploadAudit(
  uploader: SignedInPerson,
  results: readonly UploadResult[],
  options: AuditOptions = {},
): Promise<void> {
  const at = new Date(options.now ?? Date.now()).toISOString();
  return recordAudit(
    uploader,
    {
      action: 'uploaded',
      subjectType: 'participant-upload',
      // An upload is kept nowhere but here, so it is named by when it was made.
      subjectId: at,
      detail: uploadAuditDetail(results),
    },
    options,
  );
}
