/**
 * Where batches and trainer-led sessions are kept: one customer's, in their own
 * Firestore prefix, through the same document store everything else uses.
 *
 * Falls back to memory when Firebase is not configured, so local builds and tests work.
 */

import 'server-only';

import { firestoreDocuments } from '../firebase/firestore';
import { orgsConfigured } from '../orgs/registry';
import { scopedDocuments } from '../orgs/scope';
import { InMemoryDocumentStore, type DocumentStore } from '../roster/documents';
import type { Batch, TrainingSession } from './types';

export const BATCHES = 'batches';
export const TRAINING_SESSIONS = 'trainingSessions';

const fallback = new InMemoryDocumentStore();

export function trainingDocuments(orgId: string, store?: DocumentStore): DocumentStore {
  return scopedDocuments(store ?? (orgsConfigured() ? firestoreDocuments() : fallback), orgId);
}

/** A random id that cannot collide with a path separator. */
export function newTrainingId(prefix: 'b' | 's'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `${prefix}-${Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 14)}`;
}

export class TrainingStore {
  constructor(private readonly docs: DocumentStore) {}

  listBatches(): Promise<Batch[]> {
    return this.docs.all<Batch>(BATCHES);
  }
  getBatch(id: string): Promise<Batch | undefined> {
    return this.docs.get<Batch>(BATCHES, id);
  }
  saveBatch(batch: Batch): Promise<void> {
    return this.docs.set(BATCHES, batch.id, batch);
  }
  removeBatch(id: string): Promise<void> {
    return this.docs.remove(BATCHES, id);
  }

  listSessions(): Promise<TrainingSession[]> {
    return this.docs.all<TrainingSession>(TRAINING_SESSIONS);
  }
  getSession(id: string): Promise<TrainingSession | undefined> {
    return this.docs.get<TrainingSession>(TRAINING_SESSIONS, id);
  }
  saveSession(session: TrainingSession): Promise<void> {
    return this.docs.set(TRAINING_SESSIONS, session.id, session);
  }
  /** Read, change and write one session without another writer getting in between. */
  updateSession(
    id: string,
    change: (current: TrainingSession | undefined) => TrainingSession,
  ): Promise<TrainingSession> {
    return this.docs.update<TrainingSession>(TRAINING_SESSIONS, id, change);
  }
  removeSession(id: string): Promise<void> {
    return this.docs.remove(TRAINING_SESSIONS, id);
  }
  /** The sessions a facilitator runs. */
  async sessionsFacilitatedBy(personId: string): Promise<TrainingSession[]> {
    return this.docs.where<TrainingSession>(TRAINING_SESSIONS, 'facilitatorId', personId);
  }
}

export function trainingStore(orgId: string, store?: DocumentStore): TrainingStore {
  return new TrainingStore(trainingDocuments(orgId, store));
}
