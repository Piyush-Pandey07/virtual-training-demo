/**
 * The privacy notice everybody is shown at sign-in, and beside every profile form.
 *
 * DRAFT, AWAITING APPROVAL. Prashant approves the final wording. The product owner has
 * switched profiles on for everybody for UAT, because every login is a test account; until
 * the wording is approved, a deployment real customers use should set PROFILES_ENABLED to
 * "staff" or "off". It was written to be easy to
 * replace rather than to be final: when the approved text arrives, change
 * `PROFILE_NOTICE`, change `PROFILE_NOTICE_VERSION`, and set `PROFILE_NOTICE_IS_DRAFT` to
 * false.
 *
 * The version is stored with every consent record as the record of what the person
 * agreed to, and a new version sends everybody back through the consent page. So
 * changing the text without changing the version would leave records claiming agreement
 * to words the person never saw.
 *
 * Plain text, no imports, safe in the browser.
 */

/** True until the text is approved. Every page that shows it says so while it is. */
export const PROFILE_NOTICE_IS_DRAFT = true;

/**
 * Stored with each consent record as the notice its owner agreed to.
 *
 * Moved on 12 November 2026, when the retention rule changed: a year now deletes the
 * profile and the answers but keeps the score, and the rest goes at five years. Everybody
 * who agreed to the 8 November draft is asked again, which costs nothing while every login
 * is a test account, and keeps each consent record true to the words its owner saw.
 */
export const PROFILE_NOTICE_VERSION = 'draft-2026-11-12';

export const PROFILE_NOTICE_TITLE = 'Privacy notice: your training data';

/**
 * Who to ask about data, and who hears grievances.
 *
 * A placeholder until Technavious confirms how Srikant should be reached. The notice's
 * test fails if the draft flag is turned off while the placeholder is still here, so the
 * approved notice cannot ship without a real way to reach him.
 */
export const DATA_CONTACT = 'Srikant, [CONTACT DETAILS TO BE CONFIRMED]';

export interface NoticeSection {
  heading: string;
  text: string;
}

/**
 * DRAFT, AWAITING APPROVAL BY PRASHANT. Says what is collected and why, who sees it, how
 * long it is kept, how to withdraw and who to contact, which is what a notice under the
 * DPDP Act 2023 has to say.
 */
export const PROFILE_NOTICE: readonly NoticeSection[] = [
  {
    heading: 'Who we are',
    text: 'Technavious runs this training app for your organisation. This notice explains what we keep about you, why, who can see it and for how long.',
  },
  {
    heading: 'What we collect',
    text: 'Your name, work email address and role. Your training progress, attendance and assessment results, and any feedback you give. If you attend training, a learner profile: your education and stream, total years of experience, current department and how you rate your own proficiency, which are required, and, only if you choose to give them, your city, where you studied, your interests, your hobbies and your experience by area. We also keep a record of when you agreed to this notice and of any withdrawal.',
  },
  {
    heading: 'Why',
    text: 'To run your training and to record that it took place. Your profile lets the AI trainer choose explanations and examples that suit your background. The proficiency you state is for information only: the level of your training follows your assessment. Your profile is never used to assess you.',
  },
  {
    heading: 'Who can see it',
    text: "Your training progress, attendance and assessment results are shared with your company. Your profile is not. Your profile can be seen by you, by the facilitator of a session or batch you are in, and by Technavious's administrators. Your company's own administrators and other participants cannot see it. During your sessions your profile is sent to the AI service that runs the trainer (Google Gemini), only to shape what the trainer says to you.",
  },
  {
    heading: 'Where it is kept',
    text: "With the rest of your training account, in Technavious's Google Cloud storage.",
  },
  {
    heading: 'How long it is kept',
    text: "Your profile, assessment and feedback data are used for 90 days after your last session. After that they are restricted to Technavious's administrators. Your profile and your assessment answers, including anything you wrote in feedback, are deleted one year after they were last used. Your name, email address, training progress, attendance, assessment scores, pass or fail and feedback ratings are kept for five years after they were last used, because your company may need to show that the training took place, and are then deleted. Consent records are kept for at least five years. Deleted data drops out of our backups when those backups expire.",
  },
  {
    heading: 'If your organisation filled it in',
    text: 'Your organisation may have uploaded your profile for you. You will be shown it to check, correct and complete before it is used, and nothing in it reaches the trainer until you confirm it.',
  },
  {
    heading: 'What you need to agree to',
    text: 'Agreeing to this notice is needed to use the app. If you attend training, so is completing the required parts of your profile. The optional parts can be left blank.',
  },
  {
    heading: 'Withdrawing your consent',
    text: 'You can withdraw your consent to your profile at any time: open My profile and choose Withdraw consent and delete my profile. Your profile is deleted at once and we record that you withdrew. Your training carries on without the personalisation. Your profile and your assessment answers are also deleted if you are removed from your organisation, and everything is deleted if its account is closed.',
  },
  {
    heading: 'Questions and grievances',
    text: `For questions about your data, or to raise a grievance, contact ${DATA_CONTACT}.`,
  },
];
