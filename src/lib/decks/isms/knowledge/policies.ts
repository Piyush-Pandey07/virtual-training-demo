/**
 * The eight end-user policies on slide 4.
 *
 * The point of this module is to turn a list of policy titles into what each one
 * asks of a person on an ordinary working day, with the control reference for
 * anyone who wants it and the failure that auditors actually find.
 */

import type { KnowledgeTopic } from '../../../knowledge/types';

export const POLICIES: KnowledgeTopic[] = [
  {
    id: 'policies-overview',
    narrationPriority: 10,
    title: 'Why there are eight, and how to hold them in mind',
    slideIds: [4],
    triggers: ['policies', 'policy list', 'eight', 'which policy', 'all the policies'],
    explanation: [
      'Eight titles read as a list to memorise, which is the wrong shape. They group into three concerns.',
      'Where you are: Physical Security, and Clear Desk and Clear Screen. These govern the space around you.',
      'What you are carrying: Teleworking and Mobile Device, Media Handling, and Backup. These govern devices and copies of information.',
      'What you are handling: Acceptable Use, Information Classification, and Document Control. These govern the information itself and the systems it lives in.',
      'None of these is an IT policy. Every one of them describes something a person does, which is why awareness of them is a requirement of the standard rather than a courtesy.',
      'The practical test an auditor applies is not whether you can recite them. It is whether you behave as though they exist. Somebody who locks their screen without thinking about it has internalised A.7.7 whether or not they could name it.',
    ],
    standardRefs: [
      'A.5.1 Policies for information security requires a set of topic-specific policies, defined, approved, published and acknowledged.',
      'A.6.3 Information security awareness, education and training is why this session is mandatory rather than optional.',
    ],
    misconceptions: [
      {
        belief: 'Policies are for the auditors, not for me.',
        correction:
          'The auditor reads the policy and then asks you what you do. The gap between those two answers is the finding. Policies exist to make the expected behaviour explicit so that it does not depend on who is on shift.',
      },
    ],
    faqs: [
      {
        q: 'Do I have to read all eight in full?',
        a: 'You are expected to know what each one requires of you and where to find it when you need the detail. Reading the ones that touch your role closely is time well spent; for the rest, knowing they exist and where they live is the working minimum.',
      },
    ],
    outOfScope: [
      'Where each policy document is published and who owns it. That is a Technavious specific, and the IT support desk or the ISMS documentation set is the place to ask.',
    ],
  },

  {
    id: 'policy-physical-security',
    narrationPriority: 40,
    title: 'Physical Security Policy',
    slideIds: [4],
    triggers: [
      'physical security',
      'tailgat',
      'access card',
      'badge',
      'visitor',
      'escort',
      'server room',
      'perimeter',
      'piggyback',
    ],
    explanation: [
      'Physical security is the control most relevant to this industry, because the facilities Technavious designs and audits are built around it.',
      'What it asks of an individual comes down to four habits. Use your own credential. Do not let anyone follow you through a controlled door. Challenge or report anyone you do not recognise in a restricted area. Escort visitors rather than pointing them in a direction.',
      'Tailgating is the one worth dwelling on, because it is a social problem rather than a technical one. Holding a door open is polite, and refusing feels rude, which is exactly why it is the most reliable physical attack there is. The organisation has to make challenging normal so that individuals are not asked to be brave.',
      "Client sites deserve extra care because you are a guest in someone else's control regime, and a lapse there is a lapse against their certification as well as ours. Escort rules, photography restrictions and areas you may not enter are theirs to set, not ours to interpret.",
      "Photography is worth naming separately. A photograph of a rack, a panel schedule or a whiteboard is an uncontrolled copy of classified information leaving a controlled space in somebody's pocket.",
    ],
    examples: [
      'Arriving at a client data hall behind a contractor who holds the door. The correct action is to badge in yourself, however awkward the pause feels.',
      'A person in high-visibility clothing carrying a ladder in a restricted corridor. Uniform and equipment are not authorisation, and they are cheap to acquire.',
      'Photographing a commissioning panel to send to a colleague for a quick opinion. Fast, helpful, and an uncontrolled disclosure.',
    ],
    standardRefs: [
      'A.7.1 Physical security perimeters, A.7.2 Physical entry, A.7.3 Securing offices, rooms and facilities, A.7.4 Physical security monitoring.',
    ],
    faqs: [
      {
        q: 'Is it really my job to challenge someone I do not recognise?',
        a: 'You are not expected to confront anybody. A friendly question, or reporting it to whoever is responsible for the area, is the whole of it. The failure mode is assuming somebody else has already checked, which is what everybody assumes.',
      },
    ],
  },

  {
    id: 'policy-clear-desk-screen',
    narrationPriority: 20,
    title: 'Clear Desk and Clear Screen Policy',
    slideIds: [4, 6],
    triggers: [
      'clear desk',
      'clear screen',
      'lock screen',
      'unattended',
      'whiteboard',
      'printout',
      'lock my computer',
    ],
    explanation: [
      'The most-broken policy in most organisations, and the easiest to comply with. Lock the screen when you leave the desk, and leave nothing sensitive out when you leave for the day.',
      'Locking the screen matters more than people think because an unlocked machine is not a window onto information, it is your full identity available to anybody walking past. Anything done on it was done by you, as far as every log is concerned.',
      'Clear desk extends past paper. Whiteboards keep the last meeting on them for days. Printers hold documents nobody collected. Notebooks hold access details. Sticky notes hold exactly what you would expect.',
      'The reason it is a named control rather than general tidiness is that it is the control an auditor can verify in thirty seconds by walking through the office. It is also the one most likely to be raised as an observation, because there is always one screen.',
      'Non-compliance is one of only two examples the deck gives for what counts as a reportable incident, which tells you how seriously it is treated. An unlocked unattended machine is worth reporting, not just closing.',
    ],
    examples: [
      'Stepping away for a two minute conversation without locking. Two minutes is ample.',
      'A single-line diagram left on a whiteboard in a meeting room used by visitors that afternoon.',
      'A print job left in the tray because the meeting started, collected by nobody, sitting there overnight.',
    ],
    standardRefs: ['A.7.7 Clear desk and clear screen.'],
    analogy:
      'Leaving your screen unlocked is leaving your signature on the desk with a blank cheque book. It is not that somebody will definitely use it. It is that nothing stands between them and it.',
    faqs: [
      {
        q: 'Do I really need to lock it if I am only going to the printer?',
        a: 'Yes, and the reason to make it unconditional is that judging each occasion is what fails. Make it reflexive, tie it to standing up, and it stops costing any thought at all.',
      },
      {
        q: "What should I do if I find a colleague's screen unlocked?",
        a: 'Lock it, tell them, and report it as the deck asks. Not to get anybody into difficulty, but because the pattern is what matters and reporting is how the pattern becomes visible.',
      },
    ],
  },

  {
    id: 'policy-backup',
    narrationPriority: 48,
    title: 'Backup Policy',
    slideIds: [4],
    triggers: [
      'backup',
      'back up',
      'restore',
      'recover',
      'lost file',
      'version',
      'ransomware recovery',
    ],
    explanation: [
      'For an end user the backup policy reduces to one thing: keep work in approved storage so that it is backed up by design, rather than trying to back anything up yourself.',
      'The reason it is framed that way is that individual backup habits fail silently. Nobody notices a backup that stopped running until they need it, and by then the answer is fixed.',
      'A backup that has never been restored is a hypothesis. Testing restores is what the standard actually requires, and it is the step organisations skip.',
      'Ransomware changed what a good backup looks like. If the backup is reachable from the machine that gets encrypted, it gets encrypted too. That is why offline or immutable copies matter, and it is why the operational side of backup is not something an individual can improvise.',
      'The availability limb of the CIA triad is what this control protects. Losing the only copy of an as-built drawing set is a security incident, not just an inconvenience.',
    ],
    examples: [
      'Work held only in a local folder for three months, then the laptop is replaced. Nothing was attacked and the information is gone.',
      'A recovery request for a file deleted six weeks ago, where the answer depends entirely on the retention period, which is a Technavious specific worth knowing before you need it.',
    ],
    standardRefs: [
      'A.8.13 Information backup, which requires backups to be maintained and regularly tested.',
    ],
    misconceptions: [
      {
        belief: 'Sync is the same as backup.',
        correction:
          'They overlap and they are not the same. Sync propagates changes, including deletions and encryption, which means a sync can carry a problem to every copy. Versioning and retention are what make it recoverable, which is why the platform matters and a folder copied to a second drive does not count.',
      },
    ],
    outOfScope: [
      'Retention periods, restore request routes and recovery time objectives. Those are in the Backup Policy and with the IT support desk.',
    ],
  },

  {
    id: 'policy-teleworking-mobile',
    narrationPriority: 45,
    title: 'Teleworking and Mobile Device Policy',
    slideIds: [4],
    triggers: [
      'teleworking',
      'remote work',
      'work from home',
      'mobile',
      'phone',
      'byod',
      'own device',
      'laptop',
      'travel',
      'home network',
    ],
    explanation: [
      'This policy covers the situation that is now normal rather than exceptional: working somewhere the organisation does not control.',
      'The 2022 revision of the standard explicitly added the physical security of the remote workplace, which is a recognition that the risk at home or on a client site is as much about who can see and hear you as about the network.',
      'What it asks in practice: work on approved devices, keep them patched and encrypted, lock them, do not leave them in vehicles, be careful what is visible and audible behind you on a call, and do not let family members use a work machine.',
      'Mobile phones are the underrated part, because a phone with corporate mail on it is a corporate device whether it feels like one or not. That is what makes app permissions, screen locks and the ability to wipe it remotely relevant.',
      'Home networks are worth a mention because the weak point is usually the router: default credentials, unpatched firmware, and a dozen other devices sharing the segment.',
    ],
    examples: [
      'A video call from home with a client drawing still on the second monitor, visible in shot.',
      'A work laptop left in a car boot during a site visit. Vehicles are a common loss point and the boot is not a safe.',
      'A family member borrowing the work laptop for a few minutes. The device is no longer under the control the policy assumes.',
    ],
    standardRefs: [
      'A.6.7 Remote working, including physical security of the remote workplace.',
      'A.8.1 User endpoint devices.',
    ],
    faqs: [
      {
        q: 'Can I use my own laptop or phone for work?',
        a: 'That is exactly what this policy decides, and it varies by organisation, so read it rather than assume. The general principle is that any device holding corporate information has to meet the same requirements as a corporate one, which is what makes bring-your-own more complicated than it first appears.',
      },
    ],
    outOfScope: [
      'Whether personal devices are permitted, which mobile management is in place, and the approved remote access route. All Technavious specifics.',
    ],
  },

  {
    id: 'policy-media-handling',
    narrationPriority: 52,
    title: 'Media Handling Policy',
    slideIds: [4],
    triggers: [
      'media handling',
      'removable media',
      'usb',
      'external drive',
      'print',
      'paper',
      'shred',
      'dispose',
      'destruction',
      'transport',
    ],
    explanation: [
      'Media handling covers information in a physical form: removable drives, optical media, printed material, and the storage inside equipment being disposed of or reused.',
      'The lifecycle is the useful frame. How media is issued, how it is labelled, how it is transported, how it is stored, and how it is destroyed. Organisations tend to be careful about the first four and casual about the last one.',
      'Disposal is where the real exposure sits. A drive that is deleted rather than wiped is fully recoverable. Equipment sent for reuse or disposal needs the storage sanitised or destroyed, with a record that it happened.',
      'Printed material matters more in this industry than in most, because drawings get printed for site work by their nature. A drawing pack is a classified asset in a form that cannot be revoked, tracked or remotely wiped.',
      'Transport is the other gap. Media in transit is media outside every control the organisation has, which is why encryption and carrying only what the trip needs are the two things that help.',
    ],
    examples: [
      'A marked-up drawing set from a site visit going into general waste rather than confidential waste.',
      'An old laptop going to a recycler with the drive intact and a cheerful assumption that they will handle it.',
      'A USB stick used to move a design to a site with no connectivity, then left in a laptop bag for six months.',
    ],
    standardRefs: [
      'A.7.10 Storage media covers the lifecycle.',
      'A.7.14 Secure disposal or re-use of equipment.',
    ],
    misconceptions: [
      {
        belief: 'Deleting the files or formatting the drive is enough.',
        correction:
          'Deletion removes the reference, not the data, and a quick format does much the same. Recovery is straightforward and cheap. Secure wiping or physical destruction is the requirement, and for anything sensitive it should come with a record.',
      },
    ],
    outOfScope: [
      'Whether removable media is permitted at all, the approved disposal route, and where confidential waste goes. Media Handling Policy.',
    ],
  },

  {
    id: 'policy-acceptable-use',
    narrationPriority: 30,
    title: 'Acceptable Use Policy',
    slideIds: [4],
    triggers: [
      'acceptable use',
      'aup',
      'personal use',
      'internet',
      'email use',
      'software',
      'install',
      'shadow it',
      'ai tool',
      'chatgpt',
      'monitoring',
    ],
    explanation: [
      'The Acceptable Use Policy defines what corporate systems, email and internet access may be used for. It is the policy people meet most often without reading.',
      'Its most useful function is governing what software and services may be introduced. Unapproved tools, which is what shadow IT means, arrive because somebody is trying to do their job faster, and they bypass every assessment the organisation has made about where information may go.',
      'Generative AI tools are the current live version of that problem. Pasting client design detail into an unapproved assistant transfers that information outside the organisation into a system nobody here can audit, revoke or make promises about to a client. Treat it as an external transfer, because it is one.',
      'The policy also normally sets out that use of corporate systems may be monitored, which is worth being straightforward about rather than coy. Logging exists so that incidents can be investigated.',
      'A reasonable framing for staff: the policy is not there to catch you browsing the news at lunch. It is there so that information does not end up in places the organisation cannot account for.',
    ],
    examples: [
      'Installing a free PDF tool to merge a drawing pack, which uploads the file to an unknown server to do it.',
      'Using a personal messaging app to send a colleague a client document because it is quicker than the approved route.',
      'Signing up to a trial service with a work email and uploading a real dataset to evaluate it.',
    ],
    standardRefs: [
      'A.5.10 Acceptable use of information and other associated assets.',
      'A.8.19 Installation of software on operational systems.',
      'A.5.14 Information transfer, which is the control an unapproved AI tool actually breaches.',
    ],
    faqs: [
      {
        q: 'Can I use AI tools for work?',
        a: 'Whether a given tool is approved is a Technavious decision, so ask the IT support desk. The principle that does not change is that anything you paste in has left the organisation, so it is governed by the classification rules exactly as an email to an outsider would be.',
      },
      {
        q: 'Is a bit of personal use of email or the internet allowed?',
        a: 'Usually within limits, and the limits are what the policy states, so read it. The parts that are never acceptable are anything unlawful, anything that puts corporate information somewhere unapproved, and anything that would embarrass the organisation.',
      },
    ],
    outOfScope: [
      'The specific approved software list, the AI tool position, and the extent of monitoring. Acceptable Use Policy.',
    ],
  },

  {
    id: 'policy-document-control',
    narrationPriority: 55,
    title: 'Document Control Procedure',
    slideIds: [4],
    triggers: [
      'document control',
      'version',
      'controlled document',
      'approval',
      'revision',
      'obsolete',
      'template',
      'issue',
    ],
    explanation: [
      'Document control is the least glamorous of the eight and the one that most often causes an audit finding, because it is entirely evidence-based.',
      'It requires that documents which matter are identified, approved by somebody with the authority to approve them, versioned, distributed to the people who need them, and withdrawn when superseded.',
      'The integrity limb of the CIA triad is what it protects. If nobody can tell which revision of a specification is current, the information has lost its integrity even though nothing was attacked.',
      'For this industry the stakes are concrete. Building to a superseded revision of a drawing is a real cost, and in commissioning it can be a safety issue. Document control is why an as-built pack means something.',
      'The behaviour it asks of individuals: work from the controlled copy rather than a downloaded one, do not circulate uncontrolled copies, and remove superseded versions from circulation rather than leaving them alongside the current one.',
    ],
    examples: [
      'Two revisions of a specification in the same shared folder, neither obviously current, and a contractor picking one.',
      'A procedure emailed as an attachment eight months ago, still in use, three revisions out of date.',
    ],
    standardRefs: [
      'Clause 7.5 Documented information, in the main body of the standard rather than Annex A, covering creation, updating and control.',
    ],
    faqs: [
      {
        q: 'Why does this count as security rather than quality?',
        a: 'Because integrity is one of the three things information security protects. Acting on information that is wrong, incomplete or superseded is a security failure even when nobody did anything malicious, and it is far more common than an attack.',
      },
    ],
  },
];
