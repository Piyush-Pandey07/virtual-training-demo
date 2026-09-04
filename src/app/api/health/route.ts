/**
 * GET /api/health
 *
 * Reports whether the deployment is configured, without disclosing anything.
 *
 * This exists because of how the failure looked on a hosted deployment with a
 * missing environment variable: the trainee clicked start, granted microphone
 * access, and only then got an error. Checking first means the problem is on
 * screen before anyone is asked for their microphone, and it gives whoever
 * deployed it a single URL to confirm the variables landed.
 *
 * Only booleans and non-secret model names are returned. Never a key, never a
 * prefix of a key, and no upstream calls, so the endpoint is safe to leave public
 * and cannot be used to probe the account.
 */

import {
  DEEPGRAM_STT_MODEL,
  DEEPGRAM_TTS_MODEL,
  GEMINI_ANSWER_MODEL,
  GEMINI_MODEL,
} from '@/lib/config';
import { platformAdminEmails } from '@/lib/auth/roles';
import { deckStorage } from '@/lib/decks/registry';
import { rosterStorage } from '@/lib/roster/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export interface HealthResponse {
  /** True when every variable the app needs is present. */
  ready: boolean;
  /** Names of the variables that are missing, for whoever deployed it. */
  missing: string[];
  /**
   * Which variable the platform administrator list came from, and how many entries
   * parsed out of it.
   *
   * Names and a count, never an address. This exists because a mis-scoped or unsaved
   * environment variable looks exactly like a working one from the outside: the list
   * still resolves through the legacy fallback, the site still works, and the only
   * visible symptom is one person quietly not having access they were promised.
   * Diagnosing that from the outside took several deploys and a lot of guessing.
   *
   * `source` says which of the two names was actually read. `count` says how many
   * addresses survived splitting on commas, which is what catches a value pasted
   * across two lines: two addresses that parse as one entry report a count of 1.
   */
  admins: {
    source: 'PLATFORM_ADMIN_EMAILS' | 'AUTH_ADMIN_EMAILS' | 'none';
    count: number;
  };
  /** Non-secret configuration, useful for confirming what is actually deployed. */
  models: {
    narration: string;
    answering: string;
    speechToText: string;
    textToSpeech: string;
  };
  /**
   * Which deck store is in use.
   *
   * Worth reporting because the store is chosen from the environment and falls
   * back silently. A deployment that intended blob storage and is quietly serving
   * the built-in deck read-only looks identical from the outside otherwise, which
   * is exactly the class of thing this endpoint exists to catch.
   *
   * It used to report a count as well. That was a useful operational number while
   * there was one company, and became an anonymous endpoint telling whoever asked
   * how many customers this deployment has and how much they hold. There is also no
   * organisation to count on behalf of here: this endpoint has no session.
   */
  decks: {
    store: 'documents' | 'blob' | 'filesystem' | 'seeded';
    writable: boolean;
  };
  /**
   * Which roster tier is in use.
   *
   * Added after a deployment moved itself from blob storage to Firestore and there
   * was no way to see that it had. The people simply appeared to be gone, and the
   * only reported store was the deck one, which had not changed. A tier that swaps
   * underneath a running deployment is exactly the class of thing this endpoint
   * exists to make visible.
   *
   * The head count is gone for the same reason the deck count is.
   */
  roster: {
    store: 'blob' | 'filesystem' | 'firestore' | 'none';
    writable: boolean;
  };
}

function isSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export async function GET() {
  const required = ['GEMINI_API_KEY', 'DEEPGRAM_API_KEY'];
  const missing = required.filter((name) => !isSet(name));

  // Storage is reported as a capability rather than as contents.
  //
  // It used to count every deck and every person in the deployment. With one company
  // that was a useful ops number; with customers it is an anonymous endpoint telling
  // whoever asks how many customers there are and how big they are. There is also no
  // organisation to count on behalf of here, this endpoint having no session.
  const store = deckStorage();
  const roster = rosterStorage();

  // Which name is in play, decided the same way `platformAdminEmails` decides it, so
  // this cannot drift into reporting one thing while the app reads another.
  const adminSource = process.env.PLATFORM_ADMIN_EMAILS
    ? 'PLATFORM_ADMIN_EMAILS'
    : process.env.AUTH_ADMIN_EMAILS
      ? 'AUTH_ADMIN_EMAILS'
      : 'none';

  const body: HealthResponse = {
    ready: missing.length === 0,
    missing,
    admins: { source: adminSource, count: platformAdminEmails().size },
    models: {
      narration: GEMINI_MODEL(),
      answering: GEMINI_ANSWER_MODEL(),
      speechToText: DEEPGRAM_STT_MODEL(),
      textToSpeech: DEEPGRAM_TTS_MODEL(),
    },
    decks: {
      store: store.kind,
      writable: store.writable,
    },
    roster: {
      store: roster.kind,
      writable: roster.writable,
    },
  };

  return Response.json(body, {
    // A stale answer here is worse than no answer, since the whole point is to
    // reflect the environment as it is right now.
    headers: { 'Cache-Control': 'no-store' },
  });
}
