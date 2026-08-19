/**
 * Structured content for the ISO 27001 ISMS Awareness deck.
 *
 * Every field here is derived from the source PowerPoint at
 * docs/ISMS-Awareness-Session.pptx. `title` and `bullets` reproduce what is
 * printed on the slide. `speakerNotes` reproduces the presenter notes that are
 * genuine teaching content. `narrationBrief` and `keyPoints` are the teaching
 * instructions handed to the model, so the trainer covers the same ground a
 * human presenter would.
 *
 * Anything the deck author wrote to themselves rather than to an audience sits
 * in `internalNotes` and is never sent to the model. Slides 2 and 4 are the
 * reason that distinction exists.
 */

export interface DeckSlide {
  /** 1-based slide number, matching the source deck. */
  id: number;
  /** Title as printed on the slide. */
  title: string;
  /** Short label for the slide rail and progress indicator. */
  shortLabel: string;
  /** One-line description of the slide, for the session outline on the landing page. */
  summary: string;
  /** Path to the exported slide image under /public. */
  image: string;
  /** Text printed on the slide, in reading order. */
  bullets: string[];
  /** Presenter notes that are real teaching content. */
  speakerNotes: string[];
  /** Author-only notes. Excluded from the model context on purpose. */
  internalNotes: string[];
  /** What the trainer must get across on this slide. */
  narrationBrief: string;
  /** Points the trainer should not leave the slide without covering. */
  keyPoints: string[];
  /** Openers the trainer can use to draw the trainee into conversation. */
  discussionPrompts: string[];
  /** Rough spoken length target in seconds. Drives pacing, not a hard cut-off. */
  targetSeconds: number;
}

export const DECK_TITLE = 'ISMS Awareness Session';
export const DECK_SUBTITLE = 'ISO/IEC 27001 Information Security Management System';
export const DECK_OWNER = 'Technavious';

