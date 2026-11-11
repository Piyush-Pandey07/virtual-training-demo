/**
 * One term from the data centre glossary.
 *
 * Free of imports, so the browser can hold the types, and the administrator's glossary
 * screen the section names. The entries themselves never ship to a participant's
 * browser: live transcription is given the deck's acronyms, worked out on the server.
 */
export interface GlossaryEntry {
  id: string;
  /** As the glossary names it, with British spelling. */
  term: string;
  /** Written in capitals in the source, and matched case-sensitively, so "UPS" never matches "ups". */
  acronym?: string;
  /** The full form, when the term is an acronym or the acronym's words differ from the term. */
  expansion?: string;
  /** Other names for it: test levels such as "L4", or a note such as "IT: Information Technology". */
  aliases?: string[];
  definition: string;
  section: GlossarySection;
  /** Why this definition is not given to the trainer yet. Absent for entries in use. */
  held?: string;
}

/** The six sections of the Benchmark team's glossary, in its order. */
export const GLOSSARY_SECTIONS = [
  'foundation',
  'electrical',
  'mechanical',
  'elv-fire-security',
  'telecom',
  'testing-commissioning',
] as const;

export type GlossarySection = (typeof GLOSSARY_SECTIONS)[number];

export const SECTION_LABELS: Record<GlossarySection, string> = {
  foundation: 'Foundation',
  electrical: 'Electrical',
  mechanical: 'Mechanical',
  'elv-fire-security': 'ELV, fire and security',
  telecom: 'Telecom',
  'testing-commissioning': 'Testing and commissioning',
};

export function isGlossarySection(value: unknown): value is GlossarySection {
  return typeof value === 'string' && (GLOSSARY_SECTIONS as readonly string[]).includes(value);
}

/**
 * One entry as the live glossary keeps it in Firestore (AI-21): the entry, and who last
 * changed it.
 */
export interface GlossaryRecord extends GlossaryEntry {
  /**
   * Where it sits in the list. Matching walks entries in this order, so the seed keeps
   * the order of the imported file and the trainer is given the same terms it always was;
   * an administrator's new term goes at the end.
   */
  position: number;
  /** From the imported file, or added by an administrator. */
  origin: 'import' | 'administrator';
  /** ISO 8601. */
  updatedAt: string;
  /** The person id of whoever last changed it, or "import" for the seed. */
  updatedBy: string;
  /** When and by whom it was held. Only while `held` is set. */
  heldAt?: string;
  heldBy?: string;
  /** Why it was last released from a hold, and when, for whoever looks next. */
  released?: { reason: string; at: string; by: string };
}

/** What an administrator sends to add or change an entry. */
export interface GlossaryInput {
  term: string;
  acronym?: string;
  expansion?: string;
  aliases?: string[];
  definition: string;
  section: GlossarySection;
}
