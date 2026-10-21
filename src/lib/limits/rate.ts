/**
 * How fast one person may call the routes that cost money.
 *
 * Every session calls Gemini, Deepgram and, in Hindi, Sarvam, each billed per use, and
 * nothing stopped one signed-in account calling them as fast as a script could. The
 * monthly session cap counts sessions, not spend, and is unlimited unless a customer
 * has one. A broken client looping, or somebody scripting the API, could run up all
 * three bills in an afternoon.
 *
 * Each limit is a per-minute and a per-hour count, per person, per kind of call, set
 * well above what a real session does. A trainee pressing Next as fast as they can, or
 * asking question after question, never meets one; something calling in a loop does.
 * The calls whose cost grows with their size, speech and listening, are weighed rather
 * than counted, so one long request uses more of the allowance than one short one.
 *
 * Counted in Firestore, because the site runs on many short-lived servers at once and a
 * count held in one of them would let the others through. One small document per person
 * per kind, overwritten as the windows roll. Those documents do accumulate, one for
 * every person and kind that has ever been counted, so each carries an `expireAt` one
 * longest window ahead and Firestore deletes it after that. The deletion only happens
 * once a TTL policy on the `expireAt` field of the `ratelimits` collection group has
 * been enabled in the Firebase console; without it the documents stay, harmlessly but
 * for ever. They are also listed among the collections a customer owns, so a purge
 * removes them with everything else.
 *
 * Fails open on an outage. If the count cannot be read or written, or takes longer than
 * a fraction of a second, the call goes ahead: refusing a trainee mid-session because a
 * counter is unavailable is the worse failure. Contention is not an outage, though. A
 * transaction that loses to others writing the same count is a sign of many calls at
 * once for one person, which is what this exists to stop, so that is a refusal.
 */

import 'server-only';

import { firestoreDocuments } from '../firebase/firestore';
import { orgsConfigured } from '../orgs/registry';
import { scopedDocuments } from '../orgs/scope';
import { InMemoryDocumentStore, type DocumentStore } from '../roster/documents';

export interface RateWindow {
  seconds: number;
  max: number;
}

/**
 * Per person. Measured against what a session really does: a narration turn is one
 * chat call and ten or so speech calls, and a 38 minute deck is a few hundred speech
 * calls in all. The chat minute is the generous one, because the slide buttons are not
 * throttled and every press of Next or Back asks for a new turn, so a trainee clicking
 * through to find their place can make dozens of chat calls in a minute without
 * anything being wrong. The hour behind it is what stops a loop.
 */
export const RATE_LIMITS = {
  chat: [
    { seconds: 60, max: 60 },
    { seconds: 3600, max: 300 },
  ],
  speech: [
    { seconds: 60, max: 150 },
    { seconds: 3600, max: 2500 },
  ],
  listening: [
    { seconds: 60, max: 60 },
    { seconds: 3600, max: 1200 },
  ],
  sample: [
    { seconds: 60, max: 20 },
    { seconds: 3600, max: 100 },
  ],
  token: [
    { seconds: 60, max: 20 },
    { seconds: 3600, max: 200 },
  ],
  analyse: [
    { seconds: 60, max: 60 },
    { seconds: 3600, max: 1500 },
  ],
  openaiTest: [
    { seconds: 60, max: 10 },
    { seconds: 3600, max: 100 },
  ],
} satisfies Record<string, RateWindow[]>;

export type RateKind = keyof typeof RATE_LIMITS;

/** One count per window, keyed by the window's length in seconds. */
export type RateState = Record<string, { start: number; count: number }>;

/**
 * What is stored for one person and one kind of call.
 *
 * The person and kind are written into the document as well as its id, because a purge
 * reads documents back without their keys and has to rebuild the id to delete them.
 * `expireAt` is a `Date` here and a Firestore `Timestamp` once stored, which is the type
 * a TTL policy reads.
 */
export interface StoredRate {
  personId: string;
  kind: RateKind;
  windows: RateState;
  expireAt: Date;
}

export interface RateDecision {
  allowed: boolean;
  /** Seconds until the window that refused this one opens again. */
  retryAfter: number;
  next: RateState;
}

/**
 * A count read back from storage, if it can be trusted.
 *
 * A document written by an older shape of this code, edited by hand, or written with a
 * clock running ahead could hold anything. A count that is not a finite number, or a
 * window that starts in the future, would otherwise refuse somebody for a wait nobody
 * could explain, so it is treated as if nothing had been counted.
 */
function usable(entry: unknown, now: number): { start: number; count: number } | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const { start, count } = entry as { start?: unknown; count?: unknown };
  if (typeof start !== 'number' || typeof count !== 'number') return undefined;
  if (!Number.isFinite(start) || !Number.isFinite(count)) return undefined;
  if (start > now || count < 0) return undefined;
  return { start, count };
}

/**
 * Counts one call against every window, or refuses it.
 *
 * `weight` is how many units the call uses. A refused call is not counted, so somebody
 * who waits is let back in when the window rolls rather than being held out by their
 * own retries.
 */
