/**
 * Reading a lesson plan out of text (AI-43).
 *
 * The documented format is a plain outline, which is what the sample file is, what a
 * Word document laid out the same way extracts to, and what an administrator can type:
 *
 *   Lesson plan: Data Centre Fundamentals
 *
 *   Session flow
 *   1. Introduction and objectives (5 min)
 *      Objective: Welcome the group and set out what the session covers.
 *   2. What a data centre is (10 min)
 *      Objective: ...
 *      Slides: 2
 *
 *   Learning outcomes
 *   - Describe what a data centre is for and why availability matters.
 *
 * Sections are numbered, or bulleted when nothing is numbered, with an optional time in
 * minutes or hours anywhere on the line. Under a section, "Objective:" gives its
 * objective, "Slides:" ties it to slide numbers, and any other line adds to the
 * objective. A table row also reads, with its cells split by tabs or bars, which is
 * how a table in a Word document and a range pasted from a spreadsheet arrive.
 *
 * Deliberately forgiving and deliberately not clever. What it cannot read it leaves out,
 * the caller falls back to the model for text with no recognisable sections, and the
 * administrator checks and edits the result before it is used either way.
 *
 * Pure, with no I/O, so the tests drive it directly.
 */

import { cleanLine, readSlideNumbers } from './validate';
import {
  LESSON_PLAN_LIMITS as LIMITS,
  type LessonPlanDraft,
  type LessonPlanSection,
} from './types';

const FLOW_HEADING =
  /^(?:the\s+)?(?:session\s+flow|lesson\s+flow|flow|session\s+plan|sections?|modules?|agenda|running\s+order|programme|program|schedule|timings?|structure|session\s+structure)\b[^:]*$/i;
const OUTCOMES_HEADING =
  /^(?:the\s+)?(?:(?:intended\s+)?learning\s+(?:outcomes?|objectives?)|outcomes?|curriculum(?:\s+outcomes?)?|course\s+objectives?|objectives?|by\s+the\s+end\s+of\s+(?:the|this)\s+(?:session|course)\b.*)$/i;
const TITLE_LINE = /^(?:lesson\s+plan|title|course(?:\s+title)?)\s*[:\-–]\s*(.+)$/i;
const OBJECTIVE_LINE =
  /^(?:objectives?|aims?|purpose|goals?|outcome|learning\s+objective)\s*[:\-–]\s*(.+)$/i;
const SLIDES_LINE = /^slides?\s*[:\-–]?\s*(\d[\d\s,\-–to&and]*)$/i;
const TIME_LINE = /^(?:time|timing|duration|length)\s*[:\-–]\s*(.+)$/i;

const NUMBERED =
  /^(?:(?:section|module|part|step|session)\s+)?(\d{1,2})\s*(?:[.):\-–]\s*|\s+)(.+)$/i;
const BULLET = /^[-*•▪●‣⁃◦]\s*(.+)$/;

/**
 * A time on a line, in minutes, with where it sat so it can be taken out of the title.
 *
 * "10 min", "10 minutes", "10m", "1 hour", "1.5 hrs", "1h 30m", and a bare number in a
 * table cell of its own.
 */
const TIME =
  /(\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?)(?:\s*(\d+)\s*(?:m|mins?|minutes?))?\b|(\d+(?:\.\d+)?)\s*(?:m|mins?|minutes?)\b/i;

