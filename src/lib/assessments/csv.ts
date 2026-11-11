/**
 * Reading a question bank from a CSV, and the template the user team fills in.
 *
 * Pure and free of server imports, because the administrator's screen runs the same
 * parser to preview an upload before saving it, and the server runs it again on what is
 * saved. One parser means the preview cannot promise something the save then refuses.
 *
 * The layout is one question per row: the question, up to six options, and which option
 * is correct, as a number from 1 or a letter from A. Spreadsheets save this shape without
 * any special handling, which matters more than anything else about it, because whoever
 * writes the banks will write them in Excel.
 */

import {
  MAX_OPTION_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTION_LENGTH,
  MAX_QUESTIONS,
  MIN_OPTIONS,
  type BankQuestion,
} from './types';

export const CSV_HEADER = [
  'question',
  'option_1',
  'option_2',
  'option_3',
  'option_4',
  'option_5',
  'option_6',
  'correct',
] as const;

/** Offered for download beside the upload, with two worked rows to copy. */
export const CSV_TEMPLATE =
  [
    CSV_HEADER.join(','),
    '"What is the main purpose of an information security policy?","To set out how the organisation protects its information","To list every password in use","To replace staff training","","","",1',
    '"Which of these should you do with a suspicious email?","Reply asking who sent it","Report it using the agreed process","Forward it to colleagues to check","Delete it and say nothing","","",B',
  ].join('\r\n') + '\r\n';

export const CSV_TEMPLATE_FILENAME = 'question-bank-template.csv';

export interface CsvProblem {
  /** The row as a spreadsheet numbers it, counting the header as row 1. */
  row: number;
  message: string;
}

export interface ParsedBank {
  questions: Omit<BankQuestion, 'id'>[];
  problems: CsvProblem[];
}

/**
 * Splits CSV text into rows of fields.
 *
 * Handles what Excel and Google Sheets actually write: a byte order mark, CRLF or LF line
 * ends, fields in double quotes, doubled quotes inside them, and commas and line breaks
 * inside quoted fields. Each row carries the line it started on, so a problem can be
 * reported where the person will look for it even when a quoted field spans lines.
 */
export function splitCsv(text: string): { line: number; fields: string[] }[] {
  const source = text.replace(/^﻿/, '');
  const rows: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  const endField = () => {
    fields.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push({ line: rowLine, fields });
    fields = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') endField();
    else if (char === '\r' && source[i + 1] === '\n') continue;
    else if (char === '\n' || char === '\r') {
      endRow();
      line += 1;
      rowLine = line;
    } else field += char;
  }
  if (field.length > 0 || fields.length > 0) endRow();

  // Spreadsheets leave whole rows of empty cells behind, and a blank line at the end is
  // normal. Neither is a question with problems; both are nothing.
  return rows.filter((row) => row.fields.some((value) => value.trim() !== ''));
}

/** Which option is correct, from a number counting from 1 or a letter from A. */
function correctIndexOf(value: string): number | null {
  const text = value.trim().toUpperCase();
  if (/^[1-9]$/.test(text)) return Number(text) - 1;
  if (/^[A-Z]$/.test(text)) return text.charCodeAt(0) - 'A'.charCodeAt(0);
  return null;
}

/** Whether a row is the header, so a file with or without one reads the same. */
function isHeader(fields: string[]): boolean {
  return (fields[0] ?? '').trim().toLowerCase() === 'question';
}

/**
 * Reads a bank, reporting every bad row rather than stopping at the first.
 *
 * A bad row is never guessed at: a gap between options, a correct answer that points at
 * an empty option, or two identical options would each be "fixable" by an assumption, and
 * an assumption about which answer is right is exactly the mistake that marks somebody
 * wrong for being right. The administrator is shown the row and fixes the file.
 *
 * The good rows are returned beside the problems, so the preview can show both, but a
 * file with any problem is not saved at all (see `bankFromCsv`). Saving the good rows and
 * dropping the bad would leave a bank shorter than the one the user team wrote, with
 * nobody told.
 */
