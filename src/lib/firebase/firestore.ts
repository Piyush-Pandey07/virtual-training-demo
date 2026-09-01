/**
 * The document port, over Firestore.
 *
 * Thin on purpose. Everything the roster actually decides lives in
 * `store-documents.ts` and is tested against an in-memory implementation of the same
 * port, so what is left here is six calls to a client library — the same split the
 * blob store uses, and for the same reason: what can be got wrong should be testable
 * without the service being present.
 *
 * Firestore is reached with the service account the app already has, so it needs no
 * new credentials. It does need the API enabled on the project once, and the security
 * rules should deny every direct client read and write: nothing in the browser ever
 * touches this, so anything that can reach it is not the app.
 */

import 'server-only';

import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import type { DocumentStore } from '../roster/documents';
import { adminApp } from './admin';

/**
 * Where a Firestore document belongs, given a collection and an id.
 *
 * Firestore refuses an id containing a slash, and treats `.` and `..` specially. The
 * ids reaching here are already constrained — a person id is letters, digits, hyphen
 * and underscore, and a deck id is lower-case letters, digits and hyphen — but the
 * check is here as well because this is the layer that would silently write to the
 * wrong path rather than fail.
 */
function assertUsableDocId(id: string): void {
  if (id.length === 0 || id.length > 1400 || id.includes('/') || id === '.' || id === '..') {
    throw new Error(`"${id}" is not a usable document id.`);
  }
}

/**
 * The one Firestore handle, cached for the module rather than per call.
 *
 * `getFirestore(adminApp())` returns the same underlying instance every time, and
 * `settings()` may be called on it exactly once and only before it is used. Caching
 * inside `firestoreDocuments()` looked equivalent and was not: the second caller got
 * its own empty cache, called `settings()` on an instance the first caller had already
 * used, and threw "Firestore has already been initialized".
 *
 * That stayed hidden while the roster was the only consumer. It surfaced the moment
 * organisations became a second one, which is the shape of most latent singleton bugs.
 */
let handle: Firestore | null = null;

function db(): Firestore {
  if (!handle) {
    handle = getFirestore(adminApp());
    // Undefined is what an optional field looks like in this codebase, and Firestore
    // rejects it by default rather than treating it as absent. Ignoring it keeps the
    // shapes here the same as everywhere else in the app.
    handle.settings({ ignoreUndefinedProperties: true });
  }
  return handle;
}

export function firestoreDocuments(): DocumentStore {
  return {
    kind: 'firestore',

    async get<T>(collection: string, id: string): Promise<T | undefined> {
      assertUsableDocId(id);
      const snap = await db().collection(collection).doc(id).get();
      return snap.exists ? (snap.data() as T) : undefined;
    },

    async set<T>(collection: string, id: string, value: T): Promise<void> {
      assertUsableDocId(id);
      await db()
        .collection(collection)
        .doc(id)
        .set(value as Record<string, unknown>);
    },

    async remove(collection: string, id: string): Promise<void> {
      assertUsableDocId(id);
      await db().collection(collection).doc(id).delete();
    },

    async all<T>(collection: string): Promise<T[]> {
      const snap = await db().collection(collection).get();
      return snap.docs.map((doc) => doc.data() as T);
    },

    async where<T>(collection: string, field: string, value: string): Promise<T[]> {
      // A single-field equality match is served by the automatic index, so this needs
      // no index configuration and cannot fail on a missing one.
      const snap = await db().collection(collection).where(field, '==', value).get();
      return snap.docs.map((doc) => doc.data() as T);
    },

    /**
     * Read, change and write, atomically.
     *
     * This is the reason for moving off blob storage. Firestore runs the change inside
     * a transaction and retries it when another writer got there first, so two people
     * finishing slides at the same moment both land instead of one overwriting the
     * other. The change function may therefore run more than once, which is why
     * `store-documents.ts` keeps it a pure function of what it is handed.
     */
    async update<T>(
      collection: string,
      id: string,
      change: (current: T | undefined) => T,
    ): Promise<T> {
      assertUsableDocId(id);
      const ref = db().collection(collection).doc(id);

      return db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const next = change(snap.exists ? (snap.data() as T) : undefined);
        tx.set(ref, next as Record<string, unknown>);
        return next;
      });
    },
  };
}