function readTime(text: string): { minutes: number; at: number; length: number } | null {
  const match = TIME.exec(text);
  if (!match) return null;
  const minutes =
    match[3] !== undefined
      ? Number(match[3])
      : Number(match[1]) * 60 + (match[2] !== undefined ? Number(match[2]) : 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return { minutes: Math.round(minutes), at: match.index, length: match[0].length };
}

/** A title with its time taken out, and the brackets and separators that held it. */
function withoutTime(text: string, time: { at: number; length: number } | null): string {
  const cut = time ? `${text.slice(0, time.at)} ${text.slice(time.at + time.length)}` : text;
  return cut
    .replace(/[([{]\s*[)\]}]/g, ' ')
    .replace(/\s+[-–—:,|]\s*$/g, '')
    .replace(/^\s*[-–—:,|]\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A table row, split into cells, or null if the line is not one. */
function cellsOf(line: string): string[] | null {
  const cells = line.includes('\t') ? line.split('\t') : line.split(/\s+\|\s+|^\||\|$/);
  const kept = cells.map((cell) => cell.trim()).filter(Boolean);
  return kept.length >= 2 ? kept : null;
}

/** A header row of a table, which names its columns and holds no plan. */
function isHeaderRow(cells: string[]): boolean {
  return (
    cells.every((cell) => !/\d/.test(cell)) &&
    cells.some((cell) =>
      /^(section|module|topic|activity|title|time|minutes|duration|objective)s?$/i.test(cell),
    )
  );
}

/** One table row as a section: the time from whichever cell holds it, the rest in order. */
function sectionFromCells(cells: string[]): LessonPlanSection | null {
  const section: Partial<LessonPlanSection> = {};
  const text: string[] = [];
  for (const cell of cells) {
    const slides = cell.match(SLIDES_LINE);
    if (slides) {
      section.slides = readSlideNumbers(slides[1]);
      continue;
    }
    const time = readTime(cell);
    // A cell that is only a time, or only a number, is the time. A time inside a longer
    // cell is part of what that cell says.
    if (time && withoutTime(cell, time) === '') {
      section.minutes ??= time.minutes;
      continue;
    }
    if (/^\d+$/.test(cell)) {
      // A leading row number, or a bare number of minutes after the title.
      if (text.length > 0) section.minutes ??= Number(cell);
      continue;
    }
    text.push(cell);
  }
  if (text.length === 0) return null;
  section.title = text[0];
  if (text.length > 1) section.objective = text.slice(1).join(' ');
  return section as LessonPlanSection;
}

type Mode = 'start' | 'flow' | 'outcomes' | 'other';

/**
 * Whether an unnumbered line with a time in it names a section, as "Cooling (10 min)" or
 * "10 min: Cooling" does, rather than describing one, as "spend 5 minutes on the UPS"
 * does. Short, with the time at one end of it.
 */
function headingShaped(line: string, time: { at: number; length: number }): boolean {
  if (withoutTime(line, time).length > 80) return false;
  const end = time.at + time.length;
  return time.at <= 1 || end >= line.replace(/[)\]}.\s]+$/, '').length;
}

/** Which part of the plan a heading opens, or null if the line is not a heading. */
function isHeading(bare: string): 'flow' | 'outcomes' | null {
  if (/[.!?]$/.test(bare) || bare.length > 80 || NUMBERED.test(bare) || BULLET.test(bare)) {
    return null;
  }
  if (OUTCOMES_HEADING.test(bare)) return 'outcomes';
  if (FLOW_HEADING.test(bare)) return 'flow';
  return null;
}

