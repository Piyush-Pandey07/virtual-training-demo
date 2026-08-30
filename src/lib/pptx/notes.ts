/**
 * Speaker notes out of a PowerPoint file.
 *
 * This is the half a PDF export destroys. Every `speakerNotes` and both
 * `internalNotes` entries in the hand-authored deck came from the original PPTX, and
 * an uploaded deck has had none of it — the trainer has been working from what is
 * printed on the slide and nothing the author wrote about how to present it.
 *
 * A .pptx is a zip of XML, so this needs no conversion service and no server: the
 * file is read in the browser and never leaves the machine it was opened on, which
 * is the same promise the PDF side already makes. Only the extracted notes are
 * uploaded.
 *
 * What it cannot do is render a slide. Nothing in a browser draws PowerPoint, so the
 * pictures still come from the PDF export. That is the division of labour: the PDF
 * carries what the slide looks like, the PPTX carries what the author said about it.
 */

import { unzipSync, strFromU8 } from 'fflate';

/** What one slide's notes look like, keyed by 1-based slide number. */
export type SlideNotes = Map<number, string[]>;

/**
 * The text runs inside an Open XML part, in document order.
 *
 * `<a:t>` is where every visible character lives, whatever paragraph or placeholder
 * wraps it. Parsing this with a regular expression is normally the wrong instinct,
 * and is right here: the alternative is an XML parser in the browser bundle to read
 * one element name out of a file we control the shape of.
 */
function textRuns(xml: string): string[] {
  const runs: string[] = [];
  for (const match of xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)) {
    const text = decodeEntities(match[1] ?? '').trim();
    if (text) runs.push(text);
  }
  return runs;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

/**
 * Joins the runs of a notes part into lines.
 *
 * PowerPoint splits a sentence across runs wherever formatting changes, so a note
 * reading "Push the OutThink Platform" arrives as three runs. Joining on paragraphs
 * would be better still; joining everything with spaces is what the hand-transcribed
 * deck effectively did and is enough for text nobody speaks aloud.
 */
function notesText(xml: string): string[] {
  // The slide number PowerPoint stamps on a notes page is a field, not a note, and
  // turns up as a lone digit. It is noise in every deck.
  const runs = textRuns(xml).filter((run) => !/^\d{1,3}$/.test(run));
  if (runs.length === 0) return [];

  const joined = runs.join(' ').replace(/\s+/g, ' ').trim();
  return joined ? [joined] : [];
}

/** Resolves a relationship target against the part that referenced it. */
function resolveTarget(fromPart: string, target: string): string {
  const clean = target.replace(/^\.\//, '');
  if (clean.startsWith('/')) return clean.slice(1);

  const dir = fromPart.slice(0, fromPart.lastIndexOf('/'));
  const segments = `${dir}/${clean}`.split('/');
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '..') out.pop();
    else if (segment !== '.' && segment !== '') out.push(segment);
  }
  return out.join('/');
}

function relationships(files: Record<string, Uint8Array>, part: string): Map<string, string> {
  const dir = part.slice(0, part.lastIndexOf('/'));
  const name = part.slice(part.lastIndexOf('/') + 1);
  const relsPath = `${dir}/_rels/${name}.rels`;

  const raw = files[relsPath];
  const map = new Map<string, string>();
  if (!raw) return map;

  const xml = strFromU8(raw);
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    if (id && target) map.set(id, resolveTarget(part, target));
  }
  return map;
}

/**
 * The speaker notes in a PowerPoint file, by slide number.
 *
 * Slides are numbered by the order the presentation lists them, and each one's notes
 * are found through its own relationships. Both matter: `slide3.xml` is not
 * necessarily the third slide, and `notesSlide3.xml` is not necessarily attached to
 * it. This deck has seven slides and five notes parts, so pairing them by counting
 * would put the wrong notes on the wrong slides — silently, and with author-only
 * content among them.
 *
 * Returns an empty map for a file that is not a PowerPoint, rather than throwing:
 * the notes are an optional extra beside the PDF, and failing to find them should
 * cost the upload nothing.
 */
export function extractSpeakerNotes(file: ArrayBuffer | Uint8Array): SlideNotes {
  const notes: SlideNotes = new Map();

  let files: Record<string, Uint8Array>;
  try {
    const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
    files = unzipSync(bytes, {
      // Only the parts that carry text. A deck is mostly images, and inflating them
      // to read none of them is the slowest thing this could do.
      filter: (entry) =>
        /^ppt\/(presentation\.xml|slides\/slide\d+\.xml|notesSlides\/notesSlide\d+\.xml)$/.test(
          entry.name,
        ) ||
        /^ppt\/(_rels\/presentation\.xml\.rels|slides\/_rels\/slide\d+\.xml\.rels)$/.test(
          entry.name,
        ),
    });
  } catch {
    return notes;
  }

  const presentation = files['ppt/presentation.xml'];
  if (!presentation) return notes;

  const presentationRels = relationships(files, 'ppt/presentation.xml');
  const xml = strFromU8(presentation);

  // Presentation order, which is what the trainee sees and what the PDF pages match.
  const slideIds = [...xml.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"[^>]*\/?>/g)]
    .map((match) => match[1])
    .filter((id): id is string => Boolean(id));

  slideIds.forEach((relId, index) => {
    const slidePart = presentationRels.get(relId);
    if (!slidePart) return;

    const notesPart = [...relationships(files, slidePart).values()].find((target) =>
      target.startsWith('ppt/notesSlides/'),
    );
    if (!notesPart) return;

    const raw = files[notesPart];
    if (!raw) return;

    const lines = notesText(strFromU8(raw));
    if (lines.length > 0) notes.set(index + 1, lines);
  });

  return notes;
}

/** Whether a file looks like something this can read, by name. */
export function isPowerPoint(name: string): boolean {
  return /\.pptx$/i.test(name.trim());
}
