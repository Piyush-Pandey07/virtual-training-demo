/**
 * What the profile routes and the bulk upload will accept, decided before anything is
 * stored.
 *
 * Every text field here is typed by a participant, or by whoever filled in an upload,
 * and later read by a language model in every session the participant attends. So it is
 * treated the way any other untrusted input that reaches a prompt is: cleaned of anything
 * that is not ordinary text, kept short, and refused rather than guessed at when it does
 * not fit. The prompt renders it again through `cleanText` as well, because a document
 * can reach storage by other routes than these.
 *
 * Pure, with no imports beyond the shared types, so the tests drive it directly and the
 * forms can run the same checks before sending.
 */

import { PROFILE_NOTICE_VERSION } from './notice';
import {
  detailsOf,
  isProficiency,
  type LearnerDetails,
  type LearnerProfileRecord,
  MAX_YEARS_EXPERIENCE,
  missingRequired,
  PROFILE_FIELDS,
  type ProfileFieldSpec,
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

/** Whole or decimal years, as typed: "6", "6.5", "0.5". Nothing else. */
const YEARS = /^\d{1,2}(?:\.\d)?$/;

type FieldValue = string | number;

export type FieldRead = { ok: true; value: FieldValue | null } | { ok: false; error: string };

/**
 * One field's value, cleaned and checked, or why it cannot be kept.
 *
 * Null means empty, which is a fact about the value rather than a refusal: whether an
 * empty required field is acceptable depends on who is asking, and is decided by the
 * caller. A form saving a profile refuses it; an upload keeps the row and asks the
 * participant to finish it.
 */
export function readField(field: ProfileFieldSpec, raw: unknown): FieldRead {
  if (raw === undefined || raw === null) return { ok: true, value: null };

  if (field.kind === 'years') {
    if (typeof raw === 'number') {
      return yearsFrom(field, Number.isFinite(raw) ? String(raw) : 'x');
    }
    if (typeof raw !== 'string') return { ok: false, error: `${field.label} must be a number.` };
    return yearsFrom(field, cleanText(raw));
  }

  if (typeof raw !== 'string') return { ok: false, error: `${field.label} must be text.` };
  const cleaned = cleanText(raw);
  if (!cleaned) return { ok: true, value: null };

  if (field.kind === 'proficiency') {
    const level = cleaned.toLowerCase();
    return isProficiency(level)
      ? { ok: true, value: level }
      : { ok: false, error: `${field.label} must be Beginner, Intermediate or Advanced.` };
  }

  if (cleaned.length > field.max) {
    return { ok: false, error: `${field.label} can be at most ${field.max} characters.` };
  }
  return { ok: true, value: cleaned };
}

function yearsFrom(field: ProfileFieldSpec, text: string): FieldRead {
  if (!text) return { ok: true, value: null };
  const years = Number(text);
  if (!YEARS.test(text) || !Number.isFinite(years) || years > MAX_YEARS_EXPERIENCE) {
    return {
      ok: false,
      error: `${field.label} must be a number of years from 0 to ${MAX_YEARS_EXPERIENCE}.`,
    };
  }
  return { ok: true, value: years };
}

export type DetailsRead = { ok: true; details: LearnerDetails } | { ok: false; error: string };

/**
 * Every field read from one source: a form body keyed on field names, or a CSV row
 * keyed on column names.
 *
 * Only the fields in the list are read, so a stray key in the source, a person id above
 * all, never reaches a stored document. Empty fields are left out of what comes back.
 */
export function readDetails(
  source: Record<string, unknown>,
  keyOf: (field: ProfileFieldSpec) => string = (field) => field.key,
): DetailsRead {
  const details: LearnerDetails = {};
  for (const field of PROFILE_FIELDS) {
    const read = readField(field, source[keyOf(field)]);
    if (!read.ok) return read;
    if (read.value !== null) (details as Record<string, FieldValue>)[field.key] = read.value;
  }
  return { ok: true, details };
}

/** The required fields left empty, as a sentence a form can show. */
export function describeMissing(details: LearnerDetails): string | null {
  const missing = missingRequired(details);
  if (missing.length === 0) return null;
  const labels = missing.map((field) => field.label.toLowerCase());
  const list =
    labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
  return `Fill in ${list}. ${missing.length === 1 ? 'It is' : 'They are'} required.`;
}

/**
 * What a request to agree to the notice, with or without a profile, carries.
 *
 * `details` is null when no profile was sent at all, which is what an administrator or
 * facilitator agreeing to the notice sends.
 */
export interface ConsentSubmission {
  details: LearnerDetails | null;
}

export type ParsedSubmission =
  { ok: true; value: ConsentSubmission } | { ok: false; error: string };

/**
 * Reads a save from the consent page or My profile, or says what is wrong with it.
 *
 * Saving requires the consent box to have been ticked against the notice this server is
 * showing. A request naming another version was made against a notice that has since
 * changed, so the person has not agreed to the current one.
 *
 * A profile, once sent, must be complete: a required field cannot be left empty, and the
 * optional ones can. `profileRequired` says whether one must be sent at all, which it
 * must for a participant agreeing to the notice and for anybody saving My profile.
 */
export function parseSubmission(
  raw: unknown,
  { profileRequired }: { profileRequired: boolean },
): ParsedSubmission {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const body = raw as Record<string, unknown>;

  if (body.consent !== true) {
    return { ok: false, error: 'Tick the box to agree to the privacy notice, then continue.' };
  }
  if (body.consentVersion !== PROFILE_NOTICE_VERSION) {
    return {
      ok: false,
      error: 'The privacy notice has changed. Reload the page and read it again.',
    };
  }

  if (body.profile === undefined || body.profile === null) {
    if (profileRequired) return { ok: false, error: 'Fill in your profile, then continue.' };
    return { ok: true, value: { details: null } };
  }
  if (typeof body.profile !== 'object' || Array.isArray(body.profile)) {
    return { ok: false, error: 'profile must be an object of field names to values.' };
  }

  const read = readDetails(body.profile as Record<string, unknown>);
  if (!read.ok) return read;
  const missing = describeMissing(read.details);
  if (missing) return { ok: false, error: missing };
  return { ok: true, value: { details: read.details } };
}

/**
 * The profile a participant's own save produces.
 *
 * Replaces the details whole, because the forms always send every field: a field left
 * out is a field cleared. Keeps where the profile first came from, so a profile that was
 * uploaded and then confirmed still says so, and marks it confirmed against the notice
 * agreed to just now. A pure function of what it is handed, so the tests drive it.
 */
export function confirmedProfile(
  current: LearnerProfileRecord | undefined,
  details: LearnerDetails,
  personId: string,
  now: string,
): LearnerProfileRecord {
  const next: LearnerProfileRecord = {
    ...detailsOf(details),
    personId,
    source: current?.source === 'upload' ? 'upload' : 'self',
    confirmed: true,
    consent: { version: PROFILE_NOTICE_VERSION, at: now },
    updatedAt: now,
  };
  if (current?.source === 'upload') {
    if (current.uploadedBy) next.uploadedBy = current.uploadedBy;
    if (current.uploadedAt) next.uploadedAt = current.uploadedAt;
  }
  return next;
}

/**
 * The profile an upload produces, or null when the participant's own must be kept.
 *
 * A confirmed profile is the participant's, under a notice they agreed to, and an upload
 * never overwrites it: their organisation's spreadsheet is not a reason to change what
 * they said about themselves. An unconfirmed one is replaced whole, because it is the
 * organisation's own earlier upload and the newer file is the better guess.
 */
export function uploadedProfile(
  current: LearnerProfileRecord | undefined,
  details: LearnerDetails,
  owner: { personId: string; emailKey: string; uploadedBy: string },
  now: string,
): LearnerProfileRecord | null {
  if (current?.confirmed) return null;
  return {
    ...detailsOf(details),
    personId: owner.personId,
    emailKey: owner.emailKey,
    source: 'upload',
    confirmed: false,
    uploadedBy: owner.uploadedBy,
    uploadedAt: now,
    updatedAt: now,
  };
}