export function parseBankCsv(text: string): ParsedBank {
  const rows = splitCsv(text);
  const problems: CsvProblem[] = [];
  const questions: Omit<BankQuestion, 'id'>[] = [];

  const body = rows.length > 0 && isHeader(rows[0]!.fields) ? rows.slice(1) : rows;
  if (body.length === 0) {
    return { questions, problems: [{ row: 1, message: 'The file has no questions in it.' }] };
  }
  if (body.length > MAX_QUESTIONS) {
    problems.push({
      row: body[MAX_QUESTIONS]!.line,
      message: `A bank can hold at most ${MAX_QUESTIONS} questions, and this file has ${body.length}.`,
    });
  }

  for (const { line, fields } of body.slice(0, MAX_QUESTIONS)) {
    const say = (message: string) => problems.push({ row: line, message });

    // The correct answer is the last column, whatever the number of options before it,
    // so a file written with four option columns instead of six still reads.
    if (fields.length < 4) {
      say('Each row needs a question, at least two options, and which option is correct.');
      continue;
    }
    const question = fields[0]!.trim();
    const correctCell = fields[fields.length - 1]!;
    const optionCells = fields.slice(1, -1).map((value) => value.trim());

    if (optionCells.length > MAX_OPTIONS) {
      say(
        `There are ${optionCells.length} option columns. A question can have at most ${MAX_OPTIONS}.`,
      );
      continue;
    }

    // Trailing empty options are simply unused columns. An empty one before a filled one
    // is a gap, and which number the "correct" column then means is anybody's guess.
    let used = optionCells.length;
    while (used > 0 && optionCells[used - 1] === '') used -= 1;
    const options = optionCells.slice(0, used);

    let bad = false;
    if (!question) {
      say('The question is empty.');
      bad = true;
    } else if (question.length > MAX_QUESTION_LENGTH) {
      say(`The question is ${question.length} characters long. Keep it to ${MAX_QUESTION_LENGTH}.`);
      bad = true;
    }
    if (options.length < MIN_OPTIONS) {
      say(`A question needs at least ${MIN_OPTIONS} options.`);
      bad = true;
    }
    const gap = options.indexOf('');
    if (gap >= 0) {
      say(
        `Option ${gap + 1} is empty but a later option is filled in. Move the options up to close the gap.`,
      );
      bad = true;
    }
    const long = options.findIndex((option) => option.length > MAX_OPTION_LENGTH);
    if (long >= 0) {
      say(`Option ${long + 1} is longer than ${MAX_OPTION_LENGTH} characters.`);
      bad = true;
    }
    const lowered = options.map((option) => option.toLowerCase());
    const repeated = lowered.findIndex(
      (option, index) => option && lowered.indexOf(option) !== index,
    );
    if (repeated >= 0) {
      say(`Option ${repeated + 1} is the same as an earlier option.`);
      bad = true;
    }

    const correctIndex = correctIndexOf(correctCell);
    if (correctIndex === null) {
      say(
        correctCell.trim()
          ? `"${correctCell.trim()}" is not an option number. Use 1 to ${MAX_OPTIONS}, or A to F.`
          : 'Say which option is correct, as 1 to 6 or A to F.',
      );
      bad = true;
    } else if (correctIndex >= options.length) {
      say(
        `The correct answer is option ${correctIndex + 1}, but the question has only ${options.length} options.`,
      );
      bad = true;
    }

    if (!bad && correctIndex !== null) questions.push({ question, options, correctIndex });
  }

  return { questions, problems };
}

/**
 * A bank's questions from a CSV, or every reason it cannot be saved.
 *
 * What the server saves from. All or nothing, for the reason given on `parseBankCsv`.
 */
export function bankFromCsv(
  text: string,
): { ok: true; questions: Omit<BankQuestion, 'id'>[] } | { ok: false; problems: CsvProblem[] } {
  const parsed = parseBankCsv(text);
  if (parsed.problems.length > 0) return { ok: false, problems: parsed.problems };
  return { ok: true, questions: parsed.questions };
}
