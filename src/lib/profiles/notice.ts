/**
 * The privacy notice shown beside every learner profile form.
 *
 * DRAFT, AWAITING APPROVAL. Technavious has not signed this off, and until it does
 * PROFILES_ENABLED must stay off, so nobody is shown it or asked for anything under it.
 * It was written to be easy to replace rather than to be final: when the approved text
 * arrives, change `PROFILE_NOTICE`, change `PROFILE_NOTICE_VERSION`, and set
 * `PROFILE_NOTICE_IS_DRAFT` to false.
 *
 * The version is stored with every profile as the record of what the person agreed to,
 * and the route refuses a save made against any other version. So changing the text
 * without changing the version would leave records claiming agreement to words the
 * person never saw.
 *
 * Plain text, no imports, safe in the browser.
 */

/** True until Technavious approves the text. The form says so while it is. */
export const PROFILE_NOTICE_IS_DRAFT = true;

/** Stored with each profile as the notice its owner agreed to. */
export const PROFILE_NOTICE_VERSION = 'draft-2026-11-01';

export const PROFILE_NOTICE_TITLE = 'How your profile is used';

/**
 * DRAFT, AWAITING APPROVAL BY TECHNAVIOUS. Covers what is collected, why, who can see
 * it, and how to delete it, which is what a notice under the DPDP Act has to say. The
 * contact line is a placeholder for whoever Technavious names.
 */
export const PROFILE_NOTICE: readonly string[] = [
  'Filling this in is optional. You can skip it and every session works exactly the same.',
  'What we keep: the city, interests and hobbies you type here, and how experienced you say you are in each course.',
  'Why: so the AI trainer can pitch its explanations to your level and use the odd example that means something to you. It is not used to assess you, and it is not shared with your employer.',
  "Who sees it: only you, on your profile page. Your organisation's administrators cannot see it in the app. During your sessions it is sent to the AI service that runs the trainer (Google Gemini), only to shape what the trainer says to you.",
  "Where it is kept: with the rest of your training account, in Technavious's Google Cloud storage.",
  "Deleting it: open My profile and choose Delete my profile. It is removed completely and at once. It is also deleted if you are removed from your organisation's account or the account is closed.",
  'Questions or complaints: contact the Technavious grievance officer at [contact to be confirmed].',
];
