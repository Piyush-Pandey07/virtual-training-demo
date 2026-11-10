/**
 * The glossary store's refusals, as responses, and the body every glossary route reads.
 *
 * In one place so the routes word a refusal the same way and none of them can forget one
 * and send a 500.
 */

import 'server-only';

import { GlossaryRefused } from './store';

/** A response for a refusal the store threw, or null when it was something else. */
export function glossaryRefusal(error: unknown): Response | null {
  if (error instanceof GlossaryRefused) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}

/** The JSON object sent, or null when there is none. Capped well above any real entry. */
export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > 20_000) return null;
    const body = JSON.parse(text) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
