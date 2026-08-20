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
  let apiKey: string;
  try {
    apiKey = requireEnv('DEEPGRAM_API_KEY');
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
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
    return Response.json(
      { error: `Could not reach Deepgram: ${(error as Error).message}` },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    // 401 here almost always means the key lacks Member permissions, which is
    // worth saying rather than leaving the developer to guess.
    const hint =
      upstream.status === 401 || upstream.status === 403
        ? ' Check that DEEPGRAM_API_KEY is correct and has at least Member permissions.'
        : '';
    return Response.json(
      { error: `Deepgram refused the token request (${upstream.status}).${hint} ${detail}`.trim() },
      { status: 502 },
    );
  }

  const grant = (await upstream.json()) as GrantResponse;
  if (!grant.access_token) {
    return Response.json({ error: 'Deepgram returned no access token.' }, { status: 502 });
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
