/**
 * The bulk upload's file: the template handed out, and reading back what comes in.
 *
 * Nothing in an uploaded file is trusted. It was filled in by hand, probably in Excel,
 * and anything in it may end up in a prompt, so it gets the same cleaning, caps and
 * refusals as the profile form, through the same `readField`, plus the checks only a
 * file needs: a size cap, a header that names the columns, addresses that are addresses,
 * and an address appearing once. There is no cap on how many rows (AI-28).
 *
 * Pure, with no imports beyond the profile's own, so the tests drive it directly.
 */

import { PROFILE_FIELDS } from './types';
import type { LearnerDetails, ProfileFieldSpec } from './types';
import { cleanText, readDetails } from './validate';

/**
 * The most bytes accepted: 4 MB.
 *
 * Not a limit on how many people. AI-28 asks for none, so the file is not counted in
 * rows; this is just under the 4.5 MB the hosting platform accepts in one request
 * anyway, so somebody with a larger file is told to split it in words they can act on
 * rather than given the platform's own error. A row of the template filled to every cap
 * is a little over a kilobyte, and a typical one a tenth of that, so this is thousands
 * of people at the least.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** The column every row must fill. */
export const EMAIL_COLUMN = 'email';

/** The template's columns, in order: the address, then every profile field. */
export const TEMPLATE_COLUMNS: readonly string[] = [
  EMAIL_COLUMN,
  ...PROFILE_FIELDS.map((field) => field.column),
];

/**
 * The template, as a file.
 *
 * Starts with a byte order mark so Excel opens it as UTF-8 and keeps names in Indian
 * scripts intact, and has the header row only. An example row would sooner or later be
 * uploaded as a real person.
 */
export function templateCsv(): string {
  return `${String.fromCharCode(0xfeff)}${TEMPLATE_COLUMNS.join(',')}\r\n`;
}

export type CsvRead = { ok: true; rows: string[][] } | { ok: false; error: string };

/**
 * Reads CSV text into rows of cells, the way RFC 4180 and Excel write it: commas between
 * cells, double quotes around a cell that holds a comma, a quote or a line break, and a
 * doubled quote for a quote inside one. Either line ending.
 *
 * Given a cap, stops as soon as it has read more rows than that, rather than reading
 * the rest of a file it is going to refuse. An upload is given none (AI-28).
 */
export function parseCsv(text: string, maxRows = Number.POSITIVE_INFINITY): CsvRead {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = '';
  };

  while (i < text.length) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += char;
      i += 1;
      continue;
    }

    if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' || char === '\n') {
      endRow();
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      if (rows.length > maxRows) {
        return { ok: false, error: `The file has more than ${maxRows - 1} participants.` };
      }
    } else {
      cell += char;
    }
    i += 1;
  }

  if (quoted) {
    return {
      ok: false,
      error: 'A quoted value is never closed, so the file cannot be read. Check for a stray ".',
    };
  }
  // The last line, unless the file ended with a line break.
  if (cell !== '' || row.length > 0) endRow();
  if (rows.length > maxRows) {
    return { ok: false, error: `The file has more than ${maxRows - 1} participants.` };
  }
  return { ok: true, rows };
}

/** A header as somebody might type it, reduced to the template's spelling. */
function headerKey(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * An address worth trying: one @, something before it, and a domain with a dot.
 *
 * Deliberately plain rather than the full RFC grammar. It refuses what a spreadsheet
 * actually produces by mistake, two addresses in one cell, a name typed in the wrong
 * column, a space, and leaves the rest to the sign-in that has to work for them anyway.
 */
const EMAIL =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** The longest address the mail standards allow. */
const MAX_EMAIL = 254;

export function isUsableEmail(value: string): boolean {
  return value.length <= MAX_EMAIL && EMAIL.test(value) && !value.includes('..');
}

/** One data row, read and checked. `line` is where it sits in the file, header as 1. */
export type UploadRow =
  | {
      ok: true;
      line: number;
      email: string;
      emailKey: string;
      details: LearnerDetails;
      /** Required fields the file left empty, which the participant will be asked for. */
      missing: ProfileFieldSpec[];
    }
  | {
      ok: false;
      line: number;
      email: string;
      error: string;
      /** The line this address was first on, when that is what is wrong with it. */
      duplicateOf?: number;
    };

export type UploadRead = { ok: true; rows: UploadRow[] } | { ok: false; error: string };

/**
 * Reads a whole upload into checked rows, or refuses the file.
 *
 * The file is refused only for what makes every row unreadable: no header, no email
 * column, a column named twice. Anything wrong with one row refuses that row and keeps
 * the others, so one typo does not cost the uploader the whole batch. An address given
 * twice keeps its first row and reports the later one as a duplicate of it (AI-28).
 *
 * Columns it does not know are ignored, so a spreadsheet with a "Notes" column added
 * still works and the notes go nowhere. Required profile fields left empty are not a
 * refusal: the participant is asked to finish them on their first visit.
 */
export function readUpload(text: string): UploadRead {
  const parsed = parseCsv(text);
  if (!parsed.ok) return parsed;

  const [header, ...body] = parsed.rows;
  if (!header || header.every((cell) => cell.trim() === '')) {
    return { ok: false, error: 'The file is empty. Start from the template.' };
  }

  const columns = header.map(headerKey);
  const known = new Set(TEMPLATE_COLUMNS);
  const seen = new Set<string>();
  for (const column of columns) {
    if (!known.has(column)) continue;
    if (seen.has(column)) {
      return { ok: false, error: `The column "${column}" appears twice. Keep one.` };
    }
    seen.add(column);
  }
  if (!seen.has(EMAIL_COLUMN)) {
    // What Excel writes in a region that uses the comma as its decimal point.
    if (header.length === 1 && header[0]?.includes(';')) {
      return {
        ok: false,
        error:
          'The columns are separated by semicolons. Save the file as "CSV UTF-8 (comma delimited)".',
      };
    }
    return {
      ok: false,
      error: 'There is no email column. Start from the template and keep its first row.',
    };
  }

  const firstLine = new Map<string, number>();
  const rows: UploadRow[] = [];

  body.forEach((cells, index) => {
    const line = index + 2;
    // A row with nothing in it is a blank line at the end of a spreadsheet, not a person.
    if (cells.every((cell) => cell.trim() === '')) return;

    const values: Record<string, string> = {};
    columns.forEach((column, at) => {
      if (known.has(column)) values[column] = cells[at] ?? '';
    });

    const email = cleanText(values[EMAIL_COLUMN] ?? '');
    if (!email) {
      rows.push({ ok: false, line, email: '', error: 'No email address.' });
      return;
    }
    if (!isUsableEmail(email)) {
      rows.push({ ok: false, line, email: email.slice(0, 80), error: 'Not an email address.' });
      return;
    }
    const emailKey = email.toLowerCase();
    const earlier = firstLine.get(emailKey);
    if (earlier !== undefined) {
      rows.push({
        ok: false,
        line,
        email,
        error: `Duplicate of row ${earlier}, which is the one kept.`,
        duplicateOf: earlier,
      });
      return;
    }
    firstLine.set(emailKey, line);

    const read = readDetails(values, (field) => field.column);
    if (!read.ok) {
      rows.push({ ok: false, line, email, error: read.error });
      return;
    }
    const missing = PROFILE_FIELDS.filter(
      (field) => field.required && read.details[field.key] === undefined,
    );
    rows.push({ ok: true, line, email, emailKey, details: read.details, missing });
  });

  if (rows.length === 0) {
    return { ok: false, error: 'The file has a header but no participants.' };
  }
  return { ok: true, rows };
}
