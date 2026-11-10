/**
 * What a learner tells the trainer about themselves, and the shape it is kept in.
 *
 * Types and constants only, with no imports, so the profile forms in the browser, the
 * routes that validate them and the bulk upload all read the same list of fields, the
 * same caps and the same levels. A cap the form enforced and the server did not, or the
 * other way round, would be a form that lies about what it will accept.
 *
 * The fields are BRD v2.3 AI-05. Five are required, because a participant cannot attend
 * without them, and five are optional and can be skipped. They are a list rather than
 * code: adding one is an entry in `PROFILE_FIELDS` and a property on `LearnerDetails`,
 * and the forms, the validation, the CSV template, the read-only view and the trainer's
 * prompt all walk the list.
 *
 * Everything here is gated by PROFILES_ENABLED. See `profilesEnabledFor` in config.ts.
 */

/**
 * How much a participant says they already know.
 *
 * For information only (AI-07). The trainer's depth follows the assessment level, which
 * is measured; this is what the participant said, which is not. Three plain steps rather
 * than a scale, because a participant and a facilitator should read it the same way.
 */
export const PROFICIENCY_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

export type Proficiency = (typeof PROFICIENCY_LEVELS)[number];

export const PROFICIENCY_LABELS: Record<Proficiency, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export function isProficiency(value: unknown): value is Proficiency {
  return typeof value === 'string' && (PROFICIENCY_LEVELS as readonly string[]).includes(value);
}

/** The most years of experience accepted. Anything above is a typing mistake. */
export const MAX_YEARS_EXPERIENCE = 60;

/** Everything a profile can hold about the person, as stored. */
export interface LearnerDetails {
  name?: string;
  /** Degree and stream, as "B.E., Electrical". */
  education?: string;
  /** Total years of working experience. Whole or half years. */
  yearsExperience?: number;
  department?: string;
  proficiency?: Proficiency;
  city?: string;
  /** The college or university, which is optional where the degree is not. */
  studiedAt?: string;
  interests?: string;
  hobbies?: string;
  /** Short free text, as "HVAC 4 years, electrical 2 years". */
  experienceByArea?: string;
}

export type ProfileField = keyof LearnerDetails;

interface FieldSpecBase {
  key: ProfileField;
  /** The label on the form, and how a refusal names the field. */
  label: string;
  /** A hint under the label, saying what it is for. */
  hint: string;
  /** The column in the bulk upload CSV. */
  column: string;
  required: boolean;
  /**
   * How the trainer is told what this is, or null for a field it is never told.
   *
   * The name is null because the instruction already names the trainee, and saying it
   * twice is a second place for the two to disagree.
   */
  promptLabel: string | null;
}

export interface TextFieldSpec extends FieldSpecBase {
  kind: 'text';
  placeholder: string;
  /**
   * The most characters accepted, after cleaning.
   *
   * Short on purpose. Most of these reach a prompt in every session, they are text from
   * outside that a model will read, and a phrase or two is all the trainer can use.
   */
  max: number;
}

export interface NumberFieldSpec extends FieldSpecBase {
  kind: 'years';
  placeholder: string;
}

export interface ChoiceFieldSpec extends FieldSpecBase {
  kind: 'proficiency';
}

export type ProfileFieldSpec = TextFieldSpec | NumberFieldSpec | ChoiceFieldSpec;

