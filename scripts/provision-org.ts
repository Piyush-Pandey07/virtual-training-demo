/**
 * Creates a customer company, and optionally its first administrator.
 *
 *   npm run provision-org -- --id acme --name "Acme Ltd" \
 *     --domains acme.com,acme.co.uk \
 *     --admin aditi.sharma@acme.com --admin-name "Aditi Sharma"
 *
 *   npm run provision-org -- --list
 *
 * Onboarding is deliberately a thing a person does at a terminal rather than a signup
 * form. Nobody creates a customer Technavious has not agreed to, and the domains that
 * decide who lands where are set by whoever is provisioning rather than claimed by
 * whoever signs up first.
 *
 * Creating the administrator here does not create a password. They set their own
 * through "First time here?" on the sign-in page, and because an administrator has
 * vouched for the address by adding it, they are not asked to confirm it by email.
 */

import { orgStore, orgsConfigured } from '../src/lib/orgs/registry';
import { OrgStoreError } from '../src/lib/orgs/store';
import { rosterStore } from '../src/lib/roster/registry';
import { emailKeyOf, RosterStoreError } from '../src/lib/roster/store';

interface Options {
  id?: string;
  name?: string;
  domains: string[];
  admin?: string;
  adminName?: string;
  list: boolean;
}

function parse(argv: string[]): Options {
  const options: Options = { domains: [], list: false };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];

    switch (flag) {
      case '--list':
        options.list = true;
        break;
      case '--id':
        options.id = value;
        index += 1;
        break;
      case '--name':
        options.name = value;
        index += 1;
        break;
      case '--domains':
        options.domains = (value ?? '').split(',').filter(Boolean);
        index += 1;
        break;
      case '--admin':
        options.admin = value;
        index += 1;
        break;
      case '--admin-name':
        options.adminName = value;
        index += 1;
        break;
      default:
        if (flag?.startsWith('--')) throw new Error(`Unknown option ${flag}.`);
    }
  }

  return options;
}

async function list(): Promise<void> {
  const organisations = await orgStore().list();
  if (organisations.length === 0) {
    console.log('\n  No customers yet.\n');
    return;
  }

  console.log('');
  for (const organisation of organisations) {
    const domains = organisation.domains.join(', ') || 'no domains';
    const suspended = organisation.status === 'suspended' ? '  [suspended]' : '';
    const cap = organisation.limits.sessionsPerMonth;
    const limit = cap === null ? '' : `  cap ${cap}/month`;
    console.log(`  ${organisation.id.padEnd(20)} ${organisation.name}${suspended}${limit}`);
    console.log(`  ${' '.repeat(20)} ${domains}`);
  }
  console.log('');
}

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2));

  if (!orgsConfigured()) {
    // The registry falls back to an in-memory store so a local build works. Writing a
    // customer into it would report success and forget it on the next boot.
    throw new Error(
      'Firebase is not configured, so there is nowhere to keep customers. Run with --env-file=.env.local.',
    );
  }

  if (options.list) {
    await list();
    return;
  }

  if (!options.id || !options.name) {
    throw new Error('Both --id and --name are required. Use --list to see what exists.');
  }

  const organisation = await orgStore().create(
    { id: options.id, name: options.name, domains: options.domains },
    new Date().toISOString(),
  );

  console.log(`\n  Created ${organisation.name} as "${organisation.id}".`);
  console.log(
    `  Domains: ${organisation.domains.join(', ') || 'none — nobody can enrol themselves yet'}`,
  );

  if (options.admin) {
    // Asked of the directory, not of the new customer's roster. That roster is empty
    // by definition, so a check against it would never fire -- and the case worth
    // catching is precisely somebody who already exists in a *different* customer.
    const held = await orgStore().orgIdHolding(emailKeyOf(options.admin));
    if (held) {
      throw new OrgStoreError(
        `${options.admin} already belongs to "${held}". ` +
          'Somebody belongs to one customer; move them deliberately rather than through provisioning.',
      );
    }

    const roster = rosterStore(organisation.id);

    const person = await roster.upsertPerson({
      email: options.admin,
      name: options.adminName,
      role: 'admin',
      orgId: organisation.id,
    });

    console.log(`  Administrator: ${person.email}`);
    console.log('\n  They set their own password at /signin, using "First time here?".');
  } else {
    console.log('\n  No administrator yet. Re-run with --admin to add one.');
  }

  console.log('');
}

main().catch((error: unknown) => {
  const message =
    error instanceof OrgStoreError || error instanceof RosterStoreError || error instanceof Error
      ? error.message
      : String(error);
  console.error(`\n  ${message}\n`);
  process.exit(1);
});
