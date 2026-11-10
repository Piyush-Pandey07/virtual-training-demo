/**
 * The live glossary: the administrator's, in Firestore, outside any organisation (AI-21).
 *
 * The glossary decides what terms mean, for every customer alike, so it is one platform
 * collection, `glossary`, beside the customer list and the developer log rather than
 * under any customer's prefix. One document per entry, keyed by the entry's id.
 *
 * Seeded from the imported file, `entries.ts`, the first time anything reads it, and
 * reset to that file again when an administrator asks. The imported file stays the
 * seed, and the fallback when Firestore is not configured or cannot be read: a
 * deployment without Firestore matches against an in-memory copy of it, and one whose
 * Firestore is down keeps the list it last loaded, so an outage costs an edit made in
 * the last few minutes rather than every definition.
 *
 * The trainer never waits on Firestore. Every turn of every session matches against the
 * glossary, so the list is loaded once per server and kept for five minutes, and an edit
 * empties the cache on the server that made it. Another server picks the edit up within
 * those five minutes, which is soon enough for a definition and saves a read on every
 * turn. The list is handed to the pure functions in `index.ts`, which build their
 * matchers once per list.
 *
 * Every change is the administrator's alone, and is refused here as well as in the route
 * and the page, so a screen that forgot to ask cannot change the glossary.
 */

import 'server-only';

import { isAdministrator, type Permissioned } from '../auth/permissions';
import { firestoreDocuments } from '../firebase/firestore';
import { orgsConfigured } from '../orgs/registry';
import { InMemoryDocumentStore, type DocumentStore } from '../roster/documents';
import { GLOSSARY } from './entries';
import type { GlossaryEntry, GlossaryInput, GlossaryRecord } from './types';
import { checkEntry, checkReason, idFor } from './validate';

export const GLOSSARY_COLLECTION = 'glossary';
/** Whether, when and by whom the collection was seeded, so it is seeded once. */
export const GLOSSARY_STATE = 'glossaryState';
const SEEDED = 'seeded';

/** How long a server keeps the list before reading it again. */
export const GLOSSARY_CACHE_MS = 5 * 60_000;
/** How long a server waits before trying again after a failed read. */
const RETRY_AFTER_FAILURE_MS = 30_000;
/** How many seed entries are written at once. */
const SEED_BATCH = 25;

/** A refusal with the status a route should send and words an administrator can act on. */
export class GlossaryRefused extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export interface GlossaryStoreOptions {
  /** The store to use instead of Firestore. For the tests. */
  store?: DocumentStore;
  /** The clock the cache is measured on. For the tests. */
  now?: () => number;
}

interface SeedState {
  at: string;
  by: string;
  entries: number;
}

const fallback = new InMemoryDocumentStore();
let defaultStore: DocumentStore | null = null;

/**
 * Firestore when it is configured, otherwise memory, which starts as the imported file
 * on every boot. Built once, because the cache below is kept per store.
 */
function documents(options: GlossaryStoreOptions): DocumentStore {
  if (options.store) return options.store;
  defaultStore ??= orgsConfigured() ? firestoreDocuments() : fallback;
  return defaultStore;
}

/** Whether edits are kept anywhere that outlives this server. For the page to say so. */
export function glossaryPersists(): boolean {
  return orgsConfigured();
}

// ------------------------------------------------------------------ the cache

interface Cached {
  entries: readonly GlossaryEntry[];
  at: number;
  ttl: number;
}

const cache = new WeakMap<DocumentStore, Cached>();
const loading = new WeakMap<DocumentStore, Promise<readonly GlossaryEntry[]>>();

/**
 * Counts the edits made on this server, so a read that started before an edit and
 * finished after it is not kept as though it were current.
 */
const generations = new WeakMap<DocumentStore, number>();

/** Empties this server's copy, after an edit or for a test. */
export function forgetGlossaryCache(options: GlossaryStoreOptions = {}): void {
  const store = documents(options);
  cache.delete(store);
  loading.delete(store);
  generations.set(store, (generations.get(store) ?? 0) + 1);
}

