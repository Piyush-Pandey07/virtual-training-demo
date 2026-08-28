/**
 * PATCH and DELETE /api/decks/{id}
 *
 * Trainer edits, and removal.
 *
 * The review screen exists because generated content asserts things nobody checked,
 * and it is only a real safeguard if the trainer can actually change what they
 * disagree with. This is the endpoint behind that.
 *
 * Every editable field is listed explicitly. A patch that merged whatever it was
 * given would let a browser rewrite `image` to point anywhere, or write
 * `internalNotes`, which is the one field the whole design keeps away from both the
 * model and the trainee.
 */

import { checkReadyToPublish } from '@/lib/decks/serialise';
import { deckStore } from '@/lib/decks/registry';
import { assetStore } from '@/lib/decks/registry';
import { DeckInvalidError, DeckStoreError, type DeckStatus } from '@/lib/decks/store';
import type { DeckMeta, DeckRecord, SlideRole } from '@/lib/deck-types';

import { checkAdmin } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * The meta fields that hold a string.
 *
 * Derived rather than listed, so that `outlinePromptVersion`, which is a number, and
 * `outlineAnalysedAt`, which the trainer does not set, cannot end up here by
 * accident. Without this the assignment below widens to `never` and the whole patch
 * silently loses its type safety.
 */
type EditableMetaField = {
  [K in keyof DeckMeta]-?: DeckMeta[K] extends string ? K : never;
}[keyof DeckMeta];