/** In the order the forms show them: required first, then the optional ones. */
export const PROFILE_FIELDS: readonly ProfileFieldSpec[] = [
  {
    key: 'name',
    kind: 'text',
    label: 'Your name',
    hint: 'As you would like the trainer and your facilitator to know you.',
    placeholder: 'For example, Asha Patil',
    column: 'name',
    required: true,
    max: 80,
    promptLabel: null,
  },
  {
    key: 'education',
    kind: 'text',
    label: 'Education, with stream',
    hint: 'Your highest qualification and its subject.',
    placeholder: 'For example, B.E., Electrical',
    column: 'education',
    required: true,
    max: 100,
    promptLabel: 'Education',
  },
  {
    key: 'yearsExperience',
    kind: 'years',
    label: 'Total years of experience',
    hint: 'All your working years, in any role. Half years are fine.',
    placeholder: 'For example, 6',
    column: 'years_of_experience',
    required: true,
    promptLabel: 'Years of experience',
  },
  {
    key: 'department',
    kind: 'text',
    label: 'Current department',
    hint: 'Where you work now.',
    placeholder: 'For example, Facilities operations',
    column: 'department',
    required: true,
    max: 80,
    promptLabel: 'Department',
  },
  {
    key: 'proficiency',
    kind: 'proficiency',
    label: 'How you rate your own proficiency',
    hint: 'For information. Your assessment decides the level of your training.',
    column: 'proficiency',
    required: true,
    promptLabel: 'Proficiency they stated',
  },
  {
    key: 'city',
    kind: 'text',
    label: 'Your city',
    hint: 'For an occasional local example.',
    placeholder: 'For example, Pune',
    column: 'city',
    required: false,
    max: 60,
    promptLabel: 'City',
  },
  {
    key: 'studiedAt',
    kind: 'text',
    label: 'Where you studied',
    hint: 'Your college or university.',
    placeholder: 'For example, COEP Technological University',
    column: 'studied_at',
    required: false,
    max: 100,
    promptLabel: 'Studied at',
  },
  {
    key: 'experienceByArea',
    kind: 'text',
    label: 'Experience by area',
    hint: 'A few words on what you have worked on and for how long.',
    placeholder: 'For example, HVAC 4 years, electrical 2 years',
    column: 'experience_by_area',
    required: false,
    max: 200,
    promptLabel: 'Experience by area',
  },
  {
    key: 'interests',
    kind: 'text',
    label: 'Your interests',
    hint: 'What draws you to this field, so the trainer can connect the material to it.',
    placeholder: 'For example, how data centres stay running',
    column: 'interests',
    required: false,
    max: 150,
    promptLabel: 'Interests',
  },
  {
    key: 'hobbies',
    kind: 'text',
    label: 'Your hobbies',
    hint: 'For the odd comparison that makes an idea easier to picture.',
    placeholder: 'For example, cricket, cooking, trekking',
    column: 'hobbies',
    required: false,
    max: 150,
    promptLabel: 'Hobbies',
  },
];

export const REQUIRED_FIELDS = PROFILE_FIELDS.filter((field) => field.required);

/** Where a profile came from. */
export type ProfileSource = 'self' | 'upload';

/**
 * One person's profile, as stored.
 *
 * One document per person, in their own organisation's `profiles` collection, keyed on
 * their id. A profile uploaded for somebody who has not yet signed in is keyed on the
 * placeholder id the roster gave them, and carries their address so it can still be
 * found once signing in replaces that id with the real one.
 */
export interface LearnerProfileRecord extends LearnerDetails {
  personId: string;
  /** The address it was uploaded against, lower-cased. Only on an uploaded profile. */
  emailKey?: string;
  source: ProfileSource;
  /**
   * Whether the participant has seen it, completed it and agreed to the notice.
   *
   * An uploaded profile is not, until they do. Until then the trainer is not given it:
   * it is what their organisation said about them, not what they agreed to share.
   */
  confirmed: boolean;
  /** Who uploaded it, and when. Only on an uploaded profile. */
  uploadedBy?: string;
  uploadedAt?: string;
  /** The notice its owner agreed to and when, once confirmed. */
  consent?: { version: string; at: string };
  /** ISO 8601. */
  updatedAt: string;
  /**
   * Set by the daily retention job 90 days after last use, when only administrators may
   * see it and the trainer is no longer given it (AI-41). Written inline rather than
   * imported, to keep this file free of imports; the shape is `RetentionMark`.
   */
  retention?: { restrictedAt: string; lastUsedAt: string };
}

/** The required fields this profile does not have yet. Empty when it is complete. */
export function missingRequired(details: LearnerDetails | null | undefined): ProfileFieldSpec[] {
  return REQUIRED_FIELDS.filter((field) => {
    const value = details?.[field.key];
    return value === undefined || value === null || value === '';
  });
}

/** The details alone, for a form or a view, without the bookkeeping around them. */
export function detailsOf(record: LearnerDetails | null | undefined): LearnerDetails {
  const details: LearnerDetails = {};
  if (!record) return details;
  for (const field of PROFILE_FIELDS) {
    const value = record[field.key];
    if (value !== undefined && value !== null && value !== '') {
      (details as Record<string, unknown>)[field.key] = value;
    }
  }
  return details;
}

/** How a stored value reads on a page. */
export function displayValue(field: ProfileFieldSpec, details: LearnerDetails): string {
  const value = details[field.key];
  if (value === undefined || value === null || value === '') return '';
  if (field.kind === 'proficiency') {
    return isProficiency(value) ? PROFICIENCY_LABELS[value] : '';
  }
  if (field.kind === 'years') {
    return typeof value === 'number' ? `${value} ${value === 1 ? 'year' : 'years'}` : '';
  }
  return String(value);
}
