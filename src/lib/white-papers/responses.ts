/**
 * The white paper store's refusals, as responses, and the body its routes read.
 *
 * In one place so the routes word a refusal the same way and none of them can forget one
 * and send a 500.
 */

import 'server-only';

import { WhitePaperError } from './store';

/** A response for a refusal the store threw, or null when it was something else. */
export function whitePaperRefusal(error: unknown): Response | null {
  if (error instanceof WhitePaperError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}

/**
 * Room for a paper's text and the JSON around it. The store refuses anything over its
 * own character limit with a message worth reading; this only stops a body nobody
 * should be sending at all.
 */
const MAX_BODY = 2_000_000;

/** The JSON object sent, or null when there is none or it is far too large. */
export async function readPaperBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return null;
    const body = JSON.parse(text) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export const notFound = () => Response.json({ error: 'Not found.' }, { status: 404 });
