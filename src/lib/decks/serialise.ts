/**
 * Turning a deck into stored bytes and back.
 *
 * Once a deck comes from storage rather than from a TypeScript module, the
 * compiler stops being the thing that guarantees its shape. A hand-edited JSON
 * file, a half-written upload, or a deck stored by an older version of this code
 * are all now possible, and every one of them would otherwise surface as a session
 * that starts and then behaves strangely.
 *
 * So parsing validates, in full, and says what is wrong rather than throwing on the
 * first missing field. The alternative found during development was a session that
 * loaded, showed slide 1, and then failed on the second turn because one slide was
 * missing `targetSeconds`.
 */

import 'server-only';

import type { DeckMeta, DeckRecord, DeckSlide } from '../deck-types';
import type { KnowledgeTopic } from '../knowledge/types';

/**
 * Bumped when the stored shape changes incompatibly.
 *
 * A stored deck records the version it was written with, so a future change can
 * migrate rather than guess. Nothing migrates yet; the point is that the version is
 * already in the file when it needs to.
 */
export const DECK_FORMAT_VERSION = 1;

export interface DeckEnvelope {
  version: number;
  record: DeckRecord;
}

export type ParseResult = { ok: true; record: DeckRecord } | { ok: false; errors: string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collects a validation error rather than throwing, so one pass finds all of them. */
class Errors {
  readonly all: string[] = [];

  str(where: string, value: unknown, { allowEmpty = false } = {}): string {
    if (typeof value !== 'string') {
      this.all.push(`${where} must be a string`);
      return '';
    }
    if (!allowEmpty && value.trim() === '') this.all.push(`${where} must not be empty`);
    return value;
  }

  strArray(where: string, value: unknown): string[] {
    if (!Array.isArray(value)) {
      this.all.push(`${where} must be an array of strings`);
      return [];
    }
    return value.map((entry, index) => this.str(`${where}[${index}]`, entry));
  }

  num(where: string, value: unknown, { min = -Infinity, max = Infinity } = {}): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.all.push(`${where} must be a finite number`);
      return 0;
    }
    if (value < min || value > max) this.all.push(`${where} must be between ${min} and ${max}`);
    return value;
  }

  bool(where: string, value: unknown): boolean {
    if (typeof value !== 'boolean') {
      this.all.push(`${where} must be true or false`);
      return false;
    }
    return value;
  }
}

const META_FIELDS: Array<keyof DeckMeta> = [
  'id',
  'title',
  'subtitle',
  'spokenSubject',
  'owner',
  'ownerDescription',
  'trainerRole',
  'practitionerCredential',
  'exampleDomain',
  'exampleContext',
  'closingReminder',
];

function parseMeta(raw: unknown, e: Errors): DeckMeta {
  if (!isObject(raw)) {
    e.all.push('meta must be an object');
    return {} as DeckMeta;
  }
  const meta = {} as Record<string, string>;
  for (const field of META_FIELDS) {
    meta[field] = e.str(`meta.${field}`, raw[field]);
  }
  return meta as unknown as DeckMeta;
}

function parseSlide(raw: unknown, index: number, e: Errors): DeckSlide {
  const where = `slides[${index}]`;
  if (!isObject(raw)) {
    e.all.push(`${where} must be an object`);
    return {} as DeckSlide;
  }

  return {
    id: e.num(`${where}.id`, raw.id, { min: 1 }),
    title: e.str(`${where}.title`, raw.title),
    shortLabel: e.str(`${where}.shortLabel`, raw.shortLabel),
    summary: e.str(`${where}.summary`, raw.summary),
    image: e.str(`${where}.image`, raw.image),
    bullets: e.strArray(`${where}.bullets`, raw.bullets),
    speakerNotes: e.strArray(`${where}.speakerNotes`, raw.speakerNotes),
    internalNotes: e.strArray(`${where}.internalNotes`, raw.internalNotes),
    narrationBrief: e.str(`${where}.narrationBrief`, raw.narrationBrief),
    keyPoints: e.strArray(`${where}.keyPoints`, raw.keyPoints),
    discussionPrompts: e.strArray(`${where}.discussionPrompts`, raw.discussionPrompts),
    // An hour on one slide is not a deck, it is a mistake.
    targetSeconds: e.num(`${where}.targetSeconds`, raw.targetSeconds, { min: 1, max: 3600 }),
    teaches: e.bool(`${where}.teaches`, raw.teaches),
    ...(raw.width !== undefined
      ? { width: e.num(`${where}.width`, raw.width, { min: 1, max: 20000 }) }
      : {}),
    ...(raw.height !== undefined
      ? { height: e.num(`${where}.height`, raw.height, { min: 1, max: 20000 }) }
      : {}),
  };
}

