/**
 * POST /api/report
 *
 * The browser telling the developer log what went wrong on its side.
 *
 * Most failures the trainee meets never reach our server: the connection drops, a
 * request times out, live transcription closes. Those are exactly the ones behind "the
 * voice dropped mid-session", and until now nothing recorded them, so a report from a
 * tester came with no evidence at all. The browser sends what it saw here once it can,
 * with what it knows about its connection, and the platform's error page shows it beside
 * the server's own failures.
 *
 * Signed-in people only, rate limited, and every field is capped and checked, because
 * the body comes from the browser and ends up on a staff screen.
 */

import { checkUser } from '@/lib/auth/guard';
import { isFailureCode } from '@/lib/failures/codes';
import { recordFailure } from '@/lib/failures/devlog';
import { rateLimited } from '@/lib/limits/rate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/** What the browser was doing. Anything else is refused rather than logged. */
const AREAS = ['speech', 'narration', 'listening', 'live-listening', 'sample'] as const;

/** Printable text only, trimmed and capped, so a report cannot smuggle markup or noise. */
function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

export async function POST(request: Request) {
  const gate = await checkUser();
  if (!gate.ok) return gate.response;

  const limited = await rateLimited(gate.person, 'report');
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'The report must be JSON.' }, { status: 400 });
  }

  const area = clean(body.area, 40);
  if (!area || !(AREAS as readonly string[]).includes(area)) {
    return Response.json({ error: 'Unknown area.' }, { status: 400 });
  }
  const code = isFailureCode(body.code) ? body.code : 'connection';

  const ref = await recordFailure({
    source: 'browser',
    provider: area,
    kind: clean(body.kind, 40) ?? 'unknown',
    code,
    detail: clean(body.detail, 500) ?? '',
    route: clean(body.page, 80) ?? '/session',
    orgId: gate.person.orgId,
    personId: gate.person.id,
    deckId: clean(body.deckId, 80),
    language: clean(body.language, 8),
    client: {
      userAgent: clean(request.headers.get('user-agent'), 200),
      network: clean(body.network, 120),
    },
  });

  return Response.json({ ref });
}
