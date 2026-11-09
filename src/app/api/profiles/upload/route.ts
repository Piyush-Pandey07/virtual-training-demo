/**
 * POST /api/profiles/upload
 *
 * The bulk participant upload (BRD v2.3, AI-28). The body is the CSV file itself, as the
 * template lays it out. Each row creates or finds the person in the uploader's own
 * organisation, as a participant, and stores their profile prefilled and unconfirmed.
 * The answer is a result for every row: created, updated, or rejected with the reason.
 *
 * For the administrator, a company administrator and a facilitator; a 404 for anybody
 * else, and for anybody PROFILES_ENABLED leaves out, or whose organisation it does.
 *
 * Nothing in the file is trusted. The body is read with a byte cap however long the
 * request claims to be, decoded strictly as UTF-8, and every row goes through the same
 * checks as the profile form. The organisation is the uploader's, never a column.
 */

import { checkUser } from '@/lib/auth/guard';
import { profilesEnabled, profilesEnabledFor, profilesEnabledInOrg } from '@/lib/config';
import { mayUploadParticipants } from '@/lib/profiles/access';
import { MAX_UPLOAD_BYTES, readUpload } from '@/lib/profiles/csv';
import { notFound, reply, signedOut } from '@/lib/profiles/responses';
import { importParticipants, summarise } from '@/lib/profiles/upload';
import { rosterStore } from '@/lib/roster/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A thousand rows, eight at a time, is well inside this. */
export const maxDuration = 60;

/**
 * The body, or null once it passes the cap.
 *
 * Read in chunks and counted, rather than trusting Content-Length, which the sender
 * writes. A body over the cap is abandoned as soon as it is known to be, without holding
 * the rest of it in memory.
 */
async function readCapped(request: Request, cap: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

export async function POST(request: Request) {
  if (!profilesEnabled()) return notFound();
  const gate = await checkUser();
  if (!gate.ok) return signedOut(gate.response);
  const uploader = gate.person;
  if (
    !profilesEnabledFor(uploader) ||
    !profilesEnabledInOrg(uploader.orgId) ||
    !mayUploadParticipants(uploader)
  ) {
    return notFound();
  }

  const roster = rosterStore(uploader.orgId);
  if (!roster.writable) {
    return reply({ error: 'There is nowhere to save people on this deployment.' }, 503);
  }

  const bytes = await readCapped(request, MAX_UPLOAD_BYTES);
  if (!bytes) {
    return reply(
      { error: `The file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024)} KB. Split it.` },
      413,
    );
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return reply(
      { error: 'The file is not UTF-8. In Excel, save it as "CSV UTF-8 (comma delimited)".' },
      400,
    );
  }

  const read = readUpload(text);
  if (!read.ok) return reply({ error: read.error }, 400);

  const results = await importParticipants(uploader, read.rows, { roster });
  return reply({ results, summary: summarise(results) });
}
