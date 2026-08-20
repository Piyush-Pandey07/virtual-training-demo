/** What an ISMS is, what ISO 27001 requires, and how certification actually works. */

import type { KnowledgeTopic } from './types';

export const FOUNDATIONS: KnowledgeTopic[] = [
  {
    id: 'isms-what-it-is',
    narrationPriority: 10,
    title: 'What a management system is, and what makes it an ISMS',
    slideIds: [1, 3],
    triggers: [
      'isms',
      'management system',
      'framework',
      'what is iso',
      'systematically',
      'why do we need',
      'point of this',
    ],
    explanation: [
      'A management system is just the structured way an organisation runs part of itself: the policies, the processes, the people who own them, and the checks that prove it is working. Most people have met one already without calling it that. ISO 9001 is a management system for quality. ISO 14001 is one for environmental performance.',
      'An ISMS applies that same machinery to information security. It is the framework of policies and controls through which an organisation manages security and risk across the whole business, not just in IT.',
      'The word that carries all the weight is systematically. Without an ISMS, security is a series of one-off reactions: somebody gets phished, so a warning email goes round; an auditor asks a question, so a document gets written. With an ISMS, security is a process that runs whether or not anything has gone wrong.',
      'An ISMS is deliberately risk-driven rather than checklist-driven. You identify what information matters, work out what could go wrong, decide which risks you will treat and which you will accept, and then choose controls proportionate to that. Two organisations following the same standard can quite properly end up with different controls.',
      'It is also a closed loop. You plan, you implement, you measure, you improve, and then you go round again. That is why the standard talks about continually improving rather than achieving.',
    ],
    examples: [
      "A one-off fix: an engineer loses a laptop, so IT enables disk encryption on that team's machines. An ISMS response: the loss is logged as an incident, the risk assessment for mobile devices is revisited, encryption becomes a documented requirement for every endpoint, compliance is monitored, and the internal audit checks it a year later.",
      'In consultancy work, the ISMS is why a client can ask how their design documents are handled and get the same answer from anybody at the firm, rather than an answer that depends on who they happen to ask.',
    ],
    standardRefs: [
      'ISO/IEC 27001:2022 clauses 4 to 10 are the management system requirements: context, leadership, planning, support, operation, performance evaluation, improvement.',
      'Clause 6.1.2 and 6.1.3 cover risk assessment and risk treatment, which is where the risk-driven nature of the standard is set out.',
      'Clause 10.2 is continual improvement.',
    ],
    analogy:
      'Think of the difference between someone who happens to be fit and a team with a training programme. Both might run the same time this month. Only one of them can tell you why, repeat it next year, and show you what they changed after an injury.',
    misconceptions: [
      {
        belief: "An ISMS is an IT thing, so it is the IT team's job.",
        correction:
          'Most of what breaks an ISMS has nothing to do with technology. A document emailed to the wrong client, a visitor walked into a restricted area, a laptop left on a passenger seat. The controls that catch those are behavioural, which is exactly why awareness training is a requirement of the standard rather than a nice extra.',
      },
      {
        belief: 'Once we are certified, we are secure.',
        correction:
          'Certification says the system was working when it was examined. It is a statement about process, not a guarantee about outcomes. That is precisely why there are surveillance audits and why the standard insists on continual improvement.',
      },
      {
        belief: 'The ISMS is a folder of documents.',
        correction:
          'Documents are the evidence, not the system. An auditor is looking for whether the thing described in the document is what actually happens. A beautifully written policy that nobody follows is worse than no policy, because it is a finding.',
      },
    ],
    faqs: [
      {
        q: 'What is the difference between ISO 27001 and ISO 27002?',
        a: 'ISO 27001 is the standard you get certified against. It states requirements, and it is written in the language of shall. ISO 27002 is the guidance that sits alongside it, explaining how to implement each control in Annex A. You are audited against 27001; you read 27002 to work out what good looks like.',
      },
      {
        q: 'Is ISO 27001 the same as GDPR or DPDP compliance?',
        a: 'No, though they help each other. Data protection law is about personal data specifically and carries legal obligations. ISO 27001 covers all information the organisation cares about, personal or not, and is a voluntary certification. A working ISMS makes demonstrating data protection compliance a great deal easier, because the evidence is already being produced.',
      },
      {
        q: 'Why does this apply to me if I am an engineer, not in IT?',
        a: "Because you handle the information the ISMS exists to protect. Site survey data, client drawings, commissioning records, access credentials for someone else's facility. The controls that keep those safe are mostly things you do rather than things a system does for you.",
      },
    ],
  },

  {
    id: 'iso27001-structure',
    narrationPriority: 30,
    title: 'How the standard is put together',
    slideIds: [3],
    triggers: [
      'annex a',
      'controls',
      'how many controls',
      'clause',
      'structure of the standard',
      '93',
      'iso 27002',
      'statement of applicability',
      'soa',
    ],
    explanation: [
      'The standard has two halves and it helps enormously to know which one you are talking about. Clauses 4 to 10 are the management system itself, and they are all mandatory. Annex A is a catalogue of controls you select from based on your risk assessment.',
      'In the 2022 version Annex A holds 93 controls, reorganised into four themes: 37 organisational, 8 people, 14 physical, and 34 technological. The 2013 version had 114 controls across 14 domains, so anyone who learned the old numbering will find things have moved.',
      'You are not required to implement all 93. You are required to consider all of them, decide which apply, and be able to justify anything you leave out. That justification lives in the Statement of Applicability, which is one of the first documents an auditor asks for.',
      'Annex A controls are the ones staff tend to meet, because they are the practical ones: clear desk, access control, backup, classification. The clauses are what management is accountable for.',
    ],
    standardRefs: [
      'Annex A themes: A.5 Organisational (37), A.6 People (8), A.7 Physical (14), A.8 Technological (34).',
      'Clause 6.1.3 d) requires the Statement of Applicability.',
      'Clause 7.5 covers documented information, which is where document control requirements come from.',
    ],
    misconceptions: [
      {
        belief: 'You have to implement all 93 controls to be certified.',
        correction:
          'You have to consider all of them and justify your decisions. An organisation with no software development function will quite reasonably exclude the secure development controls, and an auditor will accept that if the reasoning is recorded.',
      },
    ],
    faqs: [
      {
        q: 'What does an auditor actually ask staff during an audit?',
        a: 'Usually something disarmingly simple. Where do you save your work. What would you do if you got a suspicious email. Can you show me how you would report an incident. How do you know whether a document is confidential. They are testing whether the policy is real, and they can tell within about two questions.',
      },
      {
        q: 'How does the certification process work?',
        a: 'In two stages. Stage one is a documentation review, checking the ISMS is designed properly and the scope makes sense. Stage two is the implementation audit, where they look for evidence the thing actually runs. After certification there are surveillance audits, normally annually, and a full recertification at the three year mark.',
      },
    ],
  },

  {
    id: 'isms-benefits',
    narrationPriority: 20,
    title: 'Why an organisation bothers',
    slideIds: [3],
    triggers: [
      'benefit',
      'why bother',
      'business case',
      'reputation',
      'cost',
      'efficiency',
      'regulatory',
      'win work',
      'tender',
    ],
    explanation: [
      'The four benefits on the slide are real, but they land better with the reasoning attached.',
      'Regulatory compliance: most of what data protection law asks for is already an ISMS control. If you are doing access control, classification, incident management and supplier assurance properly, you are most of the way there and, more importantly, you can prove it.',
      'Reputation: in practice this means winning work. Certification is increasingly a gate rather than a differentiator, particularly with banks, hyperscalers and government clients. No certificate, no place in the tender.',
      'Efficiency: this is the one people are most sceptical about, and it comes from removing the guesswork. When there is one documented way to classify and store a client drawing, nobody spends twenty minutes deciding, and nobody does it three different ways.',
      'Lower cost: the saving is in incidents that do not happen and rework that is avoided. Compliance retrofitted after the fact is far more expensive than compliance designed in, which is the same argument Technavious makes to clients about certification on their own facilities.',
    ],
    examples: [
      'A client asks for a security questionnaire before awarding a contract. Without an ISMS that is a fortnight of scrambling across several teams. With one, the answers already exist as evidence and it is an afternoon.',
    ],
    faqs: [
      {
        q: 'Does certification actually help us win work?',
        a: 'Increasingly it is the price of entry rather than an advantage. Regulated clients, and anyone whose own auditors will ask about their supply chain, need to see it. The point at which you notice it is when a tender asks for the certificate number and you have one.',
      },
    ],
  },

  {
    id: 'cia-triad',
    narrationPriority: 60,
    title: 'Confidentiality, integrity and availability',
    slideIds: [2, 6, 7],
    triggers: [
      'cia',
      'confidentiality',
      'integrity',
      'availability',
      'triad',
      'what does compromise mean',
    ],
    explanation: [
      'Almost every definition in information security rests on these three, and it is worth being precise about them because most people can name them but only reach for the first.',
      'Confidentiality is information being seen only by those entitled to see it. This is the one everybody thinks of, and it is what a leak breaks.',
      'Integrity is information being accurate and complete, and only changed by those entitled to change it. A tampered figure is an integrity failure, but so is an honest transcription error in a commissioning record. Integrity failures are the quiet ones, because nothing looks wrong.',
      'Availability is information being there when it is legitimately needed. Ransomware is an availability failure. So is the only copy of a report sitting on a laptop that has died, and so is the person who knows the password being on leave.',
      'The reason to hold all three in mind is that the reporting threshold is defined against them. Anything that might compromise any one of the three is reportable, which is a much wider net than most people assume when they hear the word incident.',
    ],
    examples: [
      'Confidentiality: a client single-line diagram forwarded to the wrong distribution list.',
      'Integrity: a load figure mistyped in a capacity study, and the design sized on it.',
      'Availability: the only copy of an as-built drawing set held on a local drive that fails, with no backup, two days before handover.',
    ],
    analogy:
      'A patient record makes it concrete. Confidentiality is the wrong person reading it. Integrity is the blood type being wrong. Availability is nobody being able to find it in an emergency. All three are harm, and the second one is the one that kills quietly.',
    misconceptions: [
      {
        belief: 'A security incident means a hacker or a breach.',
        correction:
          'Most incidents are mundane and internal. A screen left unlocked, a document sent to the wrong address, a lost USB stick, a backup that has silently not run for a month. Those all compromise one of the three, and they are all reportable.',
      },
    ],
    faqs: [
      {
        q: 'Is losing data an availability problem or a confidentiality problem?',
        a: 'It depends what happened to it. If it is gone and nobody else has it, that is availability. If somebody else now has a copy, that is confidentiality. If it has been altered, that is integrity. A single event can break more than one, which is why the reporting rule covers all three rather than asking you to categorise it first.',
      },
    ],
  },
];
