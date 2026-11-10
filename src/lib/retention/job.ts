/**
 * The daily retention job (AI-41): restricts profiles, assessment results and feedback 90
 * days after last use, and deletes them a year after it.
 *
 * Run once a day by Vercel Cron through GET /api/cron/retention. It walks every
 * organisation, and within each one reads the three collections it governs, works out
 * each record's last use from the participant's last session (see `policy.ts`), and
 * then does one of four things to the record: nothing, restrict it, lift a restriction
 * that a later session has made stale, or delete it.
 *
 * Three properties matter more than speed:
 *
 * - Idempotent. Restricting a restricted record and deleting a deleted one change
 *   nothing, so a run that is repeated, retried by the platform or overlaps another is
 *   harmless.
 *
 * - Bounded. A function has a time limit, and a deployment with many customers may not
 *   fit in one run. The job stops itself well inside the limit, or after a set number of
 *   writes, and records which organisation it had reached so tomorrow's run starts there.
 *   Every organisation is still visited, a day or two apart at worst.
 *
 * - Cautious. Anything it cannot read is left alone. An organisation whose sessions
 *   cannot be listed, or a person whose attempts cannot be read, is skipped for the day
 *   rather than judged on what happened to load, because judging a participant as idle
 *   because a query failed would delete records that are still in use.
 *
 * Training progress, attendance and consent records are kept for at least five years,
 * and this job never reads or writes them beyond the attempts and sessions it measures
 * last use from.
 *
 * A dry run reads exactly what a real run would and writes nothing, the cursor included,
 * and can be asked to judge as of a later date, so UAT can see what will happen to a
 * participant in four months without waiting four months.
 */

import 'server-only';

import { assessmentDocuments, ASSESSMENT_RESULTS, FEEDBACK } from '../assessments/store';
import type { AssessmentResult, FeedbackRecord } from '../assessments/types';
import { firestoreDocuments } from '../firebase/firestore';
import { orgsConfigured, orgStore } from '../orgs/registry';
import { HOME_ORG_ID } from '../orgs/types';
import { profileDocuments, PROFILES } from '../profiles/store';
import type { LearnerProfileRecord } from '../profiles/types';
import { InMemoryDocumentStore, type DocumentStore } from '../roster/documents';
import { rosterStore } from '../roster/registry';
import type { RosterStore } from '../roster/store';
import type { Attempt } from '../roster/types';
import { trainingStore } from '../training/store';
import type { TrainingSession } from '../training/types';
import {
  lastSessionAt,
  latest,
  recentEnough,
  stepFor,
  timeOf,
  type RetentionMark,
  type Retained,
} from './policy';
import { isRestricted } from './restricted';

/** Where the job keeps the organisation it reached, outside any organisation's prefix. */
export const RETENTION = 'retention';
const CURSOR_ID = 'cursor';

/**
 * How long a run may spend before it stops itself. The route's function limit is 60
 * seconds, and this leaves room for the last write, the cursor and the response.
 */
export const DEFAULT_BUDGET_MS = 45_000;

/** How many writes a run may make. Generous for a day, and a ceiling on a bad one. */
export const DEFAULT_MAX_WRITES = 2_000;

/** How many record ids a dry run lists per organisation, so UAT can check particular people. */
const MAX_EXAMPLES = 25;

export type RetainedKind = 'profiles' | 'results' | 'feedback';

export type Counts = Record<RetainedKind, number>;

export interface OrgRetentionReport {
  orgId: string;
  restricted: Counts;
  /** Restrictions taken off, because a later session put the record back in use. */
  lifted: Counts;
  deleted: Counts;
  /** Records left alone today because something about them could not be read. */
  skipped: number;
  /** Why the organisation was skipped altogether, if it was. */
  error?: string;
  /** Dry run only: what would be done, by record id. */
  examples?: string[];
}

export interface RetentionReport {
  dryRun: boolean;
  /** The moment the policy was judged at. Today, unless a dry run asked for another. */
  asOf: string;
  /** Whether every organisation was visited. False means tomorrow carries on. */
  complete: boolean;
  /** The organisation the next run starts from, when this one stopped early. */
  resumeFrom: string | null;
  writes: number;
  durationMs: number;
  totals: { restricted: Counts; lifted: Counts; deleted: Counts; skipped: number };
  orgs: OrgRetentionReport[];
}

