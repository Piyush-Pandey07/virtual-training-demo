/**
 * What the profile route will accept, decided before anything is stored.
 *
 * Every text field here is typed by a participant and later read by a language model,
 * in every session they attend. So it is treated the way any other untrusted input that
 * reaches a prompt is: cleaned of anything that is not ordinary text, kept short, and
 * refused rather than guessed at when it does not fit. The prompt renders it again
 * through `cleanText` as well, because a document can reach storage by other routes
 * than this one.
 *
 * Pure, with no imports beyond the shared types, so the tests drive it directly.
 */

import { PROFILE_NOTICE_VERSION } from './notice';
import {
  type ExpertiseLevel,
  isExpertiseLevel,
  type LearnerDetails,
  type LearnerProfileRecord,
  MAX_EXPERTISE_ENTRIES,
  PERSONAL_FIELDS,
} from './types';

/**
 * Control characters, and the two Unicode line and paragraph separators.
 *
 * Turned into spaces rather than removed, so "Pune\nMumbai" becomes two words and not
 * one. A line break is the main thing worth taking out: inside a prompt it is how a
 * value would pretend to be a new heading or a new instruction.
 */
const CONTROL = /[\p{Cc}\u2028\u2029]/gu;

/**
 * Characters that change how text is displayed without being visible themselves:
 * bidirectional overrides and isolates, zero-width spaces, and the byte order mark.
 *
 * Removed outright. They are how text is made to read one way on screen and another to
 * a model. The zero-width joiner and non-joiner are kept, because Devanagari and other
 * Indian scripts use them to shape ordinary words.
 */
const INVISIBLE = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** Ordinary text out of whatever was typed: one line, single spaces, trimmed. */
export function cleanText(value: string): string {
  return value
    .normalize('NFC')
    .replace(CONTROL, ' ')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The shape a deck id takes, the same rule the deck store enforces.
 *
 * Repeated rather than imported, because the deck store is server-only and this file
 * is not. A key that could not be a deck id is refused, so it cannot become a strange
 * field name in a stored document.
 */
const DECK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isUsableDeckKey(value: string): boolean {
  return DECK_ID.test(value);
}

/**
 * A change to somebody's profile, as the form sends it.
 *
 * A personal field that is absent is left as it is, and one sent empty is cleared. An
 * expertise entry set to null is removed. That lets the lobby send only what it asked
 * about without wiping what the person filled in on their profile page.
 */
export interface ProfileChange {
  details: { [K in keyof LearnerDetails]?: string | null };
  expertise: Record<string, ExpertiseLevel | null>;
}

export type Parsed = { ok: true; change: ProfileChange } | { ok: false; error: string };

/**
 * Reads a save request, or says what is wrong with it.
 *
 * Saving requires the consent box to have been ticked against the notice this server
 * is showing. A request naming another version was made against a notice that has
 * since changed, so the person has not agreed to the current one.
 */
export function parseProfileChange(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const body = raw as Record<string, unknown>;

  if (body.consent !== true) {
    return { ok: false, error: 'Tick the box to agree to how your profile is used, then save.' };
  }
  if (body.consentVersion !== PROFILE_NOTICE_VERSION) {
    return {
      ok: false,
      error:
        'The notice about how profiles are used has changed. Reload the page and read it again.',
    };
  }

  const details: ProfileChange['details'] = {};
  for (const field of PERSONAL_FIELDS) {
    const value = body[field.key];
    if (value === undefined) continue;
    if (value === null) {
      details[field.key] = null;
      continue;
    }
    if (typeof value !== 'string') {
      return { ok: false, error: `${field.label} must be text.` };
    }
    const cleaned = cleanText(value);
    if (cleaned.length > field.max) {
      return {
        ok: false,
        error: `${field.label} can be at most ${field.max} characters.`,
      };
    }
    details[field.key] = cleaned || null;
  }

  const expertise: ProfileChange['expertise'] = {};
  if (body.expertise !== undefined) {
    if (!body.expertise || typeof body.expertise !== 'object' || Array.isArray(body.expertise)) {
      return { ok: false, error: 'expertise must be an object of course ids to levels.' };
    }
    const entries = Object.entries(body.expertise as Record<string, unknown>);
    if (entries.length > MAX_EXPERTISE_ENTRIES) {
      return { ok: false, error: 'That is more courses than one profile can hold.' };
    }
    for (const [deckId, level] of entries) {
      if (!isUsableDeckKey(deckId)) {
        return { ok: false, error: `"${deckId.slice(0, 70)}" is not a course id.` };
      }
      if (level === null) {
        expertise[deckId] = null;
        continue;
      }
      if (!isExpertiseLevel(level)) {
        return { ok: false, error: 'That is not one of the experience levels on offer.' };
      }
      expertise[deckId] = level;
    }
  }

  return { ok: true, change: { details, expertise } };
}

/**
 * The profile a change produces, or null when nothing would be left in it.
 *
 * A pure function of what it is handed, because the store runs it inside a transaction
 * that may retry it. Nothing left means the document is deleted rather than kept empty:
 * a record that somebody agreed to a notice and told us nothing is not worth holding.
 */
export function applyChange(
  current: LearnerProfileRecord | undefined,
  change: ProfileChange,
  personId: string,
  now: string,
): LearnerProfileRecord | null {
  const next: LearnerProfileRecord = {
    personId,
    expertise: { ...(current?.expertise ?? {}) },
    consent: { version: PROFILE_NOTICE_VERSION, at: now },
    updatedAt: now,
  };

  for (const field of PERSONAL_FIELDS) {
    const changed = change.details[field.key];
    const value = changed === undefined ? current?.[field.key] : changed;
    if (value) next[field.key] = value;
  }

  for (const [deckId, level] of Object.entries(change.expertise)) {
    if (level === null) delete next.expertise[deckId];
    else next.expertise[deckId] = level;
  }

  // Checked after merging, so a client cannot grow a profile past the cap a few
  // entries at a time.
  if (Object.keys(next.expertise).length > MAX_EXPERTISE_ENTRIES) {
    throw new ProfileTooLarge();
  }

  const empty =
    Object.keys(next.expertise).length === 0 && PERSONAL_FIELDS.every((field) => !next[field.key]);
  return empty ? null : next;
}

export class ProfileTooLarge extends Error {
  constructor() {
    super('That is more courses than one profile can hold.');
  }
}
