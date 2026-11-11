/**
 * The browser's side of the consent, profile and upload routes.
 *
 * Sends only what the form holds and the notice version it showed, and never a person
 * id: the routes take the person from the session, and a body naming one would be a body
 * that could name somebody else.
 */

import { PROFILE_NOTICE_VERSION } from './notice';
import { PROFILE_FIELDS, type ProfileField } from './types';
import type { UploadResult, UploadSummary } from './upload';

/** What a profile form holds: every field as typed, the number of years included. */
export type ProfileFormValues = Partial<Record<ProfileField, string>>;

/** A stored profile as the strings a form holds. Safe on the server as well. */
export function formValuesOf(details: object | null | undefined): ProfileFormValues {
  const values: ProfileFormValues = {};
  if (!details) return values;
  for (const field of PROFILE_FIELDS) {
    const value = (details as Record<string, unknown>)[field.key];
    if (typeof value === 'string' || typeof value === 'number') values[field.key] = String(value);
  }
  return values;
}

export type Outcome = { ok: true } | { ok: false; error: string };

async function outcome(response: Response, fallback: string): Promise<Outcome> {
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return { ok: false, error: body?.error ?? fallback };
}

/** Every field, an empty one as null, so clearing a box clears it. */
function cleaned(values: ProfileFormValues): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value?.trim() ? value : null]),
  );
}

/**
 * Agrees to the notice, with the profile for a participant, or without one for an
 * administrator or a facilitator.
 */
export async function giveConsent(profile: ProfileFormValues | null): Promise<Outcome> {
  try {
    const response = await fetch('/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: profile ? cleaned(profile) : null,
        consent: true,
        consentVersion: PROFILE_NOTICE_VERSION,
      }),
    });
    return await outcome(response, 'Your agreement could not be saved. Try again.');
  } catch {
    return { ok: false, error: 'Your agreement could not be saved. Check your connection.' };
  }
}

export async function saveProfile(
  profile: ProfileFormValues,
  consented: boolean,
): Promise<Outcome> {
  try {
    const response = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: cleaned(profile),
        consent: consented,
        consentVersion: PROFILE_NOTICE_VERSION,
      }),
    });
    return await outcome(response, 'Your profile could not be saved. Try again.');
  } catch {
    return { ok: false, error: 'Your profile could not be saved. Check your connection.' };
  }
}

/** Withdraws consent: the profile is deleted and the withdrawal recorded. */
export async function withdrawConsent(): Promise<Outcome> {
  try {
    const response = await fetch('/api/profile', { method: 'DELETE' });
    return await outcome(response, 'Your consent could not be withdrawn. Try again.');
  } catch {
    return { ok: false, error: 'Your consent could not be withdrawn. Check your connection.' };
  }
}

export type UploadReply =
  { ok: true; results: UploadResult[]; summary: UploadSummary } | { ok: false; error: string };

/** Sends the file as it is. The server reads and checks it; nothing is trusted here. */
export async function uploadParticipants(file: Blob): Promise<UploadReply> {
  try {
    const response = await fetch('/api/profiles/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: file,
    });
    const body = (await response.json().catch(() => null)) as {
      results?: UploadResult[];
      summary?: UploadSummary;
      error?: string;
    } | null;
    if (!response.ok || !body?.results || !body.summary) {
      return { ok: false, error: body?.error ?? 'The file could not be uploaded. Try again.' };
    }
    return { ok: true, results: body.results, summary: body.summary };
  } catch {
    return { ok: false, error: 'The file could not be uploaded. Check your connection.' };
  }
}
