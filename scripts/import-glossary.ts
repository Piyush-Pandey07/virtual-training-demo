/**
 * Turns the Benchmark team's DC glossary (a Word table) into src/lib/glossary/entries.ts.
 *
 *   npx tsx scripts/import-glossary.ts "docs/DC Glossary List.docx"
 *
 * The copy in docs/ is the version entries.ts was generated from. Replace it with the
 * new file when the glossary is revised, so the two always match.
 *
 * The glossary arrives as a .docx: one three-column table (term, acronym or full form,
 * definition) of about three hundred rows, in five sections, each starting with the
 * header row again. It is maintained in Word by people who are not developers, so the
 * file stays the source and this script is how a new version gets in. Run it, read the
 * diff of entries.ts, and commit both.
 *
 * What it does to the rows, and why, is all here rather than hand-edited into the output,
 * so that re-importing a revised file applies the same decisions again:
 *
 * - Splits the middle column, which holds an acronym, a full form, both ("ATS – Automatic
 *   Transfer Switch"), a test level ("FAT (L1)"), or a dash meaning nothing.
 * - Merges terms that appear in more than one section (UPS appears twice, Commissioning
 *   three times). The later section's definition is kept, because the sections run from
 *   the general overview to the specialist ones and the specialist wording is fuller.
 * - Applies CORRECTIONS: plain mistakes, fixed and listed.
 * - Marks HELD entries: definitions that may be wrong, kept in the file but not given to
 *   the trainer until somebody who owns the glossary confirms or rewrites them.
 * - Writes British spellings in definitions, as every Technavious document does. Matching
 *   accepts either spelling, so a slide that says "fiber" still finds "fibre".
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { unzipSync, strFromU8 } from 'fflate';

type Section =
  | 'foundation'
  | 'electrical'
  | 'mechanical'
  | 'elv-fire-security'
  | 'telecom'
  | 'testing-commissioning';

interface Row {
  term: string;
  middle: string;
  definition: string;
  section: Section;
}

/** Plain errors in the source, fixed on import. Keyed by the term as the file has it. */
const CORRECTIONS: Record<
  string,
  Partial<{ term: string; acronym: string; definition: string }>
> = {
  // TIA-942 calls it the Horizontal Distribution Area, HDA. "HAD" is a transposition.
  HAD: { term: 'HDA', acronym: 'HDA' },
};

/**
 * Definitions held back from the trainer until the glossary's owners confirm them.
 *
 * Nova speaks with authority, so a wrong definition here is taught to every trainee as
 * fact. These are kept, with the reason, so the owners can see exactly what to look at.
 */
const HELD: Record<string, string> = {
  'Thermal Energy Storage':
    'In data centres this usually means stored cooling, such as chilled water or ice tanks that carry the load through a chiller outage, not heat left in a system after shutdown.',
  'DC Shock':
    'Whether DC is more dangerous than AC is contested: DC can stop a person letting go, but IEC 60479 puts its fibrillation threshold higher than AC. Safety wording needs an owner.',
  'Tier I':
    "Tier is the Uptime Institute's scheme. Technavious certifies to TIA-942, which says Rated-1 to Rated-4. Decide which the trainer should use, and whether to mention both.",
  'Tier II': 'See Tier I.',
  'Tier III': 'See Tier I.',
  'Tier IV':
    'See Tier I. Also, Tier IV is defined by fault tolerance; 2N is a common way to achieve it, not the definition.',
};

/** American spellings in the source, written the British way in definitions. */
const BRITISH: Array<[RegExp, string]> = [
  [/\bdatacenter\b/gi, 'data centre'],
  [/\bCenter\b/g, 'Centre'],
  [/\bcenter\b/g, 'centre'],
  [/\bFiber\b/g, 'Fibre'],
  [/\bfiber\b/g, 'fibre'],
  [
    /\b(standard|local|special|author|unauthor|centr|optim|util|organ|summar)iz(e|ed|es|ing|ation)\b/gi,
    '$1is$2',
  ],
];

function british(text: string): string {
  return BRITISH.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

function textOf(xml: string): string {
  return (
    xml
      .replace(/<w:noBreakHyphen\/>/g, '<w:t>-</w:t>')
      .replace(/<w:tab\/>/g, '<w:t> </w:t>')
      .match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g)
      ?.map((run) => run.replace(/<[^>]+>/g, ''))
      .join('')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim() ?? ''
  );
}

