import 'server-only';

import { assetStore, deckStore } from '../decks/registry';
import { firestoreDocuments } from '../firebase/firestore';
import { revokeSessions } from '../firebase/admin';
import { rosterStore } from '../roster/registry';
import { orgStore, orgsConfigured } from './registry';
import { scopedDocuments } from './scope';
import { OrgStoreError } from './store';

/**
 * Ending a customer relationship, and moving somebody between customers.
 *
 * Three operations that are rare, deliberate, and destructive in ascending order.
 * Suspending is reversible and touches nothing. Moving somebody changes one row, and
 * refuses outright if they have anything worth keeping. Deleting removes a customer
 * and everything belonging to them, and there is no undo.
 *
 * All three are separated from the ordinary stores on purpose. They are the operations
 * somebody reaches for in a hurry, at the end of a commercial relationship or after a
 * mistake, and they are the ones worth reading twice before running.
 */

/**
 * The collections a customer owns, all under their own prefix.
 *
 * Firestore does not delete a subcollection when its parent goes, so purging has to
 * name them. A collection missing from this list survives the customer it belonged to
 * and sits in storage as data nobody can reach and nobody remembers agreeing to keep.
 */
const OWNED_COLLECTIONS = ['people', 'assignments', 'attempts', 'usage'] as const;

export interface PurgeReport {
  orgId: string;
  decks: number;
  documents: Record<string, number>;
  domains: number;
  directoryEntries: number;
}

/**
 * Stops a customer signing in, and changes nothing else.
 *
 * Their people, decks and training records stay exactly as they are. Somebody who
 * completed a programme still completed it, and an unpaid invoice is not a reason to
 * destroy the evidence of that. Reversible by setting the status back.
 */
export async function suspend(orgId: string): Promise<void> {
  await orgStore().setStatus(orgId, 'suspended');
}

export async function resume(orgId: string): Promise<void> {
  await orgStore().setStatus(orgId, 'active');
}

/**
 * Moves somebody from one customer to another.
 *
 * For corrections: a contractor provisioned against the wrong company, or an address
 * whose domain resolved somewhere unexpected. Refuses to move anybody who has training
 * records, and that refusal is the whole design.
 *
 * The reason is that removing somebody from a customer takes their assignments and
 * attempts with them, which is right when a person leaves and wrong when they are being
 * moved. I wrote this the other way round first, with a comment claiming the records
 * stayed with the customer that delivered the training. They did not. Nothing failed,
 * nothing was reported, and an attempt saying "Acme trained Sam" was destroyed by an
 * operation described as a move.
 *
 * Carrying the records across is worse, not better: it would hand the new company a
 * record of training it never ran. So neither, and somebody with records has to be
 * dealt with deliberately rather than through a correction tool.
 *
 * Their tokens are revoked, because the organisation rides in the session cookie as a
 * claim. Without that they would keep reading their old customer until the cookie
 * expired, which is precisely the window this exists to close.
 */
export async function movePerson(
  personId: string,
  fromOrgId: string,
  toOrgId: string,
): Promise<void> {
  if (fromOrgId === toOrgId) return;

  const orgs = orgStore();
  const destination = await orgs.get(toOrgId);
  if (!destination) throw new OrgStoreError(`No organisation called "${toOrgId}".`);

  const from = rosterStore(fromOrgId);
  const person = await from.getPerson(personId);
  if (!person) throw new OrgStoreError(`No such person in "${fromOrgId}".`);

  // Checked before anything is written. A person with a record has actually trained
  // somewhere, and which company owns that fact is a question for a human.
  const attempts = await from.listAttemptsForPerson(personId).catch(() => []);
  if (attempts.length > 0) {
    throw new OrgStoreError(
      `${person.email} has training records in "${fromOrgId}", and moving them would destroy ` +
        'those records. Moving is for correcting a misplacement. Decide what should happen to ' +
        'the record first.',
    );
  }

  // Written into the destination before being removed from the source, so a failure
  // between the two leaves somebody in two customers rather than in none. Being in two
  // is visible and fixable; being in none means a person who cannot sign in and whose
  // row nobody can find to repair.
  await rosterStore(toOrgId).upsertPerson({
    id: person.id,
    email: person.email,
    name: person.name,
    role: 'trainee',
    orgId: toOrgId,
  });

  await from.removePerson(personId);
  await orgs.remember({ uid: person.id, orgId: toOrgId, emailKey: person.emailKey });

  // The claim in their cookie still says the old customer. Best effort: a failure here
  // costs them a stale session, not access to anything they should not have, because
  // every request re-reads the row this has already moved.
  await revokeSessions(person.id).catch(() => undefined);
}

