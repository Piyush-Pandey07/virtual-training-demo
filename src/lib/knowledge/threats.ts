/**
 * The six threats on slide 2, in the depth a practitioner would bring.
 *
 * Each one covers how the attack actually works, the form it takes against an
 * engineering and data centre consultancy specifically, and what the trainee is
 * expected to do. Generic advice is what makes awareness training forgettable, so
 * the examples are deliberately sector-specific.
 */

import type { KnowledgeTopic } from './types';

export const THREATS: KnowledgeTopic[] = [
  {
    id: 'threat-malware',
    title: 'Malware',
    slideIds: [2],
    triggers: ['malware', 'virus', 'ransomware', 'trojan', 'usb', 'antivirus', 'infected', 'macro'],
    explanation: [
      'Malware is any software that gets onto a device and acts against the interests of whoever owns it. The category matters less than the route in, because the route is the part a person controls.',
      'In practice there are four routes worth knowing. An attachment that asks to enable content, which means enable macros. An installer downloaded from somewhere other than the vendor, particularly for tools people want and cannot get approved quickly. Removable media of unknown origin. And a compromised update or supplier channel, which is the one an individual cannot defend against and which is why supplier assurance is a control in its own right.',
      'Ransomware deserves separate mention because the economics changed. Modern operators steal the data first and encrypt second, so paying does not undo the disclosure. That makes it a confidentiality failure and an availability failure at the same time, and it makes tested backups necessary but not sufficient.',
      'The behavioural defences are unglamorous and effective. Do not enable macros because a document asks you to. Install from the vendor or from the approved software route. Treat found media as hostile. Report the moment something behaves oddly, because the first fifteen minutes are worth more than the next fifteen hours.',
    ],
    examples: [
      'A spreadsheet arrives titled as a revised equipment schedule from a supplier you do actually work with. It opens with a yellow banner asking to enable editing to see the content. That banner is the attack.',
      'A USB stick left in a meeting room at a client site, or handed over at a conference with a vendor logo on it. Plugging it in to see whose it is is precisely what it is there for.',
      'A licensed engineering tool that procurement is slow to approve, so somebody finds a cracked installer. That is one of the most reliable malware vectors in technical firms, because the person doing it is trying to get work done.',
    ],
    standardRefs: [
      'A.8.7 Protection against malware. The control explicitly pairs technical defences with user awareness, because neither works alone.',
      'A.7.10 Storage media covers removable media handling.',
    ],
    misconceptions: [
      {
        belief: 'Antivirus will catch it, so I do not need to think about it.',
        correction:
          'Endpoint protection catches what it recognises. Targeted attacks are built specifically to be unrecognised, and macro-based attacks often use no malicious code at all until the moment you authorise it. The tooling is a safety net under the decision, not a substitute for it.',
      },
      {
        belief: 'It cannot be malware, it came from someone I know.',
        correction:
          'A compromised mailbox is the most effective delivery vehicle there is, because it arrives inside a real thread with real history. The sender being genuine tells you nothing about whether the sender was in control when it was sent.',
      },
      {
        belief: 'Macs and phones do not get malware.',
        correction:
          'Less commonly, and through different routes, but they absolutely do. Mobile risk skews towards over-permissioned apps and malicious profiles rather than classic viruses, which is why the mobile device policy exists separately.',
      },
    ],
    faqs: [
      {
        q: 'What do I do if I think I have already clicked something?',
        a: 'Report it immediately and do not try to tidy it up first. Do not delete the email, because it is evidence. Say what you clicked and roughly when. Nobody is in trouble for reporting quickly; the damage comes from the hour somebody spends hoping it was nothing.',
      },
      {
        q: 'Should I disconnect from the network if I suspect malware?',
        a: 'That is a judgement for whoever handles the incident, and the honest answer is to ask rather than act. Disconnecting can limit spread but can also destroy the state investigators need. Report it and follow what you are told.',
      },
    ],
  },

  {
    id: 'threat-spear-phishing',
    title: 'Spear phishing and social engineering',
    slideIds: [2],
    triggers: [
      'phishing',
      'spear',
      'social engineering',
      'suspicious email',
      'spoof',
      'pretext',
      'bec',
      'invoice',
      'vishing',
      'smishing',
      'mfa fatigue',
      'how do i spot',
    ],
    explanation: [
      'Bulk phishing is a wide net with poor bait. Spear phishing is one message written for one person using real detail, and the detail is usually gathered from entirely public sources: your role on a professional network, a project announcement, a conference attendee list, the name of a supplier from a press release.',
      'The mechanism is almost never technical. It is a pretext plus pressure plus a plausible action. The pretext gives a reason for the request, the pressure removes the pause in which you would think, and the action is something you do dozens of times a week anyway, so it does not feel like a decision.',
      'Learn the pressure patterns rather than the spelling mistakes, because the spelling mistakes are gone. Unusual urgency. A request to keep it between us. A change to payment or delivery details. A first-time request that bypasses the normal route. Authority invoked to discourage checking. Any one of those is worth a pause; two together is worth a phone call.',
      'It is not only email. A phone call claiming to be from a supplier or from internal IT is the same attack with better bandwidth, and it is harder to resist because a live human applies pressure in real time. A flood of multi-factor prompts hoping you will approve one to stop the noise is the same idea again.',
      'The single most useful habit is verification through a different channel. If an email asks for something consequential, confirm it by phone on a number you already had, not one supplied in the message. That one habit defeats nearly all of it, and it costs a minute.',
    ],
    examples: [
      'A message from a real project contact at a client, in a real thread, asking you to send the latest electrical single-line diagram to a personal address because their corporate mail is playing up. Everything is genuine except the last request.',
      'A request to quote urgently against an attached tender document, addressed to you by name and referencing a facility you have actually worked on. The attachment is the payload and the deadline is the pressure.',
      'A caller who knows the name of your site manager and the name of the commissioning contractor, saying they need the access arrangements confirmed for tomorrow. Knowing internal names is not authentication.',
      'Payment detail changes on a supplier invoice, sent from a lookalike domain a single character different from the real one. This is business email compromise and it is where the actual money goes.',
    ],
    standardRefs: [
      'A.6.3 Information security awareness, education and training. Phishing resistance is treated as a competence to be built and tested, not a warning to be issued.',
      'A.5.14 Information transfer covers the rules for sending information outside the organisation.',
    ],
    analogy:
      'A stranger at a secure door holding two coffees and a laptop bag, saying they have a meeting on the third floor and could you just get the door. Nothing about that is a technical attack. It works because helping is the normal thing to do and challenging feels rude.',
    misconceptions: [
      {
        belief: 'I would spot a phishing email, they are obviously fake.',
        correction:
          'You would spot a bulk one. A targeted one is written for you, references a real project, arrives in an existing thread, and asks for something you routinely do. Nobody spots those reliably by feel, which is why the defence is a verification habit rather than confidence.',
      },
      {
        belief: 'If the display name and signature are right, it is genuine.',
        correction:
          'Display names are free text and signatures are copy and paste. Neither is authentication. Hovering the actual sender address helps; verifying on a channel you chose helps far more.',
      },
      {
        belief: 'Reporting a suspicious email that turns out to be genuine makes me look silly.',
        correction:
          'It makes you useful. Security teams would far rather assess fifty genuine emails than miss one real attack, and a report from you often means twenty colleagues who received the same thing get warned before they click.',
      },
    ],
    faqs: [
      {
        q: 'How do I check a link without clicking it?',
        a: 'Hover over it and read the real destination in the status bar or the tooltip, and read it from the right. The important part is the domain immediately before the first single slash. On a phone, press and hold rather than tap. If the visible text and the real destination disagree at all, that is your answer.',
      },
      {
        q: 'What if the request really is from my manager and it really is urgent?',
        a: 'Then a thirty second phone call confirms it and costs almost nothing. Any manager worth working for would rather be verified than be the reason money left the company. If someone objects to being verified, that itself is information.',
      },
      {
        q: 'Why do attackers target a consultancy rather than the data centre operator directly?',
        a: 'Because you hold the designs, the drawings and the access arrangements for facilities that are much harder to attack head on, and you are a trusted sender to them. Supply chain is the path of least resistance, which is exactly why clients ask about your certification.',
      },
    ],
  },

  {
    id: 'threat-malicious-links',
    title: 'Malicious links',
    slideIds: [2],
    triggers: ['link', 'url', 'hover', 'shortened', 'qr', 'domain', 'lookalike', 'typosquat'],
    explanation: [
      'A malicious link works on a single gap: the text you read and the place you go are two different things, and only one of them is shown to you.',
      'The common dressings are worth naming. Display text that reads like a trusted destination. A lookalike domain differing by one character or with an extra word bolted on. A shortener that hides the destination entirely. A QR code, which hides it by design and is read on a phone where the address bar is truncated. And a genuine, trusted file-sharing service hosting a malicious document, which defeats domain checking altogether.',
      'Read a domain the way a machine does, from the right. The registered domain sits immediately before the first single slash. Everything to the left of it can be made to say anything at all, including the name of your own organisation.',
      'The most dangerous links do not deliver malware. They deliver a convincing sign-in page. You authenticate, the credentials go straight to the attacker, and nothing on your machine ever looks wrong. Multi-factor authentication is what turns that from a breach into an inconvenience.',
    ],
    examples: [
      "A link whose text reads like your document portal but whose real domain has your company name as a subdomain of somebody else's site. The name being present is the trick.",
      'A QR code on a printed notice at a client site, offering the visitor sign-in form. Nobody hovers a QR code, and that is the point.',
      'A shared document notification that is entirely genuine, from a real service, containing a file that is not.',
    ],
    standardRefs: [
      'A.8.23 Web filtering provides the technical layer.',
      'A.5.17 Authentication information and A.8.5 Secure authentication are what limit the damage when credentials are captured.',
    ],
    misconceptions: [
      {
        belief: 'The padlock and https mean the site is safe.',
        correction:
          'It means the connection is encrypted, nothing more. Certificates are free and attackers use them. A phishing page with a padlock is entirely normal and the padlock is doing exactly what it was designed to do.',
      },
      {
        belief: 'I only entered my password, I did not download anything, so nothing happened.',
        correction:
          'Entering the password is the incident. That is the thing of value and it has now been handed over. Report it and change the password immediately, including anywhere else you have reused it.',
      },
    ],
    faqs: [
      {
        q: 'Is it safe to click a link just to see where it goes?',
        a: "No, and there is no need. Hover to read the destination instead. If you genuinely have to reach a site, type the address you already know or use your own bookmark, rather than travelling through somebody else's link.",
      },
    ],
  },

  {
    id: 'threat-passwords',
    title: 'Passwords and authentication',
    slideIds: [2],
    triggers: [
      'password',
      'passphrase',
      'mfa',
      'two factor',
      '2fa',
      'authenticator',
      'password manager',
      'reuse',
      'credential',
      'passkey',
      'sso',
      'rotate',
      'expiry',
    ],
    explanation: [
      "The dominant risk is not weak passwords, it is reused ones. Attackers rarely guess. They take username and password pairs from somebody else's breach and try them against everything, at scale and automatically. That is credential stuffing, and it means the security of your work account depends on the security of every unrelated site where you used the same password.",
      'Length beats complexity. Substituting symbols for letters produces something hard for a human to remember and trivial for a cracking tool, because those substitutions are the first thing it tries. A long unusual passphrase of ordinary words is stronger and easier.',
      'A password manager is the practical answer, because it removes the reason people reuse. It makes every password long, unique and different, and you remember one. The objection that keeping them in one place is risky is worth taking seriously and answering: the alternative in practice is not memory, it is reuse and a spreadsheet.',
      'Multi-factor authentication is the single highest-value control an individual can have switched on, because it breaks the link between a stolen password and a lost account. It is not absolute. Prompt-bombing and real-time relay attacks exist, so the rule is that you only approve a prompt you caused. An unexpected prompt is not a nuisance, it is a report.',
      'Guidance has moved away from forced periodic rotation, because it reliably produced Autumn2024 followed by Winter2024. Change a password when there is reason to believe it is exposed. Reason to believe includes a breach notification, a phishing page you signed into, or a colleague having needed it.',
      'Never share a working credential, including with IT. Legitimate support does not need your password. Shared accounts destroy accountability, which is why an auditor treats them as a finding rather than a convenience.',
    ],
    examples: [
      'A client asks for credentials to a monitoring platform to be sent over so their contractor can log in. The correct answer is a properly provisioned account for that contractor, not a shared secret in an email.',
      'A multi-factor prompt at eleven at night that you did not trigger. That is somebody holding your password right now, and it is worth reporting before you go to sleep.',
    ],
    standardRefs: [
      'A.5.17 Authentication information covers allocation and management of credentials.',
      'A.8.5 Secure authentication covers the authentication mechanisms themselves, including multi-factor.',
      'A.5.16 Identity management is why individual accountability matters and shared accounts are discouraged.',
    ],
    analogy:
      'Reusing a password is using the same key for your house, your car, your office and your locker. Losing it once is not one problem, it is four, and you will not know which door somebody is standing at.',
    misconceptions: [
      {
        belief: 'My password is complicated, so it is strong.',
        correction:
          'Complicated in the human sense and strong in the mathematical sense are almost unrelated. A short password with symbols falls quickly; a long passphrase of plain words does not. And if it is reused anywhere, its strength is irrelevant, because it will be read rather than cracked.',
      },
      {
        belief: 'Writing passwords in a notebook is safer than software.',
        correction:
          'For someone facing remote attackers rather than office burglars, a manager is the better trade. What matters is that the notebook habit tends to come with short, reused, rarely changed passwords, whereas the manager removes the pressure that causes all three.',
      },
      {
        belief: 'MFA makes phishing irrelevant.',
        correction:
          'It makes it much harder and it is absolutely worth having. But real-time relay attacks can capture a code as you type it, and fatigue attacks rely on you approving to make the buzzing stop. The rule that survives both is to approve only what you initiated.',
      },
    ],
    faqs: [
      {
        q: 'What actually makes a good password?',
        a: 'Length and uniqueness. Four or five unrelated words is genuinely strong and genuinely memorable. Uniqueness matters more than either, because a unique password can only ever lose you one account. In practice, let a manager generate it and stop thinking about the question.',
      },
      {
        q: 'Are passkeys worth using?',
        a: 'Where they are offered, yes. A passkey keeps the secret on your device and proves possession without ever sending anything reusable, so there is nothing for a phishing page to capture. It is the first widely available mechanism that is genuinely phishing-resistant rather than phishing-resistant in theory.',
      },
      {
        q: 'Can I use my personal password manager for work credentials?',
        a: 'That is a Technavious decision rather than a general one, and it is worth asking the IT support desk rather than assuming. The relevant principle is the one on the classification slide: corporate information belongs in corporate systems, and credentials are corporate information.',
      },
    ],
    outOfScope: [
      'Whether a specific password manager is approved, the exact minimum length Technavious enforces, and which systems have multi-factor mandated. These sit in the Acceptable Use Policy and with the IT support desk.',
    ],
  },

  {
    id: 'threat-public-browsing',
    title: 'Working and browsing in public',
    slideIds: [2],
    triggers: [
      'public wifi',
      'wi-fi',
      'wifi',
      'airport',
      'cafe',
      'coffee',
      'vpn',
      'hotspot',
      'shoulder surfing',
      'train',
      'client site',
      'privacy screen',
    ],
    explanation: [
      'Two different risks get bundled under this heading, and they need separating because the defences differ.',
      "The network risk is the one people name, and it has quietly reduced. Almost everything is encrypted in transit now, so passive sniffing on an open network yields much less than it once did. What remains is a hostile access point named to look like the venue's, and the certificate warning that appears when someone tries to intercept you. That warning is the whole defence, and clicking through it is the actual mistake.",
      'The physical risk is the one people underrate and it is far more likely. Screens are readable over a shoulder on a train, in a lounge, in a client canteen. Calls are audible. Documents left on a table are photographable. Nobody needs to attack anything; they just need to be sitting behind you.',
      'For a consultancy the exposure is unusually concentrated, because the work is visibly identifiable. A floor plan, a rack elevation or a single-line diagram on screen tells a knowledgeable observer whose facility it is and how it is built.',
      'Practical defences: use the corporate connection route rather than a random open network, treat certificate warnings as a full stop, use a privacy filter for regular travel, sit with your back to a wall, take sensitive calls where they cannot be overheard, and lock the screen every time you stand up, including for thirty seconds.',
      'The most exposed place is often a client site, not a cafe, because the people around you are technically literate, interested, and may work for a competitor.',
    ],
    examples: [
      'Reviewing a client rack layout on a flight, with a passenger beside you who works in the same industry. No attack, total disclosure.',
      'A hotel network presenting a certificate warning for your mail server. That is the moment to stop, not the moment to accept and carry on.',
      'A commissioning call taken in a shared client break room, naming the facility, the redundancy shortfall and the remediation date.',
    ],
    standardRefs: [
      'A.6.7 Remote working. The 2022 revision explicitly added physical security of the remote workplace and the risk of being observed in public areas.',
      'A.7.7 Clear desk and clear screen applies wherever you are working, not just at a desk in the office.',
    ],
    misconceptions: [
      {
        belief: 'Public Wi-Fi is fine as long as I use a VPN.',
        correction:
          'A VPN handles the network risk well and does nothing whatsoever about the person reading your screen. Since the physical risk is now the larger of the two, a VPN can create false confidence in exactly the situation where you should be more careful, not less.',
      },
      {
        belief: 'The office is where I need to be careful.',
        correction:
          'The office is the controlled environment. Airports, trains, hotels and client sites are the uncontrolled ones, and that is where most accidental disclosure happens.',
      },
    ],
    faqs: [
      {
        q: 'Is it safe to charge my phone from a public USB port?',
        a: 'Use a plug socket or a charge-only cable if you can. Data transfer over a charging port is possible in principle, and while it is a rare attack in practice, the workaround costs nothing.',
      },
      {
        q: 'What if I have to work on the move and there is no private space?',
        a: 'Then choose what you work on. Answer email, do the reading, leave the drawings and the client-identifiable material until you are somewhere controlled. A privacy filter and sitting with your back to a wall handle a lot of the rest.',
      },
    ],
  },

  {
    id: 'threat-data-compromise',
    title: 'Data compromise, including the accidental kind',
    slideIds: [2, 6],
    triggers: [
      'data compromise',
      'breach',
      'leak',
      'data loss',
      'accidental',
      'wrong recipient',
      'insider',
      'exfiltration',
      'personal account',
      'aggregation',
    ],
    explanation: [
      'Data compromise is the outcome rather than the method: any loss of confidentiality, integrity or availability, however it happened. Deliberate attack is the memorable cause and the minority one.',
      'The everyday causes are ordinary. Autocomplete putting the wrong name in the To field. Reply-all on a thread that acquired an external recipient. The wrong attachment. A shared link set to anyone with the link. Work copied to a personal account to finish at home. A device left in a taxi. A drive disposed of without being wiped.',
      'Copying work to a personal account deserves singling out, because it is almost always well-intentioned and it is the rule the classification slide states in red. It moves client information into a system nobody can audit, back up, revoke or defend, and it usually survives the person leaving the company.',
      'There is a subtler failure mode worth teaching, which is aggregation. Individually harmless items can combine into something sensitive. A floor plan, a rack schedule and a maintenance calendar are each fairly dull. Together they describe when a specific facility is weakest. Classify the combination, not just the parts.',
      'The controllable variable is time. Almost every one of these is far cheaper to fix in the first ten minutes, while a link can be revoked, a message recalled, a device wiped remotely. Delay is what converts a mistake into a breach.',
    ],
    examples: [
      'A drawing pack sent to a client contact with a similar name at a different company, because autocomplete offered it and the name looked right.',
      'A survey report uploaded to a personal cloud drive to work on at the weekend, still there two years and one employer later.',
      'A shared folder link circulated internally, set to anyone with the link, then forwarded on by somebody being helpful.',
    ],
    standardRefs: [
      'A.5.14 Information transfer covers the rules for moving information about.',
      'A.8.12 Data leakage prevention is the technical layer.',
      'A.5.24 to A.5.28 cover incident management, including reporting and evidence collection.',
    ],
    misconceptions: [
      {
        belief: 'Nothing was stolen, so it is not really an incident.',
        correction:
          'The threshold is anything that might compromise confidentiality, integrity or availability. Might is doing a lot of work in that sentence. A document sent to the wrong recipient is an incident even if you are fairly sure they deleted it, because fairly sure is not evidence.',
      },
      {
        belief: 'It was only internal, so it does not count.',
        correction:
          'Internal onward disclosure is still disclosure if the recipients had no need to know, and for client information it can breach a contractual obligation regardless of where it went.',
      },
    ],
    faqs: [
      {
        q: 'I sent a document to the wrong person and they say they deleted it. Do I still report it?',
        a: 'Yes. Their assurance is kind and it is not evidence, and the decision about whether the client needs telling is not yours to carry alone. Report it, say what went where, and let the process weigh it.',
      },
      {
        q: 'What if I caused the incident? Will I be in trouble?',
        a: 'Reporting promptly is the behaviour the system is built to encourage, and it is treated as such. What causes real difficulty is a small mistake discovered late by somebody else, because by then the cheap options have gone. A no-blame reporting culture is not generosity, it is the only way the organisation finds out about anything.',
      },
    ],
  },
];