export function decide(
  state: RateState | undefined,
  windows: RateWindow[],
  now: number,
  weight = 1,
): RateDecision {
  const units = Number.isFinite(weight) && weight > 0 ? Math.ceil(weight) : 1;
  const next: RateState = {};
  let retryAfter = 0;
  for (const window of windows) {
    const key = String(window.seconds);
    const current = usable(state?.[key], now);
    const fresh = !current || now - current.start >= window.seconds * 1000;
    const start = fresh ? now : current.start;
    const count = fresh ? 0 : current.count;
    // A single call heavier than the whole window could never be let in, however long
    // its sender waited, so it is charged as the whole window and no more.
    if (count + Math.min(units, window.max) > window.max) {
      retryAfter = Math.max(retryAfter, Math.ceil((start + window.seconds * 1000 - now) / 1000));
    }
    next[key] = { start, count };
  }
  if (retryAfter > 0) return { allowed: false, retryAfter, next };
  for (const window of windows) {
    const key = String(window.seconds);
    next[key] = { ...next[key]!, count: next[key]!.count + Math.min(units, window.max) };
  }
  return { allowed: true, retryAfter: 0, next };
}

const fallback = new InMemoryDocumentStore();
const RATES = 'ratelimits';

/**
 * How long a count may take before the call goes ahead uncounted.
 *
 * Every call that costs money waits on this, and speech is asked for sentence by
 * sentence while the trainee listens. A slow count is worse than a missed one.
 */
const BUDGET_MS = 800;

/**
 * Firestore retries a contended transaction five times by default, each after a
 * backoff, which is seconds rather than milliseconds. Two attempts is enough to ride
 * out an ordinary collision and gives up quickly on a real pile-up.
 */
const MAX_ATTEMPTS = 2;

/**
 * Who this process has recently refused, and until when.
 *
 * Somebody calling in a loop goes on calling after the first refusal, and each of those
 * calls would otherwise be another Firestore transaction on the same document, the
 * contention that made the first one slow. Held per server, so it only ever adds
 * refusals the shared count already made. `weight` is the lightest call refused: until
 * the window rolls, that count can only grow, so anything at least as heavy is refused
 * too, while a lighter call that might still fit goes on to the real count.
 */
const blockedUntil = new Map<string, { until: number; weight: number }>();

/** Enough for every person on a busy server several times over, and still small. */
const MAX_BLOCKED = 10_000;

function block(key: string, until: number, weight: number): void {
  // Cleared rather than evicted one by one. Losing the whole map costs nothing but a
  // few more trips to Firestore, which is where every decision is really made.
  if (blockedUntil.size >= MAX_BLOCKED) blockedUntil.clear();
  const existing = blockedUntil.get(key);
  if (existing && existing.until > Date.now() && existing.weight < weight) return;
  blockedUntil.set(key, { until, weight });
}

function documents(store: DocumentStore | undefined, orgId: string): DocumentStore {
  return scopedDocuments(store ?? (orgsConfigured() ? firestoreDocuments() : fallback), orgId);
}

/**
 * Whether a transaction failed because others kept writing the same document.
 *
 * gRPC reports that as ABORTED, code 10, and the REST transport as HTTP 409.
 */
function contended(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 10 || code === 409 || code === 'aborted' || code === 'ABORTED';
}

function waitFor(seconds: number): string {
  if (seconds < 90) return seconds === 1 ? '1 second' : `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

function refusal(retryAfter: number): Response {
  return Response.json(
    {
      error: `That is more requests than this needs in a short time, so it has been paused. Try again in ${waitFor(retryAfter)}.`,
    },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

export interface RateOptions {
  /** How long to wait for the count before letting the call through. */
  budgetMs?: number;
  /** The store to count in, before it is scoped to the organisation. For the tests. */
  store?: DocumentStore;
}

/**
 * A refusal to send back, or null to carry on.
 *
 * The decision is made inside the transaction and read back out of it, so two calls
 * landing together are both counted, and only one of them can take the last slot.
 *
 * Counted in the person's own organisation. Technavious staff looking inside a
 * customer act in that customer's organisation, and counting them there would give
 * them a fresh allowance in every customer they opened.
 */
export async function rateLimited(
  person: { id: string; orgId: string; homeOrgId?: string },
  kind: RateKind,
  weight = 1,
  options: RateOptions = {},
): Promise<Response | null> {
  const windows = RATE_LIMITS[kind];
  const orgId = person.homeOrgId ?? person.orgId;
  const key = `${orgId}/${person.id}/${kind}`;

  const blocked = blockedUntil.get(key);
  if (blocked) {
    const now = Date.now();
    if (now >= blocked.until) blockedUntil.delete(key);
    else if (weight >= blocked.weight) return refusal(Math.ceil((blocked.until - now) / 1000));
  }

  const longest = Math.max(...windows.map((window) => window.seconds));
  let decision: RateDecision | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const counted = documents(options.store, orgId).update<StoredRate>(
      RATES,
      `${person.id}__${kind}`,
      (current) => {
        const now = Date.now();
        decision = decide(current?.windows, windows, now, weight);
        return {
          personId: person.id,
          kind,
          windows: decision.next,
          expireAt: new Date(now + longest * 1000),
        };
      },
      { maxAttempts: MAX_ATTEMPTS },
    );
    // Left to finish on its own if the budget runs out first, and its failure then has
    // nobody to report to, so it is swallowed rather than left unhandled.
    counted.catch(() => undefined);

    const timedOut = new Promise<'timed out'>((resolve) => {
      timer = setTimeout(() => resolve('timed out'), options.budgetMs ?? BUDGET_MS);
    });
    const outcome = await Promise.race([counted.then(() => 'counted' as const), timedOut]);
    if (outcome === 'timed out') return null;
  } catch (error) {
    if (contended(error)) return refusal(1);
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!decision || decision.allowed) return null;
  block(key, Date.now() + decision.retryAfter * 1000, weight);
  return refusal(decision.retryAfter);
}
