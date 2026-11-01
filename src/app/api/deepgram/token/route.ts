/**
 * POST /api/deepgram/token
 *
 * Mints a short-lived Deepgram token so the browser can open a live
 * transcription socket without ever seeing the account API key.
 *
 * Deepgram's /v1/auth/grant returns a JWT that only has to be valid for the
 * initial WebSocket handshake. The socket then stays open on its own.
 */

import { DEEPGRAM_STT_MODEL, DEEPGRAM_TOKEN_TTL, requireEnv } from '@/lib/config';
import type { DeepgramTokenResponse } from '@/lib/types';

import { checkUser } from '@/lib/auth/guard';
import { classifyHttp, classifyThrown, type ProviderFailure } from '@/lib/failures/classify';
import { failurePayload } from '@/lib/failures/respond';
import { rateLimited } from '@/lib/limits/rate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A single upstream call that either works quickly or not at all. */
export const maxDuration = 15;

const GRANT_URL = 'https://api.deepgram.com/v1/auth/grant';

interface GrantResponse {
  access_token?: string;
  expires_in?: number;
}

export async function POST() {
  // This mints a real Deepgram credential. It was callable by anybody who found the
  // URL, which made it the sharpest hole in the app: no body, no context, a live
  // upstream token to whoever asked.
  const gate = await checkUser();
  if (!gate.ok) return gate.response;

  const limited = await rateLimited(gate.person, 'token');
  if (limited) return limited;

  /**
   * A refusal the browser can act on.
   *
   * Most failures here only mean live transcription is unavailable, and the browser
   * falls back to sending speech in short bursts through /api/stt, which uses the same
   * key. A missing key is different: that route would fail the same way, so `fatal`
   * tells the browser to say so rather than fall back to something that cannot work.
   */
  const refuse = async (failure: ProviderFailure) =>
    Response.json(
      {
        ...(await failurePayload(failure, { route: '/api/deepgram/token', person: gate.person })),
        fatal: failure.kind === 'not_configured',
      },
      { status: 502 },
    );

  let apiKey: string;
  try {
    apiKey = requireEnv('DEEPGRAM_API_KEY');
  } catch (error) {
    return refuse(classifyThrown('deepgram', error));
  }

  const ttl = DEEPGRAM_TOKEN_TTL();

  let upstream: Response;
  try {
    upstream = await fetch(GRANT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl_seconds: ttl }),
      cache: 'no-store',
    });
  } catch (error) {
    return refuse({ provider: 'deepgram', kind: 'unreachable', detail: (error as Error).message });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    // A 401 here almost always means the key lacks Member permissions, which the log
    // says rather than leaving the developer to guess.
    const failure = classifyHttp('deepgram', upstream.status, detail);
    if (failure.kind === 'bad_key') {
      failure.detail = `The key may lack Member permissions, which minting tokens needs. ${detail}`;
    }
    return refuse(failure);
  }

  const grant = (await upstream.json()) as GrantResponse;
  if (!grant.access_token) {
    return refuse({
      provider: 'deepgram',
      kind: 'bad_output',
      detail: 'No access token returned.',
    });
  }

  const payload: DeepgramTokenResponse = {
    token: grant.access_token,
    expiresIn: grant.expires_in ?? ttl,
    // A JWT pairs with the Bearer scheme. The client mirrors this into the
    // WebSocket subprotocol, which is how Deepgram accepts auth in a browser.
    scheme: 'bearer',
    model: DEEPGRAM_STT_MODEL(),
  };

  return Response.json(payload, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
