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
import { deckStore, listDecks } from '@/lib/decks/registry';
import { rosterStore } from '@/lib/roster/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export interface HealthResponse {
  /** True when every variable the app needs is present. */
  ready: boolean;
  /** Names of the variables that are missing, for whoever deployed it. */
  missing: string[];
  /** Non-secret configuration, useful for confirming what is actually deployed. */
  models: {
    narration: string;
    answering: string;
    speechToText: string;
    textToSpeech: string;
  };
  /**
   * Which deck store is in use, and how many decks it holds.
   *
   * Worth reporting because the store is chosen from the environment and falls
   * back silently. A deployment that intended blob storage and is quietly serving
   * the built-in deck read-only looks identical from the outside otherwise, which
   * is exactly the class of thing this endpoint exists to catch.
   */
  decks: {
    store: 'blob' | 'filesystem' | 'seeded';
    writable: boolean;
    count: number;
    /**
     * Why the store could not be read, when it could not be.
     *
     * This used to be swallowed, and a store that was failing looked exactly like
     * a store that was empty. Diagnosing a deployment is the entire purpose of
     * this endpoint, so the reason is reported.
     */
    error?: string;
  };
  /**
   * Which roster tier is in use, and how many people are in it.
   *
   * Added after a deployment moved itself from blob storage to Firestore and there
   * was no way to see that it had. The people simply appeared to be gone, and the
   * only reported store was the deck one, which had not changed. A tier that swaps
   * underneath a running deployment is exactly the class of thing this endpoint
   * exists to make visible.
   */
  roster: {
    store: 'firestore' | 'blob' | 'filesystem' | 'none';
    writable: boolean;
    people: number;
    error?: string;
  };
}

function isSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export async function GET() {
  const required = ['GEMINI_API_KEY', 'DEEPGRAM_API_KEY'];
  const missing = required.filter((name) => !isSet(name));

  const store = deckStore();
  // A storage failure must not take the readiness check down with it, since the
  // whole point is to report what is wrong. It is reported, not swallowed.
  let deckError: string | undefined;
  const decks = await listDecks().catch((error: unknown) => {
    deckError = error instanceof Error ? error.message : 'unknown storage failure';
    return [];
  });

  const roster = rosterStore();
  let rosterError: string | undefined;
  const people = await roster.listPeople().catch((error: unknown) => {
    rosterError = error instanceof Error ? error.message : 'unknown storage failure';
    return [];
  });

  const body: HealthResponse = {
    ready: missing.length === 0,
    missing,
    models: {
      narration: GEMINI_MODEL(),
      answering: GEMINI_ANSWER_MODEL(),
      speechToText: DEEPGRAM_STT_MODEL(),
      textToSpeech: DEEPGRAM_TTS_MODEL(),
    },
    decks: {
      store: store.kind,
      writable: store.writable,
      count: decks.length,
      ...(deckError ? { error: deckError } : {}),
    },
    roster: {
      store: roster.kind,
      writable: roster.writable,
      people: people.length,
      ...(rosterError ? { error: rosterError } : {}),
    },
  };

  return Response.json(body, {
    // A stale answer here is worse than no answer, since the whole point is to
    // reflect the environment as it is right now.
    headers: { 'Cache-Control': 'no-store' },
  });
}
