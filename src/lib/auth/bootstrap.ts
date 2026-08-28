/**
 * Whether the first administrator still has to be created.
 *
 * Every account comes from an invitation, which leaves a gap at the beginning: the
 * first administrator has nobody to invite them. This says whether that gap is still
 * open, and it closes the moment an administrator exists.
 *
 * In its own module rather than beside the route that uses it, because the sign-in
 * page needs the same answer to decide what to offer, and a Next route file may only
 * export handlers.
 */

import 'server-only';

import { firebaseAdminConfigured } from '../firebase/admin';
import { rosterStore } from '../roster/registry';
import { isBootstrapAdmin } from './session';

export async function bootstrapAvailable(): Promise<boolean> {
  if (!firebaseAdminConfigured()) return false;

  const store = rosterStore();
  if (!store.writable) return false;

  const people = await store.listPeople().catch(() => []);
  return !people.some((person) => person.role === 'admin' || isBootstrapAdmin(person.email));
}
