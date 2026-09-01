import 'server-only';

import type { DocumentStore } from '../roster/documents';
import { isUsableOrgId } from './types';

/**
 * Where one customer's data lives, and nothing else's.
 *
 * The whole isolation rests on one decision: a store is scoped when it is *built*, not
 * when it is queried. `rosterStore(orgId)` hands back something that can only see one
 * customer, so a query cannot forget to filter — there is no unfiltered query to write.
 *
 * The alternative was an `orgId` field and a `where` clause at each of the fifty-odd
 * call sites. That is one forgotten clause away from showing a customer somebody else's
 * employees, and nothing fails when somebody forgets. This way the mistake is not
 * available: a caller with no organisation cannot construct a store at all.
 *
 * Everything here takes an organisation id and refuses a bad one. That refusal is not
 * politeness — the id becomes a storage path, and `..` would climb out of the customer
 * it is supposed to confine.
 */

export function assertUsableOrgId(orgId: string): void {
  if (!isUsableOrgId(orgId)) {
    throw new Error(`"${orgId}" is not a usable organisation id.`);
  }
}

/** The prefix every one of a customer's objects sits under: `orgs/acme`. */
export function orgPrefix(orgId: string): string {
  assertUsableOrgId(orgId);
  return `orgs/${orgId}`;
}

/**
 * A document store that can only see one customer's collections.
 *
 * Prefixes the collection name rather than adding a field, so `people` becomes
 * `orgs/acme/people`. In Firestore that is a subcollection and needs no index and no
 * parent document; in the in-memory store it is a different key. Either way the store
 * underneath is untouched, and `DocumentRosterStore` still asks for `people` without
 * knowing there is such a thing as a customer.
 *
 * Chosen over `where('orgId', ...)` deliberately. A field can be forgotten in a query
 * and the query still succeeds, returning everybody. A collection that does not exist
 * returns nothing.
 */
export function scopedDocuments(docs: DocumentStore, orgId: string): DocumentStore {
  const prefix = orgPrefix(orgId);
  const within = (collection: string): string => `${prefix}/${collection}`;

  return {
    kind: `${docs.kind}:${orgId}`,

    get: (collection, id) => docs.get(within(collection), id),
    set: (collection, id, value) => docs.set(within(collection), id, value),
    remove: (collection, id) => docs.remove(within(collection), id),
    all: (collection) => docs.all(within(collection)),
    where: (collection, field, value) => docs.where(within(collection), field, value),
    update: (collection, id, change) => docs.update(within(collection), id, change),
  };
}

/** Where one customer's decks live in blob storage: `orgs/acme/decks`. */
export function deckPrefix(orgId: string): string {
  return `${orgPrefix(orgId)}/decks`;
}

/** Where one customer's roster lives in blob storage: `orgs/acme/roster`. */
export function rosterPrefix(orgId: string): string {
  return `${orgPrefix(orgId)}/roster`;
}

/**
 * Where one customer's files live on disk.
 *
 * `.data/orgs/acme/decks`, rather than `.data/decks`. The filesystem stores already
 * take a root and build every path under it, so scoping them needs no change inside
 * them at all — only a different root.
 */
export function filesystemRoot(base: string, orgId: string, kind: 'decks' | 'roster'): string {
  assertUsableOrgId(orgId);
  return `${base}/orgs/${orgId}/${kind}`;
}