export interface RetentionOptions {
  /** Report what would happen without changing anything. */
  dryRun?: boolean;
  /** When to judge the policy as of. Defaults to now. */
  asOf?: Date;
  /** The document store underneath everything, before it is scoped. For the tests. */
  store?: DocumentStore;
  /** Each organisation's roster. For the tests. */
  roster?: (orgId: string) => RosterStore;
  /** The organisations to walk. Defaults to every one in the customer list. */
  orgIds?: string[];
  budgetMs?: number;
  maxWrites?: number;
  /** The clock the budget is measured on, which is not the policy's date. For the tests. */
  clock?: () => number;
}

interface Cursor {
  orgId: string;
  at: string;
}

const fallback = new InMemoryDocumentStore();

function platformDocuments(store?: DocumentStore): DocumentStore {
  return store ?? (orgsConfigured() ? firestoreDocuments() : fallback);
}

/** Thrown inside a run when it has spent its time or its writes. Caught by the run. */
class OutOfBudget extends Error {}

/** A record that disappeared or changed between being read and being written. */
class Moved extends Error {}

interface Run {
  dryRun: boolean;
  now: number;
  asOf: string;
  store?: DocumentStore;
  roster: (orgId: string) => RosterStore;
  deadline: number;
  writesLeft: number;
  writes: number;
  clock: () => number;
}

function zero(): Counts {
  return { profiles: 0, results: 0, feedback: 0 };
}

function spend(run: Run): void {
  if (run.clock() > run.deadline || run.writesLeft <= 0) throw new OutOfBudget();
  run.writesLeft -= 1;
  run.writes += 1;
}

function checkTime(run: Run): void {
  if (run.clock() > run.deadline) throw new OutOfBudget();
}

/** One record the job may act on, with what it needs to find and re-check it. */
interface Candidate {
  kind: RetainedKind;
  docs: DocumentStore;
  collection: string;
  id: string;
  /** Whose last session decides it. More than one for an uploaded profile, see below. */
  personIds: string[];
  ownDate: number | null;
  record: Retained;
}

/**
 * The record's own idea of when it was last touched.
 *
 * A profile changes when its owner saves it or their organisation uploads it again; a
 * result and feedback are written once and never change.
 */
function profileDate(profile: LearnerProfileRecord): number | null {
  return latest(timeOf(profile.updatedAt), timeOf(profile.consent?.at), timeOf(profile.uploadedAt));
}

function submittedDate(record: { submittedAt?: string }): number | null {
  return timeOf(record.submittedAt);
}

function ownDateOf(kind: RetainedKind, record: unknown): number | null {
  return kind === 'profiles'
    ? profileDate(record as LearnerProfileRecord)
    : submittedDate(record as { submittedAt?: string });
}

/** Without the mark, so lifting a restriction leaves the record exactly as it was before. */
function unmarked<T extends Retained>(record: T): T {
  const copy = { ...record };
  delete copy.retention;
  return copy;
}

/**
 * Applies the policy to one organisation.
 *
 * The id comes from the customer list, never from a request, and the run is the only
 * caller, which is why this is not exported.
 */
