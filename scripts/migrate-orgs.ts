/**
 * Puts the people who predate organisations into one.
 *
 *   npm run migrate-orgs                 # says what it would do, changes nothing
 *   npm run migrate-orgs -- --apply      # does it
 *
 * Everything in the deployment was written when there was one company and it was
 * Technavious's own. Those rows have no organisation, and a row with none belongs to
 * nobody and is reachable by nobody once the stores are scoped — which is the right
 * way for the gap to fail, and the reason this has to run before that lands.
 *
 * Only people are moved here. Decks move when the deck store learns about
 * organisations, which is the next stage; moving them now would hide them from an app
 * that has not yet been taught where to look.
 *
 * Idempotent: a person who already has an organisation is left alone, so running it
 * twice is not different from running it once.
 */

import { firestoreDocuments } from '../src/lib/firebase/firestore';
import { orgStore, orgsConfigured } from '../src/lib/orgs/registry';
import { scopedDocuments } from '../src/lib/orgs/scope';
import { HOME_ORG_ID } from '../src/lib/orgs/types';
import { rosterStore } from '../src/lib/roster/registry';

const HOME_NAME = 'Technavious';

/**
 * Domains claimed for the home organisation.
 *
 * Read from the environment variable that used to hold the deployment-wide answer, so
 * the migration inherits whatever this deployment already admits rather than inventing
 * a list. The variable stops being read by the app in a later stage; this is the point
 * at which its meaning moves into the database.
 */
function homeDomains(): string[] {
  return (process.env.ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Firestore collections written before customers existed.
 *
 * Stage one put an organisation *on* each row; stage two changed where the store
 * *looks* for rows at all. Those are different things, and doing only the first leaves
 * every person sitting in `people` while the app reads `orgs/{orgId}/people` -- nobody
 * can sign in, and nothing reports an error, because an empty collection is a
 * perfectly ordinary answer.
 */
const COLLECTIONS = ['people', 'assignments', 'attempts'] as const;

/** Copies the unscoped collections into the home organisation. */
async function moveCollections(apply: boolean): Promise<void> {
  const flat = firestoreDocuments();
  const scoped = scopedDocuments(flat, HOME_ORG_ID);

  for (const collection of COLLECTIONS) {
    const rows = await flat.all<Record<string, unknown>>(collection);
    const already = await scoped.all<Record<string, unknown>>(collection);

    console.log(
      `    ${collection.padEnd(12)} ${rows.length} unscoped, ${already.length} already in "${HOME_ORG_ID}"`,
    );
    if (!apply || rows.length === 0) continue;

    for (const row of rows) {
      // Documents here are keyed by their own id, or by a person and deck pair in the
      // same shape `pairId` builds. Both are on the row, so the key can be rebuilt
      // rather than needing the store to hand it back.
      const id =
        typeof row.id === 'string'
          ? row.id
          : typeof row.personId === 'string' && typeof row.deckId === 'string'
            ? `${row.personId}__${row.deckId}`
            : undefined;

      if (!id) {
        console.log(`      a ${collection} row has no id this can rebuild -- left alone`);
        continue;
      }

      // Copied, not moved. The originals stay until somebody has seen this work, and a
      // second run overwrites with the same content rather than duplicating.
      await scoped.set(collection, id, { ...row, orgId: HOME_ORG_ID });
      console.log(`      ${collection}/${id}`);
    }
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  if (!orgsConfigured()) {
    throw new Error(
      'Firebase is not configured, so there is nothing to migrate. Run with --env-file=.env.local.',
    );
  }

  const orgs = orgStore();

  // The rows move first. Everything below reads through a store scoped to the home
  // organisation, which sees nothing at all until they have.
  console.log('');
  console.log('  Firestore collections:');
  await moveCollections(apply);

  const roster = rosterStore(HOME_ORG_ID);

  const people = await roster.listPeople();
  const homeless = people.filter((person) => !person.orgId);
  const domains = homeDomains();

  console.log(`\n  ${apply ? 'Migrating' : 'Would migrate'} into "${HOME_ORG_ID}" (${HOME_NAME})`);
  console.log(`  Domains to claim: ${domains.join(', ') || 'none'}`);
  console.log(`  People without an organisation: ${homeless.length} of ${people.length}`);

  for (const person of homeless) {
    console.log(`    ${person.email.padEnd(34)} ${person.role}`);
  }

  const alreadyPlaced = people.filter((person) => person.orgId);
  for (const person of alreadyPlaced) {
    console.log(`    ${person.email.padEnd(34)} already in "${person.orgId}" — left alone`);
  }

  if (!apply) {
    console.log('\n  Nothing was changed. Re-run with --apply to do it.\n');
    return;
  }

  const existing = await orgs.get(HOME_ORG_ID);
  if (existing) {
    console.log(`\n  "${HOME_ORG_ID}" already exists; claiming any domains it is missing.`);
    for (const domain of domains) await orgs.claimDomain(HOME_ORG_ID, domain);
  } else {
    await orgs.create({ id: HOME_ORG_ID, name: HOME_NAME, domains }, new Date().toISOString());
    console.log(`\n  Created "${HOME_ORG_ID}".`);
  }

  for (const person of homeless) {
    // setOrgId, not upsertPerson: that one runs on every sign-in and deliberately
    // ignores an organisation, so signing in cannot move somebody between customers.
    // Placing a row is the deliberate act it refuses to be, and this is its path.
    await roster.setOrgId(person.id, HOME_ORG_ID);

    await orgs.remember({ uid: person.id, orgId: HOME_ORG_ID, emailKey: person.emailKey });
    console.log(`    placed ${person.email}`);
  }

  // Read back rather than trusting the writes, because the point of this script is
  // that nothing is left without an organisation.
  const after = await roster.listPeople();
  const stillHomeless = after.filter((person) => !person.orgId);

  console.log(`\n  Done. ${after.length - stillHomeless.length} of ${after.length} placed.`);
  if (stillHomeless.length > 0) {
    console.log('  Still without an organisation, and unreachable once stores are scoped:');
    for (const person of stillHomeless) console.log(`    ${person.email}`);
    process.exitCode = 1;
  }
  console.log('');
}

main().catch((error: unknown) => {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
