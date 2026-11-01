/**
 * One term from the data centre glossary.
 *
 * Free of imports, so the browser can hold the list too (live transcription uses the
 * acronyms as hints).
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
  section:
    | 'foundation'
    | 'electrical'
    | 'mechanical'
    | 'elv-fire-security'
    | 'telecom'
    | 'testing-commissioning';
  /** Why this definition is not given to the trainer yet. Absent for entries in use. */
  held?: string;
}