async function retainOrg(orgId: string, run: Run): Promise<OrgRetentionReport> {
  const report: OrgRetentionReport = {
    orgId,
    restricted: zero(),
    lifted: zero(),
    deleted: zero(),
    skipped: 0,
  };
  if (run.dryRun) report.examples = [];
  const note = (line: string) => {
    if (report.examples && report.examples.length < MAX_EXAMPLES) report.examples.push(line);
  };

  const roster = run.roster(orgId);
  if (!roster.writable) {
    // A deployment with no roster has no attempts to read, and "no attempts" would make
    // every participant look idle. Nothing is judged on that.
    report.error = 'No roster storage, so last sessions cannot be known.';
    return report;
  }

  const profileDocs = profileDocuments({ orgId }, { store: run.store });
  const assessmentDocs = assessmentDocuments(orgId, run.store);

  let profiles: LearnerProfileRecord[];
  let results: AssessmentResult[];
  let feedback: FeedbackRecord[];
  let sessions: TrainingSession[];
  try {
    [profiles, results, feedback, sessions] = await Promise.all([
      profileDocs.all<LearnerProfileRecord>(PROFILES),
      assessmentDocs.all<AssessmentResult>(ASSESSMENT_RESULTS),
      assessmentDocs.all<FeedbackRecord>(FEEDBACK),
      trainingStore(orgId, run.store).listSessions(),
    ]);
  } catch (error) {
    report.error = `Could not be read: ${(error as Error).message}`.slice(0, 300);
    return report;
  }

  // Only records old enough on their own dates to be due, or already restricted and so
  // perhaps due to be lifted, are worth the reads that find a last session. Everything
  // else was touched inside 90 days and is in use whatever the sessions say.
  const candidates: Candidate[] = [];
  const consider = (
    kind: RetainedKind,
    docs: DocumentStore,
    collection: string,
    id: string | undefined,
    personIds: string[],
    record: Retained,
  ) => {
    if (!id) return;
    const ownDate = ownDateOf(kind, record);
    if (recentEnough(ownDate, run.now) && !isRestricted(record)) return;
    candidates.push({ kind, docs, collection, id, personIds, ownDate, record });
  };
  for (const profile of profiles) {
    consider('profiles', profileDocs, PROFILES, profile.personId, [profile.personId], profile);
  }
  for (const result of results) {
    consider('results', assessmentDocs, ASSESSMENT_RESULTS, result.id, [result.personId], result);
  }
  for (const record of feedback) {
    consider('feedback', assessmentDocs, FEEDBACK, record.id, [record.personId], record);
  }

  // An uploaded profile may still sit under the placeholder id it was uploaded against
  // while its owner trains under their real one. Their sessions count for it too, found
  // by the address it carries.
  for (const candidate of candidates) {
    const emailKey = (candidate.record as LearnerProfileRecord).emailKey;
    if (candidate.kind !== 'profiles' || !emailKey) continue;
    checkTime(run);
    const owner = await roster.getPersonByEmail(emailKey).catch(() => undefined);
    if (owner && !candidate.personIds.includes(owner.id)) candidate.personIds.push(owner.id);
  }

  // Each person's attempts, read once however many of their records are candidates. A
  // failed read is remembered as unknown, and their records are skipped.
  const attempts = new Map<string, Attempt[] | null>();
  for (const personId of new Set(candidates.flatMap((candidate) => candidate.personIds))) {
    checkTime(run);
    attempts.set(personId, await roster.listAttemptsForPerson(personId).catch(() => null));
  }

  for (const candidate of candidates) {
    const known = candidate.personIds.map((personId) => attempts.get(personId) ?? null);
    if (known.some((list) => list === null)) {
      report.skipped += 1;
      continue;
    }
    const theirAttempts = known.flat() as Attempt[];
    const lastSession = latest(
      ...candidate.personIds.map((personId) => lastSessionAt(personId, theirAttempts, sessions)),
    );
    const lastUse = latest(candidate.ownDate, lastSession);
    const step = stepFor(lastUse, run.now);
    const restricted = isRestricted(candidate.record);

    try {
      if (step === 'delete') {
        note(`delete ${candidate.kind} ${candidate.id}`);
        if (!run.dryRun) await remove(run, candidate);
        report.deleted[candidate.kind] += 1;
      } else if (step === 'restrict' && !restricted) {
        note(`restrict ${candidate.kind} ${candidate.id}`);
        const mark: RetentionMark = {
          restrictedAt: run.asOf,
          lastUsedAt: new Date(lastUse!).toISOString(),
        };
        if (!run.dryRun) await restrict(run, candidate, mark);
        report.restricted[candidate.kind] += 1;
      } else if (step === 'keep' && restricted) {
        note(`lift ${candidate.kind} ${candidate.id}`);
        if (!run.dryRun) await lift(run, candidate);
        report.lifted[candidate.kind] += 1;
      }
    } catch (error) {
      if (error instanceof OutOfBudget) throw error;
      // Gone or changed since it was read, or a write that failed. Tomorrow looks again.
      report.skipped += 1;
    }
  }
  return report;
}