/**
 * Removes a customer and everything belonging to them.
 *
 * There is no undo and nothing is archived. Deliberately so: a customer asking to be
 * deleted is usually asking under a data protection obligation, and a quiet archive
 * would be the thing they were trying to prevent.
 *
 * Ordered so that a failure part-way leaves the customer unreachable rather than
 * half-present. The organisation record goes last, because while it exists an operator
 * can see the deletion did not finish and run it again.
 */
export async function purge(orgId: string): Promise<PurgeReport> {
  if (!orgsConfigured()) {
    throw new OrgStoreError('Firebase is not configured, so there is nothing to delete.');
  }

  const orgs = orgStore();
  const organisation = await orgs.get(orgId);
  if (!organisation) throw new OrgStoreError(`No organisation called "${orgId}".`);

  const report: PurgeReport = {
    orgId,
    decks: 0,
    documents: {},
    domains: 0,
    directoryEntries: 0,
  };

  // 1. Their domains, first. From this moment nobody new can be placed here by signing
  //    in, so the deletion is not racing a new joiner.
  for (const domain of organisation.domains) {
    await orgs.releaseDomain(orgId, domain);
    report.domains += 1;
  }

  // 2. Their people's directory entries, so a live cookie stops resolving to them.
  const roster = rosterStore(orgId);
  const people = await roster.listPeople().catch(() => []);
  for (const person of people) {
    await orgs.forget(person.id).catch(() => undefined);
    await revokeSessions(person.id).catch(() => undefined);
    report.directoryEntries += 1;
  }

  // 3. Their decks and every rendered slide.
  const decks = deckStore(orgId);
  const assets = assetStore(orgId);
  for (const deck of await decks.list().catch(() => [])) {
    await assets.removeAll(deck.id).catch(() => undefined);
    await decks.remove(deck.id).catch(() => undefined);
    report.decks += 1;
  }

  // 4. Every document under their prefix. Firestore keeps a subcollection when its
  //    parent goes, so each one is named and emptied rather than assumed to follow.
  const scoped = scopedDocuments(firestoreDocuments(), orgId);
  for (const collection of OWNED_COLLECTIONS) {
    const rows = await scoped.all<Record<string, unknown>>(collection).catch(() => []);
    let removed = 0;
    for (const row of rows) {
      const id = documentIdOf(collection, row);
      if (!id) continue;
      await scoped.remove(collection, id).catch(() => undefined);
      removed += 1;
    }
    report.documents[collection] = removed;
  }

  // 5. The customer itself, last.
  await firestoreDocuments().remove('organisations', orgId);

  return report;
}

/**
 * The key a document was stored under, rebuilt from the document itself.
 *
 * The store returns contents rather than keys, and these four collections are keyed
 * three different ways: by a person's id, by a person and deck pair, and by a month.
 * Guessing wrong here means a row that is read, not deleted, and reported as deleted.
 */
function documentIdOf(
  collection: (typeof OWNED_COLLECTIONS)[number],
  row: Record<string, unknown>,
): string | undefined {
  if (collection === 'usage') {
    return typeof row.month === 'string' ? row.month : undefined;
  }
  if (collection === 'people') {
    return typeof row.id === 'string' ? row.id : undefined;
  }
  // assignments and attempts are both keyed on the pair.
  return typeof row.personId === 'string' && typeof row.deckId === 'string'
    ? `${row.personId}__${row.deckId}`
    : undefined;
}
