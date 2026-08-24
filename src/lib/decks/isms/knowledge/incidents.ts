/**
 * Incident recognition and reporting, covering slides 6 and 7.
 *
 * The hardest part of this topic is not the reporting route. It is getting people
 * to recognise that the small, embarrassing, self-inflicted things are exactly
 * what the process is for.
 */

import type { KnowledgeTopic } from '../../../knowledge/types';

export const INCIDENTS: KnowledgeTopic[] = [
  {
    id: 'incident-what-counts',
    narrationPriority: 10,
    title: 'What counts as an incident',
    slideIds: [6, 7],
    triggers: [
      'incident',
      'what counts',
      'report',
      'near miss',
      'threshold',
      'is it an incident',
      'do i need to report',
      'weakness',
    ],
    explanation: [
      'The definition on the slide is deliberately broad: anything that might lead to the compromise of confidentiality, integrity or availability. The word might is the important one, because it puts the threshold at possible harm rather than proven harm.',
      'Look at the two examples the deck chose. Non-compliance with clear desk and clear screen, and a phishing email. Neither is a breach. One is an unlocked screen and the other is a message somebody sent you. That choice of examples is the deck telling you the bar is low on purpose.',
      'It is worth separating three things that all get reported. An event is something that happened. A weakness is something that could allow something to happen, such as a door that does not latch or a shared folder with the wrong permissions. A near miss is something that nearly happened, such as noticing the wrong recipient just before sending. All three are worth reporting, and the near misses are the most valuable because they are free lessons.',
      'The practical rule for a trainee who is unsure: if you are asking yourself whether it counts, report it. Deciding it was too small is a judgement that needs information you do not have, such as whether five other people got the same email.',
      'Reporting is not an accusation and it is not paperwork for its own sake. It is how the organisation finds out that something needs fixing, and patterns are only visible if the small things are recorded.',
    ],
    examples: [
      'A phishing email you deleted without clicking. Still reportable, because others received it too.',
      "A colleague's screen left unlocked and unattended.",
      'A shared link you realise is set to anyone with the link rather than named people.',
      'A visitor in a restricted area with no escort.',
      'A backup or sync that you notice has not run for weeks.',
      'A document sent to the wrong recipient, even when they confirm they deleted it.',
      'A door to a secure area that does not close properly. Nothing has happened, and that is the point of reporting it.',
    ],
    standardRefs: [
      'A.5.24 Information security incident management planning and preparation.',
      'A.5.25 Assessment and decision on information security events.',
      'A.6.8 Information security event reporting, which is the control that puts the obligation on every member of staff.',
    ],
    analogy:
      'Aviation is the model worth borrowing. Airlines are extraordinarily safe because crews report near misses without consequence, and thousands of small reports get analysed. A culture where only crashes are reported learns nothing until there is a crash.',
    misconceptions: [
      {
        belief: 'It is only an incident if data actually got out.',
        correction:
          'The threshold is might. A laptop left on a train is an incident whether or not anybody opened it, because you cannot show that nobody did. Waiting for proof of harm means acting when it is too late to help.',
      },
      {
        belief: 'It was my fault, so reporting it will get me in trouble.',
        correction:
          'Reporting quickly is the behaviour the process is designed around and is treated as such. What causes real difficulty is a small problem found late by somebody else, because every cheap option has expired by then.',
      },
      {
        belief: 'Somebody else will have reported it.',
        correction:
          'That assumption is why things go unreported for weeks. Duplicate reports cost a service desk a minute. An unreported incident can cost a client relationship.',
      },
      {
        belief: 'I should investigate first so I have something useful to report.',
        correction:
          'Report first, then help. Poking about can destroy the evidence an investigation needs, and the clock is the one thing you cannot get back. Do not delete the suspicious email either; it is evidence.',
      },
    ],
    faqs: [
      {
        q: 'How quickly do I need to report something?',
        a: 'Promptly, which in practice means as soon as you notice rather than at the end of the day. The first minutes are when a link can be revoked, a device wiped or a password changed. Speed is the variable you control.',
      },
      {
        q: 'What information should I include?',
        a: 'What happened, when, what was involved, and what you have already done. You do not need a diagnosis. A short accurate report immediately beats a complete one tomorrow.',
      },
      {
        q: 'What if it happened at a client site?',
        a: 'Report it through the Technavious route as normal, and flag that it involves a client, because there will usually be contractual notification obligations. Do not decide on your own whether the client needs to be told; that decision belongs to the process.',
      },
    ],
  },

  {
    id: 'incident-reporting-routes',
    narrationPriority: 20,
    title: 'How to report',
    slideIds: [6, 7],
    triggers: [
      'how do i report',
      'support desk',
      'ticket',
      'email',
      'phone',
      'number',
      'contact',
      'it support',
      'service desk',
      'who do i tell',
    ],
    explanation: [
      'There are three routes and they are alternatives, not a sequence. Use whichever gets the information moving fastest.',
      'The IT Support Desk form is the primary route, because it creates a ticket with a record and an owner from the outset.',
      'The IT support mailbox is the second route, and it suits situations where you want to forward evidence, such as a suspicious message.',
      'The phone numbers on the final slide are the third, and they are the right choice when something is urgent or when you cannot get to a computer, which is exactly the situation a lost laptop creates.',
      'The Incident Reporting Procedure is the controlled document behind all three, and it is where escalation, timescales and severity are defined.',
      'One practical note: if the thing you are reporting is that your account may be compromised, use a route that does not depend on that account. That is what the phone numbers are for.',
    ],
    standardRefs: [
      'A.6.8 Information security event reporting requires a mechanism for staff to report events in a timely manner.',
      'A.5.26 Response to information security incidents.',
    ],
    faqs: [
      {
        q: 'Should I use the form or the phone?',
        a: 'The form for anything routine, because it creates the record automatically. The phone when it is urgent, when you cannot reach a computer, or when the problem is your account itself.',
      },
      {
        q: 'Do I report to my manager or to the service desk?',
        a: 'The service desk, because that is what starts the process. Telling your manager as well is sensible and is not a substitute, since a line manager cannot revoke a link or wipe a device.',
      },
    ],
    outOfScope: [
      'Escalation paths, severity definitions, response times and who the incident owner is. These are in the Incident Reporting Procedure.',
    ],
  },
];