async function restrict(run: Run, candidate: Candidate, mark: RetentionMark): Promise<void> {
  spend(run);
  await candidate.docs.update<Retained>(candidate.collection, candidate.id, (current) => {
    if (!current) throw new Moved();
    // Saved again since it was read, by its owner or an upload: in use, so left alone.
    if (ownDateOf(candidate.kind, current) !== candidate.ownDate) throw new Moved();
    return { ...current, retention: mark };
  });
}

async function lift(run: Run, candidate: Candidate): Promise<void> {
  spend(run);
  await candidate.docs.update<Retained>(candidate.collection, candidate.id, (current) => {
    if (!current) throw new Moved();
    return unmarked(current);
  });
}

async function remove(run: Run, candidate: Candidate): Promise<void> {
  // Read again first. The document port has no conditional delete, so this narrows the
  // window in which a participant saving their profile could lose it to a delete that
  // was decided on the version before.
  checkTime(run);
  const current = await candidate.docs.get<Retained>(candidate.collection, candidate.id);
  if (!current) return;
  if (ownDateOf(candidate.kind, current) !== candidate.ownDate) throw new Moved();
  spend(run);
  await candidate.docs.remove(candidate.collection, candidate.id);
}

/** Every organisation, in a fixed order, so a cursor means the same thing tomorrow. */
async function organisations(options: RetentionOptions): Promise<string[]> {
  if (options.orgIds) return [...new Set(options.orgIds)].sort();
  const listed = orgsConfigured() ? (await orgStore().list()).map((org) => org.id) : [];
  // Technavious's own, whether or not it was ever provisioned as a customer: its people
  // train too, and their records are kept by the same rule.
  return [...new Set([...listed, HOME_ORG_ID])].sort();
}

function add(into: Counts, from: Counts): void {
  into.profiles += from.profiles;
  into.results += from.results;
  into.feedback += from.feedback;
}

/** Runs the job across every organisation, from where the last run stopped. */
export async function runRetention(options: RetentionOptions = {}): Promise<RetentionReport> {
  const clock = options.clock ?? Date.now;
  const started = clock();
  const asOf = options.asOf ?? new Date();
  const run: Run = {
    dryRun: options.dryRun === true,
    now: asOf.getTime(),
    asOf: asOf.toISOString(),
    store: options.store,
    roster: options.roster ?? rosterStore,
    deadline: started + (options.budgetMs ?? DEFAULT_BUDGET_MS),
    writesLeft: options.maxWrites ?? DEFAULT_MAX_WRITES,
    writes: 0,
    clock,
  };

  const platform = platformDocuments(options.store);
  const ids = await organisations(options);
  const cursor = await platform.get<Cursor>(RETENTION, CURSOR_ID).catch(() => undefined);
  // From the organisation the last run reached, round to the one before it, so every
  // organisation is visited before any is visited twice.
  const from = cursor
    ? Math.max(
        0,
        ids.findIndex((id) => id >= cursor.orgId),
      )
    : 0;
  const order = [...ids.slice(from), ...ids.slice(0, from)];

  const reports: OrgRetentionReport[] = [];
  let resumeFrom: string | null = null;
  for (const orgId of order) {
    try {
      checkTime(run);
      reports.push(await retainOrg(orgId, run));
    } catch (error) {
      if (!(error instanceof OutOfBudget)) throw error;
      // This organisation again tomorrow, from the top. What was done to it today is
      // already done, and doing it again changes nothing.
      resumeFrom = orgId;
      break;
    }
  }

  if (!run.dryRun) {
    // Best effort. A cursor that fails to save means tomorrow starts from the beginning,
    // which costs time and nothing else.
    await (
      resumeFrom
        ? platform.set<Cursor>(RETENTION, CURSOR_ID, { orgId: resumeFrom, at: run.asOf })
        : platform.remove(RETENTION, CURSOR_ID)
    ).catch(() => undefined);
  }

  const totals = { restricted: zero(), lifted: zero(), deleted: zero(), skipped: 0 };
  for (const report of reports) {
    add(totals.restricted, report.restricted);
    add(totals.lifted, report.lifted);
    add(totals.deleted, report.deleted);
    totals.skipped += report.skipped;
  }

  return {
    dryRun: run.dryRun,
    asOf: run.asOf,
    complete: resumeFrom === null,
    resumeFrom,
    writes: run.writes,
    durationMs: clock() - started,
    totals,
    orgs: reports,
  };
}