export const SLIDES: DeckSlide[] = [
  {
    id: 1,
    title: 'ISMS Awareness Session',
    shortLabel: 'Welcome',
    summary: 'How the session runs, and what the next few minutes cover.',
    image: '/slides/slide1.png',
    bullets: ['ISMS – Awareness Session'],
    speakerNotes: [],
    internalNotes: [],
    narrationBrief:
      'Open the session. Greet the trainee by name if you know it, say who you are, and set out what the next few minutes cover: the everyday threats, what an ISMS actually is, the policies that apply to them personally, how Technavious classifies information, and how to report a problem. Make clear they can interrupt and ask anything at any point. Keep it to a few sentences and finish by asking whether they are ready to begin.',
    keyPoints: [
      'This is an ISO 27001 information security awareness session for Technavious staff.',
      'It is a conversation, not a lecture. The trainee can interrupt at any time.',
      'Five topics ahead: threats, what an ISMS is, end user policies, information classification, incident reporting.',
    ],
    discussionPrompts: [
      'Before we start, have you sat through an information security session before?',
      'Ready to make a start?',
    ],
    targetSeconds: 35,
  },
  {
    id: 2,
    title: 'Threats and Practices',
    shortLabel: 'Threats',
    summary: 'The six everyday threats that turn on how people behave rather than on technology.',
    image: '/slides/slide2.png',
    bullets: [
      'Malware',
      'Spear Phishing',
      'Malicious Links',
      'Passwords',
      'Browsing in Public',
      'Data Compromise',
    ],
    speakerNotes: [],
    internalNotes: [
      'Push the OutThink Platform in a slide and call to action and training minutes consideration',
    ],
    narrationBrief:
      'Walk through the six threat categories on the slide. Give each one a single concrete, recognisable example from an office or data centre setting rather than a textbook definition. Spend the most time on spear phishing and passwords, because those are where individual behaviour matters most. Close by making the point that all six come down to daily habits rather than technology.',
    keyPoints: [
      'Malware: software that gets onto a device and does harm, often arriving through an attachment, a downloaded installer, or an unknown USB stick.',
      'Spear phishing: a targeted message crafted for one person, using real names, projects, or suppliers to look legitimate. Far harder to spot than bulk spam.',
      'Malicious links: a link whose visible text and true destination differ. Hovering to check the real address is the habit that catches these.',
      'Passwords: reuse across personal and corporate accounts is the core risk. Long unique passwords, a password manager, and multi-factor authentication are the defences.',
      'Browsing in public: open Wi-Fi and visible screens in cafes, airports, and shared client sites leak information. Shoulder surfing is a real vector.',
      'Data compromise: any loss of confidentiality, integrity, or availability, whether deliberate or accidental. Most cases start with an ordinary mistake.',
    ],
    discussionPrompts: [
      'Which of these six do you think you run into most often?',
      'Has a message ever landed in your inbox that you were not quite sure about?',
    ],
    targetSeconds: 95,
  },
  {
    id: 3,
    title: 'Information Security Management System',
    shortLabel: 'What is an ISMS',
    summary: 'What a management system is, what makes it an ISMS, and why ISO 27001 matters.',
    image: '/slides/slide3.png',
    bullets: [
      'management system: the way in which an organisation manages the interrelated parts of its business in order to achieve its objectives',
      'Information Security Management System (ISMS): a framework of policies and controls that manage security and risks systematically across the organisation',
      'ISO 27001 is the certifiable standard that specifies the requirements for establishing, implementing, maintaining and continually improving an ISMS',
      'Helps comply with regulatory requirements',
      'Enhances organisation reputation',
      'Brings efficiency in organisation processes',
      'Reduces the overall costs',
      'Badge on slide: Nov 2024',
    ],
    speakerNotes: [],
    internalNotes: [],
    narrationBrief:
      'Build the definition up in two steps: first what a management system is in general, then what makes it an information security management system. Stress the word systematically, because that is what separates an ISMS from ad hoc security work. Explain that ISO 27001 is the standard an organisation can actually be audited and certified against, and name its four verbs: establishing, implementing, maintaining, continually improving. Then cover the four business benefits. Mention that the Nov 2024 badge on the slide marks when Technavious achieved certification.',
    keyPoints: [
      'A management system is how an organisation runs its interrelated parts to hit its objectives.',
      'An ISMS applies that idea to information security: a framework of policies and controls covering security and risk across the whole organisation.',
      'The word that matters is systematically. Security becomes a repeatable process rather than a series of one-off fixes.',
      'ISO 27001 is the certifiable standard. It sets requirements for establishing, implementing, maintaining and continually improving an ISMS.',
      'Continual improvement means the ISMS is never finished. It is reviewed and tightened over time.',
      'Four benefits on the slide: regulatory compliance, stronger reputation, more efficient processes, lower overall costs.',
      'The Nov 2024 badge marks Technavious achieving certification.',
    ],
    discussionPrompts: [
      'Does the difference between a one-off security fix and a management system make sense so far?',
      'Any part of that definition you would like me to unpack?',
    ],
    targetSeconds: 105,
  },
  {
    id: 4,
    title: 'Policies for End Users',
    shortLabel: 'Policies',
    summary:
      'The eight policies that apply to every member of staff, and what each one asks of you.',
    image: '/slides/slide4.png',
    bullets: [
      'Physical Security Policy',
      'Clear Desk and Clear Screen Policy',
      'Backup Policy',
      'Teleworking and mobile device policy',
      'Media Handling Policy',
      'Acceptable Use Policy',
      'Information Classification Policy',
      'Document Control Procedure',
    ],
    speakerNotes: [],
    internalNotes: [
      'Push the OutThink Platform in a slide and call to action and training minutes consideration',
    ],
    narrationBrief:
      'These are the eight policies that apply to every member of staff, not just to IT. Do not simply read the list out. For each one, say in a sentence what it actually asks of the trainee day to day. Group them so the list is easier to hold on to: the ones about the physical space, the ones about devices and data, and the ones about handling documents. Finish by telling them awareness of these policies is itself an audit requirement.',
    keyPoints: [
      'Physical Security Policy: access control, visitor handling, and not letting anyone tailgate into a secure area behind you.',
      'Clear Desk and Clear Screen Policy: lock the screen when you step away, and leave no sensitive paper on the desk overnight.',
      'Backup Policy: business data belongs in approved, backed up storage, never only on a local drive.',
      'Teleworking and mobile device policy: how to work safely from home, from client sites, and from a phone or laptop off the premises.',
      'Media Handling Policy: how removable media and printed material are used, labelled, transported, and disposed of.',
      'Acceptable Use Policy: what corporate systems, email, and internet access may and may not be used for.',
      'Information Classification Policy: the four-tier scheme covered on the next slide.',
      'Document Control Procedure: version control, approval, and issuing of controlled documents.',
      'Being aware of these policies is itself an ISO 27001 requirement, which is why this session exists.',
    ],
    discussionPrompts: [
      'Which of these eight would you like me to go into properly?',
      'Have you had to apply any of these on a client site?',
    ],
    targetSeconds: 100,
  },
  {
    id: 5,
    title: 'Information Classification Matrix',
    shortLabel: 'Classification',
    summary:
      'The four classification tiers, the impact test that decides between them, and the rules on handling, labelling and storage.',
    image: '/slides/slide5.png',
    bullets: [
      'Secret: information that can be disclosed or shared only with the highest level of authorisation or approval, and only with the minimum number of individuals or groups who have a critical need to know and who are bound by the strictest confidentiality agreements or obligations.',
      'Confidential: information that can be disclosed or shared only with specific individuals or groups who have a legitimate need to know and who are bound by confidentiality agreements or obligations.',
      'Internal Use: information that can be disclosed or shared within the organisation, but not with external parties without authorisation or approval.',
      'Public: information that can be freely disclosed or shared with anyone without restriction.',
      'Handling: information must be handled as stated in the Information Classification Policy.',
      'Labelling: digital and non-digital information must be labelled based on its classification.',
      'Storage: only use Technavious approved storage.',
      'Personal accounts must not be used to access corporate or its clients information.',
    ],
    internalNotes: [],
    speakerNotes: [
      'Secret: disclosure would have a serious impact on long-term business objectives or put the survival of the organisation at risk.',
      'Confidential: disclosure would have a significant short-term impact on operations or business objectives.',
      'Internal Use: disclosure of internal information would cause minor reputational damage or minor operational impact.',
      'Public: disclosure of public information would cause no harm to the organisation.',
      'End users are strongly recommended to use their OneDrive storage and to make sure sync is turned on.',
    ],
    narrationBrief:
      'This is the most practically useful slide in the deck, so give it room. Take the four tiers in order and pair each one with its impact test from the presenter notes, because the impact test is what people actually use to decide. Then cover the three obligations: handling, labelling, storage. Land the red warning line firmly, because it is the single rule most often broken: personal accounts must never be used for corporate or client information. Mention the OneDrive recommendation with sync turned on. If the trainee asks for an example, draw one from data centre consultancy work.',
    keyPoints: [
      'Four tiers, most restrictive first: Secret, Confidential, Internal Use, Public.',
      'Secret: highest authorisation, minimum number of people, critical need to know, strictest confidentiality obligations. Impact test: serious damage to long-term objectives or a threat to the survival of the organisation.',
      'Confidential: specific individuals or groups with a legitimate need to know, bound by confidentiality obligations. Impact test: significant short-term impact on operations or business objectives.',
      'Internal Use: fine inside Technavious, but not outside without authorisation or approval. Impact test: minor reputational or operational damage.',
      'Public: free to share with anyone. Impact test: no harm.',
      'The impact test is the practical way to classify something when the label is not obvious.',
      'Handling follows the Information Classification Policy.',
      'Labelling applies to both digital and non-digital information.',
      'Storage must be Technavious approved. OneDrive is recommended for end users, with sync turned on.',
      'The rule on the red bar: personal accounts must not be used to access corporate or client information. No exceptions.',
    ],
    discussionPrompts: [
      'Take a client site survey report. Where would you place that?',
      'Shall I give you a worked example of classifying something you handle day to day?',
    ],
    targetSeconds: 135,
  },
  {
    id: 6,
    title: 'Report an Incident / IT Support',
    shortLabel: 'Reporting',
    summary: 'What counts as an incident, and the two routes for reporting one.',
    image: '/slides/slide6.png',
    bullets: [
      'All IT and information security related incidents shall be promptly reported to the service desk via the ticket, phone or email. Refer to Incident Reporting Procedure.',
      '1. Fill the IT Support Desk Form',
      '2. it.support@technavious.com',
      'An incident is anything that might lead to the compromise of Confidentiality, Integrity or Availability, such as: non-compliance with Clear Desk and Clear Screen, or a phishing or spam email.',
    ],
    speakerNotes: [],
    internalNotes: [],
    narrationBrief:
      'Define what counts as an incident first, then give the reporting routes. Use the CIA triad as the test: anything that might compromise confidentiality, integrity, or availability. Point out that the two examples on the slide are deliberately small, an unlocked screen and a phishing email, because the threshold for reporting is low. Give the two routes on this slide, the support desk form and the email address, and say the phone numbers follow on the next slide. Stress prompt reporting, and that reporting is never penalised.',
    keyPoints: [
      'An incident is anything that might compromise Confidentiality, Integrity or Availability.',
      'The examples on the slide are intentionally minor: an unlocked screen, a phishing or spam email. Small things are still reportable.',
      'Route one: fill in the IT Support Desk Form.',
      'Route two: email it.support@technavious.com.',
      'Phone numbers follow on the next slide.',
      'Report promptly. Speed limits the damage.',
      'The Incident Reporting Procedure is the controlled document to refer to.',
      'If you are unsure whether something counts as an incident, report it anyway.',
    ],
    discussionPrompts: [
      'If you spotted a colleague screen unlocked and unattended, what would you do?',
      'Is it clear what does and does not count as an incident?',
    ],
    targetSeconds: 95,
  },
  {
    id: 7,
    title: 'Report an Incident / IT Support',
    shortLabel: 'Contacts',
    summary: 'The phone routes for anything urgent, and a recap of the whole session.',
    image: '/slides/slide7.png',
    bullets: [
      '3. +91 93634 06839',
      '+91 98949 90156',
      'An incident is anything that might lead to the compromise of Confidentiality, Integrity or Availability, such as: non-compliance with Clear Desk and Clear Screen, or a phishing or spam email.',
    ],
    speakerNotes: [],
    internalNotes: [],
    narrationBrief:
      'This slide completes the reporting routes with the two phone numbers. Read them clearly, digit group by digit group, because the trainee may be writing them down. Explain that the phone route is the one to use when something is urgent or when you cannot reach a computer. Then close the session: recap the five topics in a couple of sentences, confirm the one habit you want them to take away, and invite any final questions.',
    keyPoints: [
      'Phone route, first number: plus nine one, nine three six three four, zero six eight three nine.',
      'Phone route, second number: plus nine one, nine eight nine four nine, nine zero one five six.',
      'Use the phone when the matter is urgent or you cannot get to a computer.',
      'Three routes in total: the support desk form, the email address, the phone numbers.',
      'Session recap: the six everyday threats, what an ISMS is and why ISO 27001 matters, the eight end user policies, the four classification tiers, and how to report an incident.',
      'The single habit worth taking away: if something looks wrong, report it promptly rather than deciding for yourself that it is too small to matter.',
    ],
    discussionPrompts: [
      'Anything from the whole session you would like me to go back over?',
      'Shall I put a few quick questions to you to check it has landed?',
    ],
    targetSeconds: 90,
  },
];

export const TOTAL_SLIDES = SLIDES.length;

export function getSlide(id: number): DeckSlide | undefined {
  return SLIDES.find((slide) => slide.id === id);
}

/** Clamps an arbitrary number to a valid slide id. */
export function clampSlideId(id: number): number {
  if (!Number.isFinite(id)) return 1;
  return Math.min(Math.max(Math.round(id), 1), TOTAL_SLIDES);
}

/** Estimated full run time of the narration, in minutes. */
export const ESTIMATED_MINUTES = Math.round(
  SLIDES.reduce((total, slide) => total + slide.targetSeconds, 0) / 60,
);
