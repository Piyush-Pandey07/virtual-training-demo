/**
 * Moves the roster from blob storage into Firestore.
 *
 * Run once, after Firestore is enabled and before anybody signs in again:
 *
 *   npx tsx --conditions react-server --env-file=.env.local scripts/migrate-roster.ts
 *
 * Copies rather than moves. Nothing is deleted from blob storage, so a migration that
 * goes wrong costs a re-run rather than the records, and the old rows stay readable
 * by setting ROSTER_STORE=blob if anything needs checking afterwards.
 *
 * Safe to run twice. People and assignments are written by id, so a second run
 * overwrites them with the same thing. Attempts are the exception and are handled
 * carefully below.
 */

import { vercelBlobClient } from '../src/lib/decks/store-blob';
import { firestoreDocuments } from '../src/lib/firebase/firestore';
import { HOME_ORG_ID } from '../src/lib/orgs/types';
import { scopedDocuments } from '../src/lib/orgs/scope';
import { BlobRosterStore, LEGACY_ROSTER_ROOT } from '../src/lib/roster/store-blob';
import { DocumentRosterStore } from '../src/lib/roster/store-documents';

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error('BLOB_READ_WRITE_TOKEN is not set, so there is nothing to read from.');
    process.exit(1);
  }

  // Both ends are named explicitly. This script predates customers: it reads the one
  // unscoped roster that existed then and writes into the home organisation, which is
  // where stage 1 put everybody who was already here.
  const from = new BlobRosterStore(vercelBlobClient(token), LEGACY_ROSTER_ROOT);
  const to = new DocumentRosterStore(scopedDocuments(firestoreDocuments(), HOME_ORG_ID));

  const people = await from.listPeople();
  console.log(`${people.length} people`);

  for (const person of people) {
    // Written through the store rather than the document port, so the same validation
    // runs and a row that would be rejected is rejected here rather than later.
    await to.upsertPerson({ id: person.id, email: person.email, name: person.name });
    if (person.role !== 'trainee') await to.setRole(person.id, person.role);
    console.log(`  ${person.email} (${person.role})`);
  }

  let assignments = 0;
  let attempts = 0;

  for (const person of people) {
    for (const row of await from.listAssignmentsForPerson(person.id)) {
      await to.assign({
        personId: row.personId,
        deckId: row.deckId,
        assignedBy: row.assignedBy,
        dueAt: row.dueAt,
      });
      assignments += 1;
    }

    for (const attempt of await from.listAttemptsForPerson(person.id)) {
      // Replayed slide by slide rather than written whole, so the destination builds
      // the record with its own rules — the same de-duplication, the same completion
      // threshold. A second run therefore lands on the same result rather than
      // doubling anything, and an attempt that is already further along in Firestore
      // than in blob storage is not dragged backwards.
      await to.touchAttempt({
        personId: attempt.personId,
        deckId: attempt.deckId,
        slideCount: attempt.slideCount,
        totalSeconds: attempt.totalSeconds,
      });

      for (const slide of attempt.covered) {
        await to.recordCovered({
          personId: attempt.personId,
          deckId: attempt.deckId,
          slideId: slide.slideId,
          targetSeconds: slide.targetSeconds,
          slideCount: attempt.slideCount,
          totalSeconds: attempt.totalSeconds,
        });
      }

      if (attempt.lastSlideId !== null) {
        await to.setLastSlide(attempt.personId, attempt.deckId, attempt.lastSlideId);
      }
      if (attempt.completedAt) await to.markComplete(attempt.personId, attempt.deckId);

      attempts += 1;
    }
  }

  console.log(`${assignments} assignments, ${attempts} attempts`);

  // Read back through the destination, so what is reported is what the app will see.
  const landed = await to.listPeople();
  console.log(`\nFirestore now holds ${landed.length} people.`);
  for (const person of landed) {
    const theirs = await to.listAttemptsForPerson(person.id);
    const covered = theirs.reduce((total, attempt) => total + attempt.covered.length, 0);
    console.log(
      `  ${person.email}: ${(await to.listAssignmentsForPerson(person.id)).length} assigned, ${covered} slides taught`,
    );
  }
}

void main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