/** Meta fields a trainer may edit. Everything spoken aloud, and nothing structural. */
const EDITABLE_META: EditableMetaField[] = [
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

const ROLES: SlideRole[] = ['title', 'content', 'divider', 'closing'];

/** Long enough for any of these, short enough that none becomes a paragraph. */
const MAX_META_CHARS = 600;
const MAX_TITLE_CHARS = 200;
const MAX_LABEL_CHARS = 24;
const MAX_SUMMARY_CHARS = 200;
/** A brief is instructions, not an essay. */
const MAX_BRIEF_CHARS = 1200;
/** One idea each, and the slide's own budget caps how many can be covered. */
const MAX_LIST_ITEM_CHARS = 400;
const MAX_LIST_ITEMS = 12;

interface PatchBody {
  meta?: unknown;
  slides?: unknown;
  status?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function applyMeta(meta: DeckMeta, raw: unknown, problems: string[]): DeckMeta {
  if (!isObject(raw)) return meta;

  const next: DeckMeta = { ...meta };
  for (const field of EDITABLE_META) {
    const value = raw[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      problems.push(`meta.${field} must be a string.`);
      continue;
    }
    const clean = value.trim().slice(0, MAX_META_CHARS);
    // Every one of these is spliced into a spoken sentence. An empty one would
    // leave the trainer saying "the deck is the authority on  policy".
    if (clean.length === 0) {
      problems.push(`meta.${field} cannot be empty.`);
      continue;
    }
    next[field] = clean;
  }
  return next;
}

function applySlides(deck: DeckRecord, raw: unknown, problems: string[]): DeckRecord {
  if (raw === undefined) return deck;
  if (!Array.isArray(raw)) {
    problems.push('slides must be an array.');
    return deck;
  }

  const edits = new Map<number, Record<string, unknown>>();
  for (const entry of raw) {
    if (!isObject(entry)) {
      problems.push('each slide edit must be an object.');
      continue;
    }
    const id = Number(entry.id);
    if (!Number.isInteger(id) || !deck.slides.some((slide) => slide.id === id)) {
      problems.push(`slide ${entry.id} is not in this deck.`);
      continue;
    }
    edits.set(id, entry);
  }

  return {
    ...deck,
    slides: deck.slides.map((slide) => {
      const edit = edits.get(slide.id);
      if (!edit) return slide;

      const next = { ...slide };

      if (typeof edit.title === 'string' && edit.title.trim()) {
        next.title = edit.title.trim().slice(0, MAX_TITLE_CHARS);
      }
      if (typeof edit.shortLabel === 'string' && edit.shortLabel.trim()) {
        next.shortLabel = edit.shortLabel.trim().slice(0, MAX_LABEL_CHARS);
      }
      if (typeof edit.summary === 'string' && edit.summary.trim()) {
        next.summary = edit.summary.trim().slice(0, MAX_SUMMARY_CHARS);
      }
      if (typeof edit.role === 'string') {
        if ((ROLES as string[]).includes(edit.role)) {
          next.role = edit.role as SlideRole;
          // Kept in step deliberately. A trainer marking a page as a cover expects
          // questions to stop landing on it, which is what `teaches` controls.
          next.teaches = edit.role !== 'title';
        } else {
          problems.push(`slide ${slide.id}: role must be one of ${ROLES.join(', ')}.`);
        }
      }
      if (edit.teaches !== undefined) {
        if (typeof edit.teaches === 'boolean') next.teaches = edit.teaches;
        else problems.push(`slide ${slide.id}: teaches must be true or false.`);
      }
      if (typeof edit.narrationBrief === 'string' && edit.narrationBrief.trim()) {
        next.narrationBrief = edit.narrationBrief.trim().slice(0, MAX_BRIEF_CHARS);
      }

      // Sent as an array from a textarea split on newlines, so blank lines are the
      // normal case rather than an error, and emptying the box clears the list.
      for (const field of ['keyPoints', 'discussionPrompts'] as const) {
        const value = edit[field];
        if (value === undefined) continue;
        if (!Array.isArray(value)) {
          problems.push(`slide ${slide.id}: ${field} must be an array.`);
          continue;
        }
        next[field] = value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim().slice(0, MAX_LIST_ITEM_CHARS))
          .filter((item) => item.length > 0)
          .slice(0, MAX_LIST_ITEMS);
      }

      if (edit.targetSeconds !== undefined) {
        const seconds = Number(edit.targetSeconds);
        if (Number.isFinite(seconds) && seconds >= 15 && seconds <= 300) {
          next.targetSeconds = Math.round(seconds);
        } else {
          problems.push(`slide ${slide.id}: targetSeconds must be between 15 and 300.`);
        }
      }

      return next;
    }),
  };
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const gate = await checkAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const store = deckStore();

  let stored;
  try {
    stored = await store.get(id);
  } catch (error) {
    if (error instanceof DeckInvalidError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof DeckStoreError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  if (!stored) return Response.json({ error: 'No such deck.' }, { status: 404 });
  if (stored.readOnly) {
    return Response.json(
      { error: 'The built-in deck cannot be edited. It lives in the build.' },
      { status: 409 },
    );
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const problems: string[] = [];
  let deck = stored.record;
  deck = { ...deck, meta: applyMeta(deck.meta, body.meta, problems) };
  deck = applySlides(deck, body.slides, problems);

  let status: DeckStatus = stored.status;
  if (body.status !== undefined) {
    if (body.status !== 'draft' && body.status !== 'published') {
      problems.push('status must be draft or published.');
    } else if (body.status === 'published') {
      // The publish gate. A deck the trainer has not finished is exactly what this
      // is here to stop reaching a trainee.
      const blocking = checkReadyToPublish(deck);
      if (blocking.length > 0) {
        return Response.json(
          { error: 'This deck is not ready to publish.', blocking },
          { status: 409 },
        );
      }
      status = 'published';
    } else {
      status = 'draft';
    }
  }

  if (problems.length > 0) {
    return Response.json({ error: 'Some edits were rejected.', problems }, { status: 400 });
  }

  const summary = await store.save(deck, status);
  return Response.json({ deck: summary, blocking: checkReadyToPublish(deck) });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const gate = await checkAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const store = deckStore();

  const stored = await store.get(id).catch(() => undefined);
  if (!stored) return Response.json({ error: 'No such deck.' }, { status: 404 });
  if (stored.readOnly) {
    return Response.json({ error: 'The built-in deck cannot be removed.' }, { status: 409 });
  }

  // Renders first. A deck record with no images is a broken session; orphaned
  // images with no record are invisible, so that is the better order to fail in.
  await assetStore().removeAll(id);
  await store.remove(id);

  return Response.json({ removed: id });
}
