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
}

function isSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export async function GET() {
  const required = ['GEMINI_API_KEY', 'DEEPGRAM_API_KEY'];
  const missing = required.filter((name) => !isSet(name));

  const body: HealthResponse = {
    ready: missing.length === 0,
    missing,
    models: {
      narration: GEMINI_MODEL(),
      answering: GEMINI_ANSWER_MODEL(),
      speechToText: DEEPGRAM_STT_MODEL(),
      textToSpeech: DEEPGRAM_TTS_MODEL(),
    },
  };

  return Response.json(body, {
    // A stale answer here is worse than no answer, since the whole point is to
    // reflect the environment as it is right now.
    headers: { 'Cache-Control': 'no-store' },
  });
}