/**
 * Which section a row is in.
 *
 * The header row repeats at the start of four blocks: the overview, electrical,
 * mechanical, and testing and commissioning. The mechanical block runs on into ELV, fire
 * and security, then telecom, with no header between them, so those two are told apart
 * by the row each begins with.
 */
const BLOCKS: Section[] = ['foundation', 'electrical', 'mechanical', 'testing-commissioning'];
const UNHEADED_STARTS: Record<string, Section> = {
  'ELV Systems': 'elv-fire-security',
  'Structured Cabling': 'telecom',
};

function readRows(docx: string): Row[] {
  const files = unzipSync(readFileSync(docx));
  const xml = strFromU8(files['word/document.xml']!);
  const rows: Row[] = [];
  let section: Section = 'foundation';
  let headers = 0;
  for (const tr of xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []) {
    const cells = (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((tc) =>
      (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(textOf).filter(Boolean).join(' '),
    );
    if (cells.length !== 3) continue;
    const [term, middle, definition] = cells as [string, string, string];
    if (term === 'Term') {
      section = BLOCKS[Math.min(headers, BLOCKS.length - 1)]!;
      headers += 1;
      continue;
    }
    // Only inside the mechanical block: Structured Cabling also appears in the overview.
    if (section !== 'foundation' && UNHEADED_STARTS[term]) section = UNHEADED_STARTS[term];
    if (!term || !definition) continue;
    rows.push({ term, middle, definition, section });
  }
  return rows;
}

interface Entry {
  id: string;
  term: string;
  acronym?: string;
  expansion?: string;
  aliases?: string[];
  definition: string;
  section: Section;
  held?: string;
}

const DASH = /^[\s\u2013\u2014-]*$/;

/** Reads the middle column into an acronym, a full form, and any extra names. */
function splitMiddle(term: string, middle: string) {
  const out: { acronym?: string; expansion?: string; aliases: string[] } = { aliases: [] };
  const cleaned = middle.replace(/\s*\/\s*$/, '').trim();
  if (DASH.test(cleaned)) return out;

  // "ATS – Automatic Transfer Switch", "IT – Information Technology"
  const both = /^([A-Z0-9][A-Za-z0-9&+-]*)\s*[\u2013\u2014-]\s+(.+)$/.exec(cleaned);
  if (both) {
    const [, acronym, expansion] = both as unknown as [string, string, string];
    // "IT Infrastructure" carries "IT" as a note on the abbreviation, not as its own.
    if (term.startsWith(`${acronym} `)) out.aliases.push(`${acronym}: ${expansion}`);
    else Object.assign(out, { acronym, expansion: term === expansion ? undefined : expansion });
    return out;
  }
  // "FAT (L1)", "IST (L4)"
  const level = /^([A-Z0-9&]+)\s*\((L\d)\)$/.exec(cleaned);
  if (level) {
    out.acronym = level[1];
    out.aliases.push(level[2]!);
    return out;
  }
  // "L5" for Operational Level Testing
  if (/^L\d$/.test(cleaned)) {
    out.aliases.push(cleaned);
    return out;
  }
  // "IR Test" for Insulation Resistance Test
  if (/^[A-Z]{2,} Test$/.test(cleaned)) {
    out.aliases.push(cleaned);
    return out;
  }
  // An acronym on its own, for a term written out: "CAC" for Cold Aisle Containment.
  if (/^[A-Z0-9][A-Za-z0-9&+-]{1,9}$/.test(cleaned) && /[A-Z]/.test(cleaned)) {
    out.acronym = cleaned;
    return out;
  }
  // A full form, for a term that is the acronym ("UPS" / "Uninterruptible Power Supply"),
  // or that starts with it ("VRLA Battery" / "Valve Regulated Lead Acid").
  out.expansion = cleaned;
  const first = term.split(' ')[0]!;
  if (looksLikeAcronym(term)) out.acronym = term;
  else if (looksLikeAcronym(first)) out.acronym = first;
  if (out.acronym && AMBIGUOUS.has(out.acronym)) delete out.acronym;
  return out;
}

/**
 * Acronyms that mean something else in this domain, so are never recorded as one.
 *
 * "DC" is a data centre far more often than direct current in these decks, "IT" is an
 * everyday word in capitals, and "N" alone is a letter.
 */
const AMBIGUOUS = new Set(['DC', 'IT', 'N', 'AC']);

/** Two or more capitals, allowing digits and lower case between: UPS, RDHx, D2C, ToR. */
function looksLikeAcronym(text: string): boolean {
  return /^[A-Z0-9][A-Za-z0-9&+-]{0,9}$/.test(text) && (text.match(/[A-Z]/g) ?? []).length >= 2;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/\+/g, '-plus-')
    .replace(/&/g, '-and-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The key two rows share when they are the same term.
 *
 * The written-out name, so "UPS" with its full form and "Power Distribution Unit" with
 * its acronym both land on the name, whichever way round a row puts them.
 */
function sameTermKey(entry: Entry): string {
  const name = entry.expansion && looksLikeAcronym(entry.term) ? entry.expansion : entry.term;
  return slug(name.replace(/s$/, '')).replace(/^fibre-optic(-cable)?$/, 'fibre-optic');
}

function build(rows: Row[]): Entry[] {
  const merged = new Map<string, Entry>();
  for (const row of rows) {
    const fix = CORRECTIONS[row.term] ?? {};
    // "Primary Water side/FWS": a name and its acronym in one cell.
    const [named, inlineAcronym] = row.term.split(/\s*\/\s*/) as [string, string | undefined];
    const term = british(fix.term ?? (inlineAcronym ? named : row.term))
      .replace(/\s*\(Cooling Context\)$/, '')
      .replace(/ side\b/, ' Side');
    const parts = splitMiddle(row.term, row.middle);
    if (inlineAcronym && looksLikeAcronym(inlineAcronym)) parts.acronym = inlineAcronym;
    let entry: Entry = {
      id: '',
      term,
      ...((fix.acronym ?? parts.acronym) ? { acronym: fix.acronym ?? parts.acronym } : {}),
      ...(parts.expansion ? { expansion: british(parts.expansion) } : {}),
      ...(parts.aliases.length ? { aliases: parts.aliases } : {}),
      definition: british((fix.definition ?? row.definition).replace(/\.$/, '')),
      section: row.section,
      ...(HELD[row.term] ? { held: HELD[row.term] } : {}),
    };
    // The two Thermal Runaways are different things, so each keeps its own entry.
    const key =
      row.term === 'Thermal Runaway (Cooling Context)'
        ? 'thermal-runaway-cooling'
        : sameTermKey(entry);
    const earlier = merged.get(key);
    if (earlier) {
      entry = {
        ...earlier,
        ...entry,
        acronym: entry.acronym ?? earlier.acronym,
        expansion: entry.expansion ?? earlier.expansion,
        // The term written out is the better name whichever row had it.
        term: entry.term.length >= earlier.term.length ? entry.term : earlier.term,
      };
      const aliases = [...new Set([...(earlier.aliases ?? []), ...(entry.aliases ?? [])])];
      if (aliases.length) entry.aliases = aliases;
    }
    entry.id = key;
    // "PDU" / "Power Distribution Unit" merged onto the written-out name says it twice.
    if (entry.expansion?.toLowerCase() === entry.term.toLowerCase()) delete entry.expansion;
    merged.set(key, entry);
  }
  return [...merged.values()];
}

function render(entries: Entry[], source: string): string {
  const body = entries.map((entry) => `  ${JSON.stringify(entry)},`).join('\n');
  return `/**
 * The Benchmark team's data centre glossary, as data.
 *
 * Generated by scripts/import-glossary.ts from "${source}". Do not edit by hand:
 * change the Word file, or the corrections in the script, and import again, so the
 * next import does not quietly undo the change. ${entries.length} entries after merging terms that
 * appear in more than one section; ${entries.filter((entry) => entry.held).length} are held back from the trainer pending review.
 */

import type { GlossaryEntry } from './types';

export const GLOSSARY: readonly GlossaryEntry[] = [
${body}
];
`;
}

const source = process.argv[2];
if (!source) throw new Error('Give the path to the glossary .docx.');
const rows = readRows(source);
const entries = build(rows);
const target = path.join(__dirname, '..', 'src', 'lib', 'glossary', 'entries.ts');
writeFileSync(target, render(entries, path.basename(source)));
console.log(`${rows.length} rows read, ${entries.length} entries written to ${target}`);
for (const section of new Set(entries.map((entry) => entry.section))) {
  console.log(`  ${section}: ${entries.filter((entry) => entry.section === section).length}`);
}
