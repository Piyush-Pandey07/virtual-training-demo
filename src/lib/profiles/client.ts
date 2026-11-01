/**
 * The browser's side of /api/profile.
 *
 * Sends only what the form holds and the notice version it showed, and never a person
 * id: the route takes the person from the session, and a body naming one would be a
 * body that could name somebody else.
 */

import { PROFILE_NOTICE_VERSION } from './notice';
import type { ExpertiseLevel, LearnerDetails, LearnerProfileRecord } from './types';

export interface ProfileSave {
  details?: { [K in keyof LearnerDetails]?: string | null };
  expertise?: Record<string, ExpertiseLevel | null>;
}

export type ProfileResult =
  { ok: true; profile: LearnerProfileRecord | null } | { ok: false; error: string };

async function readResult(response: Response): Promise<ProfileResult> {
  const body = (await response.json().catch(() => null)) as {
    profile?: LearnerProfileRecord | null;
    error?: string;
  } | null;
  if (!response.ok) {
    return { ok: false, error: body?.error ?? 'Your profile could not be saved. Try again.' };
  }
  return { ok: true, profile: body?.profile ?? null };
}

export async function saveProfile(save: ProfileSave, consented: boolean): Promise<ProfileResult> {
  try {
    const response = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...save.details,
        expertise: save.expertise,
        consent: consented,
        consentVersion: PROFILE_NOTICE_VERSION,
      }),
    });
    return await readResult(response);
  } catch {
    return { ok: false, error: 'Your profile could not be saved. Check your connection.' };
  }
}

export async function deleteProfile(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch('/api/profile', { method: 'DELETE' });
    if (response.ok) return { ok: true };
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? 'Your profile could not be deleted. Try again.' };
  } catch {
    return { ok: false, error: 'Your profile could not be deleted. Check your connection.' };
  }
}
