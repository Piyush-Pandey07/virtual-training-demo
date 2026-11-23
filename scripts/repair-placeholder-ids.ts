/**
 * Repairs the trainer-led sessions and batches that D-18 and D-20 left behind.
 *
 *   npx tsx --conditions react-server --env-file=.env.local scripts/repair-placeholder-ids.ts
 *       says what it would change, in every organisation, and changes nothing
 *   ... scripts/repair-placeholder-ids.ts --apply
 *       changes it
 *   ... scripts/repair-placeholder-ids.ts --org=acme [--apply]
 *       one organisation only
 *
 * `npm run repair-placeholder-ids -- --apply` is the same thing.
 *
 * D-18: somebody listed in a session or batch before their first sign-in was listed
 * under a placeholder id, and signing in moved them on the roster to their real id
 * without moving the sessions and batches, so they dropped out of them. Signing in now
 * carries them across; this finds every session and batch still naming a placeholder
 * whose person has signed in since, and rewrites it to their real id.
 *
 * D-20: a session now keeps the name and address of everybody on it, so it goes on
 * naming them after they leave the roster. This gives the sessions set up before that
 * the names the roster, or a leaver record, still has.
 *
 * What it does and why is in src/lib/training/repair.ts. Idempotent: a second run finds
 * nothing to do. Nothing is deleted, and nobody is added to anything.
 */

import { orgStore, orgsConfigured } from '../src/lib/orgs/registry';
import { HOME_ORG_ID } from '../src/lib/orgs/types';
import { repairOrg, type OrgRepair } from '../src/lib/training/repair';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const only = process.argv.find((arg) => arg.startsWith('--org='))?.slice('--org='.length);

  if (!orgsConfigured()) {
    throw new Error(
      'Firebase is not configured, so there is nothing to repair. Run with --env-file=.env.local.',
    );
  }

  // Every customer, and Technavious's own whether or not it was ever provisioned as one,
  // as the retention job walks them.
  const orgIds = only
    ? [only]
    : [...new Set([...(await orgStore().list()).map((org) => org.id), HOME_ORG_ID])].sort();

  console.log(`\n  ${apply ? 'Repairing' : 'Would repair'} ${orgIds.length} organisation(s).`);
  let changed = 0;
  let failed = 0;
  for (const orgId of orgIds) {
    let report: OrgRepair;
    try {
      report = await repairOrg(orgId, { apply });
    } catch (error) {
      // One organisation that cannot be read is reported, and the rest still repaired.
      failed += 1;
      console.log(`\n  ${orgId}: could not be read: ${(error as Error)?.message ?? error}`);
      continue;
    }

    console.log(`\n  ${orgId}${report.lines.length === 0 ? ': nothing to do' : ''}`);
    for (const line of report.lines) {
      changed += 1;
      const outcome = !apply ? '' : line.failed ? ` FAILED: ${line.failed}` : ' done';
      console.log(`    ${line.kind} ${line.id} (${line.label})${outcome}`);
      for (const change of line.changes) console.log(`      ${change}`);
      if (line.failed) failed += 1;
    }
    for (const { placeholder, reason } of report.leftAlone) {
      console.log(`    left alone: ${placeholder}, because ${reason}. Check it by hand.`);
    }
  }

  console.log(
    `\n  ${changed} session(s) and batch(es) ${apply ? 'repaired' : 'to repair'}${failed ? `, ${failed} failed` : ''}.`,
  );
  if (!apply && changed > 0) console.log('  Nothing was changed. Re-run with --apply to do it.');
  console.log('');
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
