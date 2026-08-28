/**
 * What a deployment with no roster storage has.
 *
 * Reads answer emptily and writes refuse with a message naming the variable that is
 * missing. The same shape the deck store's seeded tier takes, and for the same
 * reason: on Vercel the filesystem is read-only apart from a temporary directory
 * that does not outlive a request, so a filesystem roster there would appear to work
 * and then lose every record. Refusing is the honest behaviour.
 */

import 'server-only';

import { RosterStoreError, type RosterStore } from './store';
import type { Assignment, Attempt, Person } from './types';

const WHY =
  'This deployment has no roster storage configured, so people, assignments and progress cannot be saved. Set DATABASE_URL to enable them.';

function refuse(): never {
  throw new RosterStoreError(WHY);
}

export class NoRosterStore implements RosterStore {
  readonly kind = 'none' as const;
  readonly writable = false;

  async listPeople(): Promise<Person[]> {
    return [];
  }
  async getPerson(): Promise<Person | undefined> {
    return undefined;
  }
  async getPersonByEmail(): Promise<Person | undefined> {
    return undefined;
  }
  async upsertPerson(): Promise<Person> {
    refuse();
  }
  async setRole(): Promise<Person> {
    refuse();
  }
  async removePerson(): Promise<void> {
    refuse();
  }

  async listAssignmentsForPerson(): Promise<Assignment[]> {
    return [];
  }
  async listAssignmentsForDeck(): Promise<Assignment[]> {
    return [];
  }
  async isAssigned(): Promise<boolean> {
    return false;
  }
  async assign(): Promise<Assignment> {
    refuse();
  }
  async unassign(): Promise<void> {
    refuse();
  }

  async getAttempt(): Promise<Attempt | undefined> {
    return undefined;
  }
  async listAttemptsForPerson(): Promise<Attempt[]> {
    return [];
  }
  async listAttemptsForDeck(): Promise<Attempt[]> {
    return [];
  }
  async recordCovered(): Promise<Attempt> {
    refuse();
  }
  async touchAttempt(): Promise<Attempt> {
    refuse();
  }
  async setLastSlide(): Promise<void> {
    refuse();
  }
  async markComplete(): Promise<void> {
    refuse();
  }
}