function byPosition(a: GlossaryRecord, b: GlossaryRecord): number {
  return a.position - b.position || a.id.localeCompare(b.id);
}

function seedRecord(entry: GlossaryEntry, position: number, at: string): GlossaryRecord {
  return { ...entry, position, origin: 'import', updatedAt: at, updatedBy: 'import' };
}

/**
 * Writes the imported file into the collection.
 *
 * On first use each entry is written only if it is absent, so two servers seeding at
 * once, or a seed that overlaps an administrator's first edit, cannot overwrite anything.
 * A reset replaces the whole collection instead, which is what it is for.
 */
async function seed(store: DocumentStore, by: string, at: string, replace: boolean) {
  for (let start = 0; start < GLOSSARY.length; start += SEED_BATCH) {
    await Promise.all(
      GLOSSARY.slice(start, start + SEED_BATCH).map((entry, offset) => {
        const record = seedRecord(entry, start + offset, at);
        return replace
          ? store.set(GLOSSARY_COLLECTION, entry.id, record)
          : store.update<GlossaryRecord>(
              GLOSSARY_COLLECTION,
              entry.id,
              (current) => current ?? record,
            );
      }),
    );
  }
  await store.set<SeedState>(GLOSSARY_STATE, SEEDED, { at, by, entries: GLOSSARY.length });
}

/**
 * Seeds the collection if it never has been. Asked before every read and every change,
 * so the first thing an administrator does on a new deployment acts on the imported file
 * rather than on an empty collection.
 */
async function ensureSeeded(store: DocumentStore, now: number): Promise<void> {
  const state = await store.get<SeedState>(GLOSSARY_STATE, SEEDED);
  if (!state) await seed(store, 'first use', new Date(now).toISOString(), false);
}

/** Every entry, in order, seeding the collection first if it never has been. */
async function readAll(store: DocumentStore, now: number): Promise<GlossaryRecord[]> {
  await ensureSeeded(store, now);
  const rows = await store.all<GlossaryRecord>(GLOSSARY_COLLECTION);
  return rows.sort(byPosition);
}

/**
 * The entries the trainer matches against: this server's copy, read again when it is
 * five minutes old.
 *
 * Never throws. A read that fails keeps the list this server last had, or the imported
 * file if it never had one, and is tried again thirty seconds later rather than on the
 * very next turn.
 */
export async function liveGlossary(
  options: GlossaryStoreOptions = {},
): Promise<readonly GlossaryEntry[]> {
  const store = documents(options);
  const now = (options.now ?? Date.now)();
  const cached = cache.get(store);
  if (cached && now - cached.at < cached.ttl) return cached.entries;

  const pending = loading.get(store);
  if (pending) return pending;

  const generation = generations.get(store) ?? 0;
  const keep = (entries: readonly GlossaryEntry[], ttl: number) => {
    if ((generations.get(store) ?? 0) === generation) cache.set(store, { entries, at: now, ttl });
    return entries;
  };
  const load: Promise<readonly GlossaryEntry[]> = readAll(store, now)
    .then((rows) => keep(Object.freeze(rows), GLOSSARY_CACHE_MS))
    .catch((error: unknown) => {
      console.error(`[glossary] could not be read, using the last list: ${String(error)}`);
      return keep(cached?.entries ?? GLOSSARY, RETRY_AFTER_FAILURE_MS);
    })
    .finally(() => {
      if (loading.get(store) === load) loading.delete(store);
    });
  loading.set(store, load);
  return load;
}

// ------------------------------------------------------- the administrator's

function refuseUnlessAdministrator(actor: Permissioned): void {
  // A 404, as for the administrator's other tools: nobody else needs to learn it exists.
  if (!isAdministrator(actor)) throw new GlossaryRefused(404, 'Not found.');
}

interface Actor extends Permissioned {
  id: string;
}

