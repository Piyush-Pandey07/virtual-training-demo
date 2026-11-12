'use client';

/**
 * Text out of a lesson plan file, in the browser (AI-43).
 *
 * In the browser for the reason decks are: the file never leaves the administrator's
 * machine, only the text does, and there is no document library on the server to keep
 * patched. A PDF goes through the same reader the deck upload uses. A Word document is a
 * zip of XML, read with the same unzipper the PowerPoint notes use. Plain text, Markdown
 * and CSV are read as they are, and the server reads a CSV as a table.
 */

import { strFromU8, unzipSync } from 'fflate';

/** The file types the upload accepts, for the file picker. */
export const LESSON_PLAN_ACCEPT = '.docx,.pdf,.txt,.md,.csv';

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/** The visible text of one paragraph, tabs and line breaks kept. */
function paragraphText(xml: string): string {
  let text = '';
  for (const match of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) {
    if (match[0] === '<w:tab/>') text += '\t';
    else if (match[0] === '<w:br/>') text += '\n';
    else text += decodeEntities(match[1] ?? '');
  }
  return text.trim();
}

/**
 * The body of a Word document as lines: one per paragraph, and one per table row with
 * its cells split by tabs, which is how the outline parser reads a table.
 *
 * Word numbers a list itself rather than writing the numbers into the text, so a plan
 * whose sections are an automatic numbered list would arrive without its numbers. They
 * are put back here: top-level items as "1.", "2.", and deeper ones as bullets.
 *
 * A regular expression rather than an XML parser, as for the PowerPoint notes: the
 * elements wanted are few and fixed, and a parser in the bundle is not worth it.
 */
export function docxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (file) => file.name === 'word/document.xml' });
  const document = files['word/document.xml'];
  if (!document) throw new Error('That does not look like a Word document.');
  const xml = strFromU8(document);

  const lines: string[] = [];
  const counters = new Map<string, number>();
  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? xml;

  for (const block of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    const part = block[0];
    if (part.startsWith('<w:tbl>')) {
      for (const row of part.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)) {
        const cells = [...row[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((cell) =>
          [...cell[0].matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)]
            .map((paragraph) => paragraphText(paragraph[0]))
            .filter(Boolean)
            .join(' '),
        );
        if (cells.some(Boolean)) lines.push(cells.join('\t'));
      }
      continue;
    }

    const text = paragraphText(part);
    if (!text) continue;
    const list = part.match(/<w:numPr>[\s\S]*?<\/w:numPr>/)?.[0];
    if (list) {
      const level = Number(list.match(/<w:ilvl w:val="(\d+)"/)?.[1] ?? 0);
      const id = list.match(/<w:numId w:val="(\d+)"/)?.[1] ?? '0';
      if (level === 0) {
        const next = (counters.get(id) ?? 0) + 1;
        counters.set(id, next);
        lines.push(`${next}. ${text}`);
      } else {
        lines.push(`- ${text}`);
      }
    } else {
      lines.push(text);
    }
  }
  return lines.join('\n');
}

/** The text of an uploaded lesson plan, whatever kind of file it is. */
export async function lessonPlanFileText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) return docxText(new Uint8Array(await file.arrayBuffer()));
  if (name.endsWith('.pdf')) {
    const { readOutline } = await import('../pdf/render');
    const opened = await readOutline(file);
    try {
      return opened.outline.pages.map((page) => page.lines.join('\n')).join('\n');
    } finally {
      await opened.close().catch(() => undefined);
    }
  }
  if (name.endsWith('.doc')) {
    throw new Error('Older .doc files cannot be read. Save it as .docx or PDF and try again.');
  }
  return file.text();
}
