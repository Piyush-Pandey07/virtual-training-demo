/**
 * Information classification: the four tiers, and how to actually apply them.
 *
 * This is the slide trainees ask most about, because it is the one that changes
 * what they do at their desk. The tier definitions and the impact tests come from
 * the deck and its presenter notes. Everything else here is practice.
 */

import type { KnowledgeTopic } from './types';

export const CLASSIFICATION: KnowledgeTopic[] = [
  {
    id: 'classification-tiers',
    title: 'The four tiers and how to choose between them',
    slideIds: [5],
    triggers: [
      'classif',
      'secret',
      'confidential',
      'internal use',
      'public',
      'tier',
      'level',
      'matrix',
      'sensitivity',
      'how do i decide',
      'which category',
    ],
    explanation: [
      'The four tiers run from most to least restricted: Secret, Confidential, Internal Use, Public. The definitions on the slide describe who may see each one. The presenter notes carry something more useful, which is the impact test: what would happen if this got out.',
      'The impact test is what people actually use, because the who-may-see definitions are circular in practice. You rarely know the authorised list up front, but you can usually judge the damage.',
      'Secret is where disclosure would seriously damage long-term objectives or threaten the survival of the organisation. Confidential is significant short-term damage to operations or business objectives. Internal Use is minor reputational or operational damage. Public is no harm at all.',
      'Two rules keep you out of trouble. First, classify by consequence, not by how the document feels. A single unremarkable figure can be Confidential if it is the number that decides a tender. Second, when genuinely torn between two tiers, take the higher one and then ask, rather than taking the lower one and finding out.',
      'Over-classification is a real cost, not a safe default. If everything is Confidential, nothing is, because people stop reading the label and start working around the handling rules. The discipline cuts both ways.',
      'Client information carries the additional constraint that the obligation is often contractual. Whatever the classification scheme says, an NDA may say something stricter, and the stricter one wins.',
      'Classification is not permanent. A tender price is Confidential before award and close to Public after it. A design is sensitive until the facility is decommissioned. Review it when the context changes, particularly before reusing something as a case study or a reference design.',
    ],
    examples: [
      'Secret: a live acquisition discussion, or a consolidated risk register for a client facility that names exploitable single points of failure.',
      'Confidential: a client TVRA report, an electrical single-line diagram, a tender price before award, personal data of staff or client contacts, a site survey identifying security weaknesses.',
      'Internal Use: an internal process document, a project status report with no client-identifying detail, an org chart, an internal training deck like this one.',
      'Public: the certification status, a published case study once approved for release, marketing material, the service brochure.',
      'A worked edge case. A client rack elevation on its own is arguably Confidential. Add the maintenance window calendar and the generator test schedule and the combination tells someone precisely when the facility is least resilient, which pushes the bundle upward. Classify what you are actually sending.',
    ],
    standardRefs: [
      'A.5.12 Classification of information. It requires classification on the basis of confidentiality, integrity, availability and the requirements of interested parties, which is where contractual obligations enter.',
      'A.5.13 Labelling of information. A.5.12 sets the sensitivity; A.5.13 is the visible marker that communicates it.',
      'A.5.14 Information transfer governs how each tier may be sent.',
    ],
    analogy:
      'Think of it as the difference between a postcard, a sealed letter, a signed-for delivery and a courier who checks identification. Same postal system, four levels of assurance, chosen by what happens if the wrong person opens it.',
    misconceptions: [
      {
        belief: 'Classification only applies to documents.',
        correction:
          'It applies to information in any form. A conversation, a photograph of a whiteboard, a screen share, a verbal briefing, a drawing pinned to a wall. The tier follows the information, not the file format.',
      },
      {
        belief: 'If in doubt, mark everything Confidential. It is safer.',
        correction:
          'It feels safer and it degrades the scheme. When everything is Confidential the label stops carrying information, handling rules get treated as obstacles, and the genuinely sensitive material loses the protection that came from standing out.',
      },
      {
        belief: 'Internal Use means anyone at Technavious can have it.',
        correction:
          'It means it may be shared within the organisation, which is not the same as it should be. Need to know still applies. Internal Use sets the outer boundary, not an invitation.',
      },
      {
        belief: 'Once classified, always classified.',
        correction:
          'Sensitivity is a function of context and context moves. The point to re-examine is when you reuse something, particularly for marketing or as a reference design, because that is where old material gets published.',
      },
    ],
    faqs: [
      {
        q: 'Where would a client site survey report sit?',
        a: 'Confidential as a rule, and worth a second look. A survey that identifies exploitable weaknesses in a live facility is doing more than describing a building, and if it names single points of failure it is heading towards Secret. It will also usually be covered by an NDA that sets its own terms.',
      },
      {
        q: 'What about emails? Do I have to label every one?',
        a: 'The classification applies to the content whether or not you type a label. Where a marking matters is when the recipient would otherwise not know, particularly for anything leaving the organisation. The exact labelling convention is set out in the Information Classification Policy, so follow that rather than inventing one.',
      },
      {
        q: 'Who decides the classification?',
        a: 'In practice whoever creates or receives the information makes the first call, which is why this session exists. The owner of that information can revise it. If you cannot judge it, ask rather than guess, and hold it at the higher tier while you wait.',
      },
      {
        q: 'Does personal data have its own category?',
        a: 'It sits inside the same scheme, typically at Confidential or above, but it carries legal obligations on top of the classification. Data protection law adds duties about purpose, retention and the rights of the individual that classification alone does not cover.',
      },
    ],
    outOfScope: [
      'The exact labelling format, the approved storage locations beyond the OneDrive recommendation, retention periods, and the process for reclassifying or declassifying something. All of that is in the Information Classification Policy.',
    ],
  },

  {
    id: 'classification-handling',
    title: 'Handling, labelling and storage in practice',
    slideIds: [5],
    triggers: [
      'handling',
      'labelling',
      'labeling',
      'storage',
      'onedrive',
      'sync',
      'approved storage',
      'personal account',
      'sharepoint',
      'usb',
      'print',
      'dispose',
      'where do i save',
    ],
    explanation: [
      'The slide sets three obligations, and they map onto three different failure modes.',
      'Handling is about what you may do with something: who you may send it to, whether it may leave the organisation, whether it may be printed, how it must be destroyed. The Information Classification Policy is the authority.',
      'Labelling is about the next person. You know what you created; the colleague who finds it in a shared folder in eighteen months does not. It applies to non-digital material too, which in this line of work means printed drawings, marked-up plans and site notebooks.',
      'Storage is the one with a single hard rule attached: Technavious-approved storage only, and the deck recommends OneDrive for end users with sync switched on.',
      'The reason sync matters is that it converts a local file into a backed-up, recoverable, discoverable one. Without it the only copy of something sits on one laptop, which turns an ordinary hardware failure into an availability incident and a lost laptop into a confidentiality one.',
      'The red bar on the slide is the rule most often broken and the one worth landing hard: personal accounts must not be used for corporate or client information. It is a single sentence and it covers personal email, personal cloud storage, personal messaging apps, personal note-taking apps, and personal AI tools. Approved storage is auditable, backed up, revocable when someone leaves, and defensible to a client. A personal account is none of those.',
    ],
    examples: [
      'Working on a report at the weekend by emailing it to a personal address. Ordinary, well-intentioned, and exactly what the red rule prohibits. The approved route is the corporate one, which exists for precisely this.',
      'A drawing pack printed for a site visit and left in the car overnight. Media handling covers printed material too, and a car is not approved storage.',
      'A folder of client drawings held only in a local project directory, never synced. Nothing is wrong until the disk fails, and then everything is.',
      'Pasting client design detail into a personal AI assistant to summarise it. The information has left the organisation, into a system nobody can audit or revoke.',
    ],
    standardRefs: [
      'A.5.13 Labelling of information.',
      'A.5.10 Acceptable use of information and other associated assets.',
      'A.7.10 Storage media, and A.7.14 Secure disposal or re-use of equipment.',
      'A.8.13 Information backup, which is what sync is quietly delivering.',
    ],
    misconceptions: [
      {
        belief: 'Using my personal account is fine as long as I delete it afterwards.',
        correction:
          'Deleting your copy does not undo it. The file has been in a system with its own backups, its own sync history and possibly its own indexing, none of which Technavious controls or can prove anything about afterwards. The rule has no exception for good intentions.',
      },
      {
        belief: 'Saving on my laptop is fine, it never leaves my sight.',
        correction:
          'The risk is not only theft. It is the drive failing, the machine being replaced, or you being unavailable when somebody needs the file. Approved storage with sync solves all three, and it is less effort than the alternative.',
      },
    ],
    faqs: [
      {
        q: 'How do I know whether sync is actually on?',
        a: 'The client shows a status against the folder, and files that have synced are marked as such. If you cannot tell, that is worth a ticket to the IT support desk rather than an assumption. It is the sort of thing that is silently wrong for months.',
      },
      {
        q: 'Can I use a USB stick to take drawings to a site with no connectivity?',
        a: 'That is exactly the situation the Media Handling Policy exists to govern, so check it rather than improvise. The general principles are that the media should be encrypted, that it should hold only what the visit needs, and that it is wiped afterwards. Whether removable media is permitted at all is a Technavious decision.',
      },
      {
        q: 'Can I put client information into an AI tool?',
        a: 'Treat it as sending the information outside the organisation, because that is what it is. The classification rules and the Acceptable Use Policy both apply, and whether any specific tool is approved is a question for the IT support desk. The safe default is not to paste client material into anything that is not on the approved list.',
      },
    ],
    outOfScope: [
      'Which specific storage locations are approved beyond the OneDrive recommendation, whether removable media is permitted, and which AI tools are approved. The Information Classification Policy, the Media Handling Policy and the Acceptable Use Policy cover these.',
    ],
  },
];