/** Every entry, held ones included, read fresh rather than from the cache. */
export async function glossaryForAdministrator(
  actor: Permissioned,
  options: GlossaryStoreOptions = {},
): Promise<GlossaryRecord[]> {
  refuseUnlessAdministrator(actor);
  return readAll(documents(options), (options.now ?? Date.now)());
}

function validated(body: unknown): GlossaryInput {
  const checked = checkEntry(body);
  if (!checked.ok) throw new GlossaryRefused(400, checked.error);
  return checked.value;
}

/**
 * An entry that already uses this term or acronym, other than the one being changed.
 *
 * Two entries for one term would each be given to the trainer, with two definitions, and
 * the glossary exists so that a term has one.
 */
function clash(
  rows: readonly GlossaryRecord[],
  input: GlossaryInput,
  except?: string,
): GlossaryRecord | undefined {
  const term = input.term.toLowerCase();
  return rows.find(
    (row) =>
      row.id !== except &&
      (row.term.toLowerCase() === term || (input.acronym && row.acronym === input.acronym)),
  );
}

function refuseClash(rows: readonly GlossaryRecord[], input: GlossaryInput, except?: string) {
  const existing = clash(rows, input, except);
  if (existing) {
    throw new GlossaryRefused(
      409,
      `The glossary already has "${existing.term}"${existing.acronym ? ` (${existing.acronym})` : ''}. Change that entry rather than adding a second one.`,
    );
  }
}

/** The input's fields on a record, with the ones it left out removed. */
function withInput(record: GlossaryRecord, input: GlossaryInput): GlossaryRecord {
  const next: GlossaryRecord = { ...record, ...input };
  if (!input.acronym) delete next.acronym;
  if (!input.expansion) delete next.expansion;
  if (!input.aliases) delete next.aliases;
  return next;
}

function changed(options: GlossaryStoreOptions): void {
  forgetGlossaryCache(options);
}

/** Adds a term at the end of the list. */
export async function addGlossaryEntry(
  actor: Actor,
  body: unknown,
  options: GlossaryStoreOptions = {},
): Promise<GlossaryRecord> {
  refuseUnlessAdministrator(actor);
  const input = validated(body);
  const store = documents(options);
  const now = (options.now ?? Date.now)();
  const rows = await readAll(store, now);
  refuseClash(rows, input);

  const taken = new Set(rows.map((row) => row.id));
  const base = idFor(input.term);
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;

  const record = withInput(
    {
      id,
      ...input,
      position: Math.max(-1, ...rows.map((row) => row.position)) + 1,
      origin: 'administrator',
      updatedAt: new Date(now).toISOString(),
      updatedBy: actor.id,
    },
    input,
  );
  await store.update<GlossaryRecord>(GLOSSARY_COLLECTION, id, (current) => {
    if (current) throw new GlossaryRefused(409, 'Somebody added that term a moment ago.');
    return record;
  });
  // AUDIT: record the addition here, with the new entry, once recordAudit lands.
  changed(options);
  return record;
}

/** Changes an entry's words. Its place, origin and any hold stay as they were. */
export async function editGlossaryEntry(
  actor: Actor,
  id: string,
  body: unknown,
  options: GlossaryStoreOptions = {},
): Promise<GlossaryRecord> {
  refuseUnlessAdministrator(actor);
  const input = validated(body);
  const store = documents(options);
  const now = (options.now ?? Date.now)();
  refuseClash(await readAll(store, now), input, id);

  const after = await store.update<GlossaryRecord>(GLOSSARY_COLLECTION, id, (current) => {
    if (!current) throw new GlossaryRefused(404, 'That entry is not in the glossary.');
    return {
      ...withInput(current, input),
      id,
      updatedAt: new Date(now).toISOString(),
      updatedBy: actor.id,
    };
  });
  // AUDIT: record the edit here, with the entry before and after, once recordAudit lands.
  // The entry as it was is `current` inside the change above, and can be kept from there.
  changed(options);
  return after;
}