function parseTopic(raw: unknown, index: number, e: Errors): KnowledgeTopic {
  const where = `topics[${index}]`;
  if (!isObject(raw)) {
    e.all.push(`${where} must be an object`);
    return {} as KnowledgeTopic;
  }

  const topic: KnowledgeTopic = {
    id: e.str(`${where}.id`, raw.id),
    title: e.str(`${where}.title`, raw.title),
    slideIds: Array.isArray(raw.slideIds)
      ? raw.slideIds.map((id, i) => e.num(`${where}.slideIds[${i}]`, id, { min: 1 }))
      : (e.all.push(`${where}.slideIds must be an array of slide numbers`), []),
    triggers: e.strArray(`${where}.triggers`, raw.triggers),
    explanation: e.strArray(`${where}.explanation`, raw.explanation),
  };

  if (topic.slideIds.length === 0) e.all.push(`${where} belongs to no slide, so it is unreachable`);
  if (topic.triggers.length === 0) e.all.push(`${where} has no triggers, so it can never be found`);
  if (topic.explanation.length === 0) e.all.push(`${where} has no explanation`);

  if (raw.narrationPriority !== undefined) {
    topic.narrationPriority = e.num(`${where}.narrationPriority`, raw.narrationPriority);
  }
  if (raw.examples !== undefined) topic.examples = e.strArray(`${where}.examples`, raw.examples);
  if (raw.standardRefs !== undefined) {
    topic.standardRefs = e.strArray(`${where}.standardRefs`, raw.standardRefs);
  }
  if (raw.analogy !== undefined) topic.analogy = e.str(`${where}.analogy`, raw.analogy);
  if (raw.outOfScope !== undefined) {
    topic.outOfScope = e.strArray(`${where}.outOfScope`, raw.outOfScope);
  }

  if (raw.misconceptions !== undefined) {
    if (!Array.isArray(raw.misconceptions)) {
      e.all.push(`${where}.misconceptions must be an array`);
    } else {
      topic.misconceptions = raw.misconceptions.map((entry, i) => ({
        belief: e.str(
          `${where}.misconceptions[${i}].belief`,
          isObject(entry) ? entry.belief : null,
        ),
        correction: e.str(
          `${where}.misconceptions[${i}].correction`,
          isObject(entry) ? entry.correction : null,
        ),
      }));
    }
  }

  if (raw.faqs !== undefined) {
    if (!Array.isArray(raw.faqs)) {
      e.all.push(`${where}.faqs must be an array`);
    } else {
      topic.faqs = raw.faqs.map((entry, i) => ({
        q: e.str(`${where}.faqs[${i}].q`, isObject(entry) ? entry.q : null),
        a: e.str(`${where}.faqs[${i}].a`, isObject(entry) ? entry.a : null),
      }));
    }
  }

  return topic;
}

/**
 * Checks the things that are only wrong in combination.
 *
 * Every field can be individually valid and the deck still be unusable: a topic
 * pointing at slide 12 of a seven slide deck, two slides sharing an id, or a slide
 * with no expertise behind it, which `selectKnowledge` needs in order to have
 * anything to teach from.
 */
function checkCoherence(record: DeckRecord, e: Errors): void {
  const ids = record.slides.map((slide) => slide.id);
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) e.all.push(`two slides share the id ${id}`);
    seen.add(id);
  }

  const topicIds = new Set<string>();
  for (const topic of record.topics) {
    if (topicIds.has(topic.id)) e.all.push(`two topics share the id ${topic.id}`);
    topicIds.add(topic.id);

    for (const slideId of topic.slideIds) {
      if (!seen.has(slideId)) {
        e.all.push(`topic ${topic.id} points at slide ${slideId}, which does not exist`);
      }
    }
  }

  if (record.slides.length === 0) e.all.push('a deck with no slides cannot be presented');
}

/**
 * Whether a deck is good enough to put in front of a trainee.
 *
 * Separate from parsing, because these two questions are genuinely different. A
 * deck that has just been uploaded and not yet analysed is structurally perfect
 * and has no expertise at all, and refusing to store it would mean there was
 * nowhere to put a deck between uploading it and analysing it.
 *
 * So parsing asks "is this a deck", and this asks "is this ready". Publishing is
 * gated on the second.
 */
export function checkReadyToPublish(record: DeckRecord): string[] {
  const problems: string[] = [];

  if (record.topics.length === 0) {
    problems.push(
      'this deck has no expertise behind it, so the trainer could only read the slides out',
    );
  }

  // A teaching slide with no expertise produces a narration turn with an empty
  // knowledge block, which is the one thing the whole design is against.
  for (const slide of record.slides) {
    if (!slide.teaches) continue;
    const hasTopic = record.topics.some((topic) => topic.slideIds.includes(slide.id));
    if (!hasTopic) {
      problems.push(`slide ${slide.id} teaches but has no expertise behind it`);
    }
  }

  if (!record.slides.some((slide) => slide.teaches)) {
    problems.push('no slide in this deck teaches anything');
  }

  return problems;
}

/** Serialises a deck for storage. Stable key order, so diffs are readable. */
export function serialiseDeck(record: DeckRecord): string {
  const envelope: DeckEnvelope = { version: DECK_FORMAT_VERSION, record };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Parses a stored deck, validating as it goes.
 *
 * Accepts either a bare record or the versioned envelope, so a deck written by
 * hand during development does not have to know about the envelope.
 */
export function parseDeck(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`not valid JSON: ${(error as Error).message}`] };
  }

  if (!isObject(raw)) return { ok: false, errors: ['the stored deck must be a JSON object'] };

  const body = isObject(raw.record) ? raw.record : raw;
  const version = typeof raw.version === 'number' ? raw.version : DECK_FORMAT_VERSION;

  const e = new Errors();
  if (version > DECK_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [
        `this deck was written in format version ${version}, and this build understands ${DECK_FORMAT_VERSION}`,
      ],
    };
  }

  const record: DeckRecord = {
    meta: parseMeta(body.meta, e),
    slides: Array.isArray(body.slides)
      ? body.slides.map((slide, index) => parseSlide(slide, index, e))
      : (e.all.push('slides must be an array'), []),
    topics: Array.isArray(body.topics)
      ? body.topics.map((topic, index) => parseTopic(topic, index, e))
      : (e.all.push('topics must be an array'), []),
  };

  // Only worth checking once the parts are individually sound, or the output is a
  // page of consequential errors from one missing field.
  if (e.all.length === 0) checkCoherence(record, e);

  return e.all.length > 0 ? { ok: false, errors: e.all } : { ok: true, record };
}
