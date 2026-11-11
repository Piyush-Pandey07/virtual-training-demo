/**
 * What an administrator may write into the glossary, checked the same way in the form and
 * on the server (AI-21).
 *
 * Free of anything server-only, and of the imported glossary, so the form in the browser
 * runs exactly these checks before it sends anything and the route runs them again on
 * what arrives. A cap the form enforced and the server did not would be a form that lies.
 *
 * The caps are short on purpose. A definition reaches the trainer's prompt on every turn
 * that uses the term and is clipped there at 220 characters anyway; a term or an alias is
 * something a person says aloud. Longer than these is a paragraph pasted into the wrong
 * box, not a glossary entry.
 */

import { cleanText } from '../profiles/validate';
import { AMBIGUOUS_ACRONYMS, writtenAsCode } from './codes';
import { isGlossarySection, SECTION_LABELS, type GlossaryInput } from './types';

export const MAX_TERM = 80;
export const MAX_ACRONYM = 10;
export const MAX_EXPANSION = 120;
export const MAX_ALIASES = 8;
export const MAX_ALIAS = 60;
export const MAX_DEFINITION = 400;
export const MAX_REASON = 300;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * One line of plain text, cleaned as a profile field is: control and invisible characters
 * gone, and runs of space made one. Text written here reaches a model on every turn that
 * uses the term, so it gets the same care. Long dashes become a plain hyphen as well,
 * since the glossary is written without them and the trainer reads it aloud.
 */
export function cleanLine(value: unknown): string {
  if (typeof value !== 'string') return '';
  return cleanText(value.replace(/\s*[\u2013\u2014]\s*/g, ' - '));
}

function capped(label: string, value: string, max: number): string | null {
  return value.length > max ? `${label} can be at most ${max} characters.` : null;
}

/** A reason for holding or releasing an entry. */
export function checkReason(value: unknown): Checked<string> {
  const reason = cleanLine(value);
  if (!reason) return { ok: false, error: 'Give a reason, so the next person knows why.' };
  const tooLong = capped('The reason', reason, MAX_REASON);
  return tooLong ? { ok: false, error: tooLong } : { ok: true, value: reason };
}

/** The aliases, from a list or from one comma-separated line. */
function aliasesOf(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(raw.map(cleanLine).filter(Boolean))];
}

/** Checks an entry an administrator wrote, and returns it cleaned. */
export function checkEntry(body: unknown): Checked<GlossaryInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Send the entry as an object.' };
  }
  const input = body as Record<string, unknown>;

  const term = cleanLine(input.term);
  const acronym = cleanLine(input.acronym);
  const expansion = cleanLine(input.expansion);
  const aliases = aliasesOf(input.aliases);
  // A definition ends without a full stop: the trainer's prompt adds one.
  const definition = cleanLine(input.definition).replace(/[.\s]+$/, '');

  if (!term) return { ok: false, error: 'Give the term.' };
  if (!definition) return { ok: false, error: 'Give the definition.' };
  if (!isGlossarySection(input.section)) {
    return {
      ok: false,
      error: `Choose a section: ${Object.values(SECTION_LABELS).join(', ')}.`,
    };
  }

  const tooLong =
    capped('The term', term, MAX_TERM) ??
    capped('The acronym', acronym, MAX_ACRONYM) ??
    capped('The expansion', expansion, MAX_EXPANSION) ??
    capped('The definition', definition, MAX_DEFINITION) ??
    (aliases.length > MAX_ALIASES ? `Give at most ${MAX_ALIASES} other names.` : null) ??
    aliases.map((alias) => capped(`"${alias.slice(0, 20)}"`, alias, MAX_ALIAS)).find(Boolean) ??
    null;
  if (tooLong) return { ok: false, error: tooLong };

  if (acronym) {
    // An acronym is matched only as written, so one that is not written like a code
    // would never match anything, and the administrator would not find out why.
    if (!writtenAsCode(acronym)) {
      return {
        ok: false,
        error:
          'Write the acronym as it is written in documents, in capitals with no spaces, such as UPS, N+1 or HV/MV.',
      };
    }
    if (AMBIGUOUS_ACRONYMS.includes(acronym)) {
      return {
        ok: false,
        error: `${acronym} means more than one thing in this glossary, so it cannot be an entry's acronym. Put it in the term or the expansion instead.`,
      };
    }
  }

  const value: GlossaryInput = { term, definition, section: input.section };
  if (acronym) value.acronym = acronym;
  if (expansion) value.expansion = expansion;
  if (aliases.length > 0) value.aliases = aliases;
  return { ok: true, value };
}

/** A stable id for a new entry, from its term: "HV/MV Switchgear" becomes "hv-mv-switchgear". */
export function idFor(term: string): string {
  const slug = term
    .toLowerCase()
    .replace(/\+/g, '-plus-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'term';
}
