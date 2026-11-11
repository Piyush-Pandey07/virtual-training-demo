/**
 * Reading in, saving and removing a deck's lesson plan (AI-43).
 *
 * The Benchmark administrator's alone, as every other deck tool is: a company
 * administrator, a facilitator or a participant gets the same 404 the deck routes give
 * them. Checked here, on the person, as well as by the route's guard, so the rule holds
 * for whatever calls this next and so the tests can drive it without a session.
 *
 * Every store is built from the person's own organisation, so a deck id from another
 * customer names nothing this can reach.
 *
 * Saving works out the alignment with the deck as it stands and stores both on the
 * deck, then asks the approval whether the deck still matches what was approved: a new
 * or changed plan changes what is taught, so it needs a fresh approval (see
 * `deckFingerprint`).
 */

import 'server-only';

import { recordAudit } from '../audit/log';
import { isAdministrator, type Permissioned } from '../auth/permissions';
import { noteDeckSaved } from '../decks/approval';
import { deckStore } from '../decks/registry';
import { DeckStoreError, type DeckStore, type StoredDeck } from '../decks/store';
import type { DocumentStore } from '../roster/documents';
import type { SignedInPerson } from '../roster/types';
import { alignLessonPlan } from './align';
import { csvAsRows, parseLessonPlanText } from './parse';
import { structureWithModel } from './structure';
import {
  LESSON_PLAN_LIMITS,
  type LessonPlan,
  type LessonPlanAlignment,
  type LessonPlanDraft,
} from './types';
import { readDraft } from './validate';

export class LessonPlanError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422 | 503,
    message: string,
    readonly problems: string[] = [],
  ) {
    super(message);
  }
}

export interface LessonPlanOptions {
  /** The document store under approvals and the audit history. For the tests. */
  store?: DocumentStore;
  now?: () => string;
  /** Structures free text. The model by default; the tests pass their own. */
  structure?: (text: string) => Promise<LessonPlanDraft | null>;
}

/** Who may upload, change or remove a lesson plan: Technavious, as for every deck tool. */
export function mayEditLessonPlan(person: Permissioned): boolean {
  return isAdministrator(person);
}

async function editableDeck(
  person: SignedInPerson,
  deckId: string,
): Promise<{ store: DeckStore; stored: StoredDeck }> {
  if (!mayEditLessonPlan(person)) throw new LessonPlanError(404, 'Not found.');
  const store = deckStore(person.orgId);
  let stored: StoredDeck | undefined;
  try {
    stored = await store.get(deckId);
  } catch (error) {
    // A malformed id or a deck that does not read is, to whoever asked, not a deck.
    if (error instanceof DeckStoreError) throw new LessonPlanError(404, 'No such deck.');
    throw error;
  }
  if (!stored) throw new LessonPlanError(404, 'No such deck.');
  if (stored.readOnly || !store.writable) {
    throw new LessonPlanError(
      409,
      'This deck lives in the build and cannot be changed, so it cannot have a lesson plan.',
    );
  }
  return { store, stored };
}

export interface ReadPlan {
  draft: LessonPlanDraft;
  /** How the sections were found: the documented outline, or the model reading prose. */
  via: 'outline' | 'model';
  /** How it would line up with this deck if saved as it is. */
  alignment: LessonPlanAlignment;
}

/**
 * Turns uploaded or pasted text into a draft plan for the administrator to check.
 *
 * Saves nothing. The outline parser first, since it is free and predictable; the model
 * only when the parser finds no sections at all.
 */
export async function readLessonPlan(
  person: SignedInPerson,
  deckId: string,
  input: { text: string; fileName?: string },
  options: LessonPlanOptions = {},
): Promise<ReadPlan> {
  const { stored } = await editableDeck(person, deckId);

  const fileName = input.fileName?.trim().slice(0, LESSON_PLAN_LIMITS.titleChars);
  const raw = input.text.slice(0, LESSON_PLAN_LIMITS.textChars);
  if (!raw.trim()) throw new LessonPlanError(400, 'The lesson plan is empty.');
  const text = fileName && /\.csv$/i.test(fileName) ? csvAsRows(raw) : raw;

  let via: ReadPlan['via'] = 'outline';
  let draft = parseLessonPlanText(text);
  if (!draft) {
    via = 'model';
    const structure =
      options.structure ?? (process.env.GEMINI_API_KEY?.trim() ? structureWithModel : undefined);
    draft = structure ? await structure(text) : null;
  }
  if (!draft) {
    throw new LessonPlanError(
      422,
      'No sections were found in that lesson plan. Lay it out as the sample is laid out, with numbered sections and a time for each, or paste it in and edit the sections by hand.',
    );
  }
  if (fileName) draft = { ...draft, sourceName: fileName };
  return { draft, via, alignment: alignLessonPlan(draft, stored.record) };
}

/** Saves a checked plan on the deck, with its alignment. */
export async function saveLessonPlan(
  person: SignedInPerson,
  deckId: string,
  raw: unknown,
  options: LessonPlanOptions = {},
): Promise<LessonPlan> {
  const { store, stored } = await editableDeck(person, deckId);
  const read = readDraft(raw);
  if (!read.ok) {
    throw new LessonPlanError(400, 'The lesson plan was not saved.', read.problems);
  }

  const plan: LessonPlan = {
    ...read.draft,
    updatedAt: (options.now ?? (() => new Date().toISOString()))(),
    alignment: alignLessonPlan(read.draft, stored.record),
  };
  const record = { ...stored.record, lessonPlan: plan };
  await store.save(record, stored.status);
  await noteDeckSaved(person, record, stored.status, { store: options.store });

  const gaps = plan.alignment!.gaps.length;
  await recordAudit(
    person,
    {
      action: stored.record.lessonPlan ? 'updated' : 'uploaded',
      subjectType: 'deck',
      subjectId: deckId,
      detail: `${stored.record.lessonPlan ? 'Changed the' : 'Uploaded a'} lesson plan for "${record.meta.title}": ${plan.sections.length} sections, ${gaps === 0 ? 'no gaps' : `${gaps} gap${gaps === 1 ? '' : 's'}`} with the deck`,
    },
    { store: options.store },
  );
  return plan;
}

/** Takes a deck's plan off it. Returns whether there was one. */
export async function removeLessonPlan(
  person: SignedInPerson,
  deckId: string,
  options: LessonPlanOptions = {},
): Promise<boolean> {
  const { store, stored } = await editableDeck(person, deckId);
  if (!stored.record.lessonPlan) return false;

  const record = { ...stored.record };
  delete record.lessonPlan;
  await store.save(record, stored.status);
  await noteDeckSaved(person, record, stored.status, { store: options.store });
  await recordAudit(
    person,
    {
      action: 'updated',
      subjectType: 'deck',
      subjectId: deckId,
      detail: `Removed the lesson plan from "${record.meta.title}"`,
    },
    { store: options.store },
  );
  return true;
}