/** Holds an entry back from the trainer, saying why. */
export async function holdGlossaryEntry(
  actor: Actor,
  id: string,
  reasonGiven: unknown,
  options: GlossaryStoreOptions = {},
): Promise<GlossaryRecord> {
  refuseUnlessAdministrator(actor);
  const reason = checkReason(reasonGiven);
  if (!reason.ok) throw new GlossaryRefused(400, reason.error);
  const store = documents(options);
  const now = (options.now ?? Date.now)();
  const at = new Date(now).toISOString();
  await ensureSeeded(store, now);

  const after = await store.update<GlossaryRecord>(GLOSSARY_COLLECTION, id, (current) => {
    if (!current) throw new GlossaryRefused(404, 'That entry is not in the glossary.');
    return {
      ...current,
      held: reason.value,
      heldAt: at,
      heldBy: actor.id,
      updatedAt: at,
      updatedBy: actor.id,
    };
  });
  // AUDIT: record the hold here, with its reason, once recordAudit lands.
  changed(options);
  return after;
}

/** Releases a held entry to the trainer again, saying why. */
export async function releaseGlossaryEntry(
  actor: Actor,
  id: string,
  reasonGiven: unknown,
  options: GlossaryStoreOptions = {},
): Promise<GlossaryRecord> {
  refuseUnlessAdministrator(actor);
  const reason = checkReason(reasonGiven);
  if (!reason.ok) throw new GlossaryRefused(400, reason.error);
  const store = documents(options);
  const now = (options.now ?? Date.now)();
  const at = new Date(now).toISOString();
  await ensureSeeded(store, now);

  const after = await store.update<GlossaryRecord>(GLOSSARY_COLLECTION, id, (current) => {
    if (!current) throw new GlossaryRefused(404, 'That entry is not in the glossary.');
    if (!current.held) throw new GlossaryRefused(409, 'That entry is not held.');
    const next: GlossaryRecord = {
      ...current,
      released: { reason: reason.value, at, by: actor.id },
      updatedAt: at,
      updatedBy: actor.id,
    };
    delete next.held;
    delete next.heldAt;
    delete next.heldBy;
    return next;
  });
  // AUDIT: record the release here, with its reason, once recordAudit lands.
  changed(options);
  return after;
}

/** Deletes an entry. There is no undo, beyond adding it again or resetting the glossary. */
export async function deleteGlossaryEntry(
  actor: Actor,
  id: string,
  options: GlossaryStoreOptions = {},
): Promise<void> {
  refuseUnlessAdministrator(actor);
  const store = documents(options);
  await ensureSeeded(store, (options.now ?? Date.now)());
  const existing = await store.get<GlossaryRecord>(GLOSSARY_COLLECTION, id);
  if (!existing) throw new GlossaryRefused(404, 'That entry is not in the glossary.');
  await store.remove(GLOSSARY_COLLECTION, id);
  // AUDIT: record the deletion here, with the entry as it was, once recordAudit lands.
  changed(options);
}

/**
 * Puts the glossary back to the imported file: every entry an administrator added or
 * changed is gone, and every held entry is held as the file holds it.
 */
export async function resetGlossary(
  actor: Actor,
  options: GlossaryStoreOptions = {},
): Promise<number> {
  refuseUnlessAdministrator(actor);
  const store = documents(options);
  const at = new Date((options.now ?? Date.now)()).toISOString();
  const rows = await store.all<GlossaryRecord>(GLOSSARY_COLLECTION);
  const seeded = new Set(GLOSSARY.map((entry) => entry.id));
  // Only the entries the file does not have are removed: the rest are overwritten below,
  // so the collection is never empty while the reset runs.
  await Promise.all(
    rows
      .filter((row) => !seeded.has(row.id))
      .map((row) => store.remove(GLOSSARY_COLLECTION, row.id)),
  );
  await seed(store, actor.id, at, true);
  // AUDIT: record the reset here, with how many entries there were before, once recordAudit
  // lands.
  changed(options);
  return GLOSSARY.length;
}
