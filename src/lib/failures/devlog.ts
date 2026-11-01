/**
 * The developer log: what actually went wrong, for Technavious staff.
 *
 * The trainee sees a standard message that names no provider (see `codes.ts`). This is
 * where the detail goes instead: which provider, which status, its own words, and who
 * and what it happened to. It is read on the platform's error page, and nowhere else.
 *
 * One Firestore collection for the whole platform, outside any customer's prefix, in
 * the same way the customer list is. A customer's administrator never sees it, and the
 * entries are about the service, not about the customer's data. Each entry names the
 * organisation and person ids it happened to, so a support question can be matched to
 * it, and carries the short reference the trainee was shown.
 *
 * Kept 90 days. Each entry carries `expireAt`, and Firestore deletes it once a TTL
 * policy on the `expireAt` field of the `devlog` collection is enabled, as for the rate
 * limit counts. Read a day at a time by its `day` field, which the automatic index
 * serves, so the page never reads the whole collection.
 *
 * Writing is best effort. A failure to log a failure must never become the trainee's
 * problem, so every write is caught and, inside a request, made after the response.
 */

import 'server-only';

import { after } from 'next/server';

import { firestoreDocuments } from '../firebase/firestore';
import { orgsConfigured } from '../orgs/registry';
import { InMemoryDocumentStore, type DocumentStore } from '../roster/documents';
import type { FailureCode } from './codes';

export const DEVLOG = 'devlog';

/** How long an entry is kept. */
export const DEVLOG_RETENTION_DAYS = 90;

export interface DevLogEntry {
  /** Also the reference the trainee was shown. */
  id: string;
  /** ISO 8601. */
  at: string;
  /** `YYYY-MM-DD` in UTC, which is how the page reads a day. */
  day: string;
  /** Who noticed: our server talking to a provider, or the browser talking to us. */
  source: 'server' | 'browser';
  /** The provider, or for the browser what it was doing, such as `speech`. */
  provider: string;
  /** The finer kind, such as `out_of_credit` or `timeout`. */
  kind: string;
  /** What the trainee was told. */
  code: FailureCode;
  status?: number;
  /** The provider's or browser's own words. Capped. */
  detail: string;
  /** The route or screen it happened on. */
  route: string;
  orgId?: string;
  personId?: string;
  deckId?: string;
  language?: string;
  /** The browser, and what it said about its connection, for browser reports. */
  client?: { userAgent?: string; network?: string };
  /** How many identical failures this entry stands for. */
  repeats: number;
  expireAt: Date;
}

export type DevLogInput = Omit<DevLogEntry, 'id' | 'at' | 'day' | 'repeats' | 'expireAt'>;

const fallback = new InMemoryDocumentStore();

function store(override?: DocumentStore): DocumentStore {
  return override ?? (orgsConfigured() ? firestoreDocuments() : fallback);
}

/** Eight characters a person can read out over the phone: no 0, O, 1 or I. */
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => REF_ALPHABET[byte % REF_ALPHABET.length]).join('');
}

/**
 * The same failure, for the same person, in the last minute.
 *
 * A Sarvam account running dry fails every Hindi sentence of every session at once, and
 * a dropped connection fails each retry. Logging each one would write hundreds of
 * identical entries and bury the one that matters. Held per server, so a busy day may
 * still log a failure once per server per minute, which is plenty to see it.
 */
const recent = new Map<string, { at: number; id: string }>();
const SAME_FAILURE_MS = 60_000;
const MAX_RECENT = 5000;

function sameFailureKey(input: DevLogInput): string {
  return [input.source, input.provider, input.kind, input.route, input.orgId, input.personId].join(
    '|',
  );
}

/** Runs after the response when there is one, and straight away otherwise. */
function later(work: () => Promise<void>): void {
  const guarded = () => work().catch(() => undefined);
  try {
    after(guarded);
  } catch {
    // Outside a request, as in the tests and scripts. `after` refuses there.
    void guarded();
  }
}

export interface RecordOptions {
  store?: DocumentStore;
  now?: number;
  /** Write before returning rather than after the response. For the tests. */
  immediate?: boolean;
}

/**
 * Logs a failure and returns the reference to show the trainee.
 *
 * Always also printed, so it reaches the deployment's own logs even if Firestore is the
 * thing that is down.
 */
export async function recordFailure(
  input: DevLogInput,
  options: RecordOptions = {},
): Promise<string> {
  const now = options.now ?? Date.now();
  const key = sameFailureKey(input);
  const previous = recent.get(key);

  console.error(
    `[devlog] ${input.source} ${input.provider} ${input.kind} ${input.status ?? ''} on ${input.route}: ${input.detail.slice(0, 300)}`,
  );

  if (previous && now - previous.at < SAME_FAILURE_MS) {
    const write = async () => {
      await store(options.store).update<DevLogEntry>(DEVLOG, previous.id, (current) => {
        // The first entry is written after its own response, so on a fast repeat it may
        // not exist yet. Throwing abandons this count rather than writing half an entry.
        if (!current) throw new Error('The entry being counted has not been written yet.');
        return { ...current, repeats: current.repeats + 1 };
      });
    };
    if (options.immediate) await write().catch(() => undefined);
    else later(write);
    return previous.id;
  }

  if (recent.size >= MAX_RECENT) recent.clear();
  const id = newRef();
  recent.set(key, { at: now, id });

  const at = new Date(now);
  const client = input.client && withoutUndefined(input.client);
  const entry: DevLogEntry = {
    ...withoutUndefined({
      ...input,
      client: client && Object.keys(client).length > 0 ? client : undefined,
    }),
    detail: input.detail.slice(0, 1000),
    id,
    at: at.toISOString(),
    day: at.toISOString().slice(0, 10),
    repeats: 1,
    expireAt: new Date(now + DEVLOG_RETENTION_DAYS * 86_400_000),
  };
  const write = () => store(options.store).set(DEVLOG, id, entry);
  if (options.immediate) await write().catch(() => undefined);
  else later(write);
  return id;
}

/** Firestore refuses `undefined` fields, so optional ones that are absent are left out. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

/** One day's entries, newest first. */
export async function entriesFor(day: string, options: { store?: DocumentStore } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  const entries = await store(options.store).where<DevLogEntry>(DEVLOG, 'day', day);
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

/** For tests, which need each case to start without remembered failures. */
export function forgetRecentFailures(): void {
  recent.clear();
}
