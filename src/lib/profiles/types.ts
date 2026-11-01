/**
 * What a learner may tell the trainer about themselves, and the shape it is kept in.
 *
 * Types and constants only, with no imports, so the profile form in the browser and the
 * route that validates it read the same list of fields, the same caps and the same
 * levels. A cap the form enforced and the server did not, or the other way round, would
 * be a form that lies about what it will accept.
 *
 * The fields are expected to change once the customer has replied, so they are a list
 * rather than code. Adding a personal field is one entry in `PERSONAL_FIELDS` and one
 * optional property on `LearnerDetails`: the form, the validation, the profile page and
 * the trainer's prompt all walk the list.
 *
 * Everything here is gated by PROFILES_ENABLED. See `profilesEnabled` in config.ts.
 */

/**
 * How much somebody already knows about the course they are about to attend.
 *
 * A small fixed set rather than a scale or free text, because the trainer has to turn it
 * into a decision about depth, and four plain steps are something both a participant
 * and a model read the same way.
 */
export const EXPERTISE_LEVELS = ['new', 'some', 'experienced', 'expert'] as const;

export type ExpertiseLevel = (typeof EXPERTISE_LEVELS)[number];

/** What a participant is shown for each level. Plain words, not a rating. */
export const EXPERTISE_LABELS: Record<ExpertiseLevel, string> = {
  new: 'New to this',
  some: 'Some experience',
  experienced: 'Experienced',
  expert: 'Expert',
};

export function isExpertiseLevel(value: unknown): value is ExpertiseLevel {
  return typeof value === 'string' && (EXPERTISE_LEVELS as readonly string[]).includes(value);
}

/**
 * The details that belong to the person rather than to a course, so they are asked for
 * once and reused in every session.
 */
export interface LearnerDetails {
  city?: string;
  /** What draws them to the field the training is in. */
  domainInterest?: string;
  /** Hobbies and interests, for the occasional analogy. */
  interests?: string;
}

export type PersonalField = keyof LearnerDetails;

export interface PersonalFieldSpec {
  key: PersonalField;
  /** The label on the form. */
  label: string;
  /** A hint under the label, saying what it is for. */
  hint: string;
  placeholder: string;
  /**
   * The most characters accepted, after cleaning.
   *
   * Short on purpose. Every character here reaches a prompt in every session, it is
   * text from outside that a model will read, and a sentence or two is all the trainer
   * can use anyway.
   */
  max: number;
  /** How the trainer is told what this is. */
  promptLabel: string;
}

export const PERSONAL_FIELDS: readonly PersonalFieldSpec[] = [
  {
    key: 'city',
    label: 'Your city',
    hint: 'For an occasional local example.',
    placeholder: 'For example, Pune',
    max: 60,
    promptLabel: 'City',
  },
  {
    key: 'domainInterest',
    label: 'What interests you about this field',
    hint: 'So the trainer can connect the material to what you care about.',
    placeholder: 'For example, how data centres stay running',
    max: 200,
    promptLabel: 'Interest in the field',
  },
  {
    key: 'interests',
    label: 'Your hobbies and interests',
    hint: 'For the odd comparison that makes an idea easier to picture.',
    placeholder: 'For example, cricket, cooking, trekking',
    max: 200,
    promptLabel: 'Hobbies and interests',
  },
];

/**
 * One person's profile, as stored.
 *
 * One document per person, in their own organisation's `profiles` collection, keyed on
 * their id. Expertise is per course, keyed on the deck id, because somebody can be an
 * expert in fire safety and new to information security.
 */
export interface LearnerProfileRecord extends LearnerDetails {
  personId: string;
  expertise: Record<string, ExpertiseLevel>;
  /** Which notice they agreed to, and when they last did. */
  consent: { version: string; at: string };
  /** ISO 8601. */
  updatedAt: string;
}

/**
 * The most courses one profile holds an expertise level for.
 *
 * Far more than anybody attends. It is here so that a client cannot grow one document
 * without limit.
 */
export const MAX_EXPERTISE_ENTRIES = 200;

/**
 * What the session lobby should ask, worked out on the server.
 *
 * Carries no profile data, only which questions are still open, so the lobby can offer
 * the form without the browser being sent what somebody already said.
 */
export interface ProfileOfferState {
  deckId: string;
  /** No experience level for this course yet. */
  askExpertise: boolean;
  /** None of the personal details filled in yet. */
  askPersonal: boolean;
}

/** Whether somebody has filled in any of the details that belong to them. */
export function hasPersonalDetails(details: LearnerDetails | null | undefined): boolean {
  return PERSONAL_FIELDS.some((field) => Boolean(details?.[field.key]));
}
