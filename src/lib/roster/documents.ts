/**
 * The small part of a document database this app actually needs.
 *
 * Six operations, named for what the roster does rather than for what Firestore
 * offers. Two reasons for the narrowing. It keeps the store logic testable without
 * an emulator — `npm test` runs against the in-memory implementation below and
 * exercises the same code the deployed one runs. And it keeps the surface small
 * enough that moving to something else later is a new file rather than a rewrite.
 *
 * `update` is the one that matters. Everything else could be done with plain reads
 * and writes; this one is read-modify-write done atomically, which is precisely what
 * blob storage cannot do and precisely what progress needs.
 */

import 'server-only';

export interface DocumentStore {
  readonly kind: string;

  get<T>(collection: string, id: string): Promise<T | undefined>;
  set<T>(collection: string, id: string, value: T): Promise<void>;
  remove(collection: string, id: string): Promise<void>;
  all<T>(collection: string): Promise<T[]>;
  /** Every document whose `field` equals `value`. An equality match needs no index. */
  where<T>(collection: string, field: string, value: string): Promise<T[]>;

  /**
   * Reads, changes and writes one document without anybody else getting in between.
   *
   * The change function may run more than once: a real database retries it when two
   * writers collide, which is the whole point. So it must be a pure function of what
   * it is given, and must not do anything it would mind doing twice.
   */
  update<T>(collection: string, id: string, change: (current: T | undefined) => T): Promise<T>;
}

/**
 * In memory, for the tests.
 *
 * Atomic by accident rather than by design: JavaScript runs one thing at a time and
 * `change` is synchronous, so nothing can interleave. That is enough to exercise the
 * store's logic, and it is deliberately not enough to prove the real one is atomic —
 * only the real database can do that.
 */
export class InMemoryDocumentStore implements DocumentStore {
  readonly kind = 'memory';

  private readonly data = new Map<string, Map<string, unknown>>();

  private group(collection: string): Map<string, unknown> {
    let group = this.data.get(collection);
    if (!group) {
      group = new Map();
      this.data.set(collection, group);
    }
    return group;
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    // Copied on the way out, so a caller mutating what it read cannot reach back in
    // and change what is stored. A real database gives a copy for free.
    const found = this.group(collection).get(id);
    return found === undefined ? undefined : (structuredClone(found) as T);
  }

  async set<T>(collection: string, id: string, value: T): Promise<void> {
    this.group(collection).set(id, structuredClone(value));
  }

  async remove(collection: string, id: string): Promise<void> {
    this.group(collection).delete(id);
  }

  async all<T>(collection: string): Promise<T[]> {
    return [...this.group(collection).values()].map((row) => structuredClone(row) as T);
  }

  async where<T>(collection: string, field: string, value: string): Promise<T[]> {
    return (await this.all<Record<string, unknown>>(collection)).filter(
      (row) => row[field] === value,
    ) as T[];
  }

  async update<T>(
    collection: string,
    id: string,
    change: (current: T | undefined) => T,
  ): Promise<T> {
    const next = change(await this.get<T>(collection, id));
    await this.set(collection, id, next);
    return next;
  }
}