/** Whether a line carries on the one before it, as a wrapped line out of a PDF does. */
function continues(line: string, previous: string | undefined): boolean {
  return Boolean(previous) && /^[a-z(]/.test(line) && !/[.!?:]$/.test(previous!.trim());
}

/**
 * The plan in the text, or null if there are no sections to be found.
 */
export function parseLessonPlanText(text: string): LessonPlanDraft | null {
  const lines = text
    .slice(0, LIMITS.textChars)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/ /g, ' ').replace(/\s+$/, ''));

  // Numbered sections make bullets sub-points of them; with none, bullets are the sections.
  // Counted outside the outcomes, which are often numbered when the flow is not.
  let inOutcomes = false;
  let numberedCount = 0;
  for (const raw of lines) {
    const bare = raw.trim().replace(/:$/, '').trim();
    const heading = isHeading(bare);
    if (heading) inOutcomes = heading === 'outcomes';
    else if (!inOutcomes && NUMBERED.test(bare)) numberedCount += 1;
  }
  const numbered = numberedCount >= 2;

  let mode: Mode = 'start';
  let title: string | undefined;
  const sections: LessonPlanSection[] = [];
  const outcomes: string[] = [];
  let current: LessonPlanSection | null = null;

  const addToObjective = (section: LessonPlanSection, extra: string) => {
    section.objective = section.objective ? `${section.objective} ${extra}` : extra;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const titled = line.match(TITLE_LINE);
    if (titled && sections.length === 0 && !title) {
      title = titled[1];
      continue;
    }

    const heading = isHeading(line.replace(/:$/, '').trim());
    if (heading) {
      mode = heading;
      current = null;
      continue;
    }

    if (mode === 'outcomes') {
      const item = (line.match(BULLET)?.[1] ?? line.match(NUMBERED)?.[2] ?? line).trim();
      if (continues(item, outcomes[outcomes.length - 1]) && !BULLET.test(line)) {
        outcomes[outcomes.length - 1] += ` ${item}`;
      } else {
        outcomes.push(item);
      }
      continue;
    }
    if (mode === 'other') continue;

    // Labelled lines under the section they belong to.
    if (current) {
      const objective = line.match(OBJECTIVE_LINE);
      if (objective) {
        addToObjective(current, objective[1]);
        continue;
      }
      const slides = line.match(SLIDES_LINE);
      if (slides) {
        current.slides = readSlideNumbers(slides[1].replace(/&/g, ','));
        continue;
      }
      const timed = line.match(TIME_LINE);
      if (timed) {
        const time = readTime(timed[1]);
        if (time) current.minutes = time.minutes;
        continue;
      }
    }

    const cells = cellsOf(line);
    if (cells) {
      if (isHeaderRow(cells)) {
        mode = 'flow';
        continue;
      }
      const section = sectionFromCells(cells);
      if (section) {
        sections.push(section);
        current = section;
        mode = 'flow';
      }
      continue;
    }

    const numberedMatch = line.match(NUMBERED);
    const bulletMatch = line.match(BULLET);
    const time = readTime(line);
    const isSection =
      (numberedMatch && numbered) ||
      (bulletMatch && !numbered && (mode === 'flow' || time !== null)) ||
      // An unnumbered line with a time, in the flow, as "Introduction, 5 minutes".
      (!numberedMatch &&
        !bulletMatch &&
        time !== null &&
        mode === 'flow' &&
        headingShaped(line, time));

    if (isSection) {
      const body = numberedMatch && numbered ? numberedMatch[2] : (bulletMatch?.[1] ?? line);
      const bodyTime = readTime(body);
      const sectionTitle = withoutTime(body, bodyTime);
      if (sectionTitle) {
        const section: LessonPlanSection = { title: sectionTitle };
        if (bodyTime) section.minutes = bodyTime.minutes;
        sections.push(section);
        current = section;
        mode = 'flow';
        continue;
      }
    }

    // Anything else under a section describes it.
    if (current) {
      addToObjective(current, (bulletMatch?.[1] ?? line).trim());
      continue;
    }
    // A heading this format does not know, after the flow has started: skip what it holds.
    if (mode === 'flow' && /:$/.test(line)) mode = 'other';
  }

  if (sections.length === 0) return null;

  const draft: LessonPlanDraft = {
    sections: sections.slice(0, LIMITS.sections).map((section) => {
      const clean: LessonPlanSection = { title: cleanLine(section.title, LIMITS.titleChars) };
      if (section.minutes && section.minutes <= LIMITS.sectionMinutes) {
        clean.minutes = section.minutes;
      }
      const objective = section.objective && cleanLine(section.objective, LIMITS.objectiveChars);
      if (objective) clean.objective = objective;
      if (section.slides && section.slides.length > 0) clean.slides = section.slides;
      return clean;
    }),
    outcomes: outcomes
      .map((outcome) => cleanLine(outcome, LIMITS.outcomeChars))
      .filter(Boolean)
      .slice(0, LIMITS.outcomes),
  };
  if (title && cleanLine(title, LIMITS.titleChars))
    draft.title = cleanLine(title, LIMITS.titleChars);
  return draft;
}

/**
 * Comma-separated text as tab-separated rows, so a .csv reads as a table.
 *
 * Quoted fields are honoured, since an objective is the kind of thing with a comma in it.
 */
export function csvAsRows(text: string): string {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);
  return rows
    .map((cells) => cells.map((cell) => cell.replace(/[\t\n]+/g, ' ').trim()))
    .map((cells) => (cells.filter(Boolean).length <= 1 ? cells.join(' ').trim() : cells.join('\t')))
    .join('\n');
}
