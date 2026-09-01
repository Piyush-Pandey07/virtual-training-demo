import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryDocumentStore } from '../roster/documents';
import { OrgStore, OrgStoreError } from './store';
import { domainKeyOf, isUsableOrgId } from './types';

/**
 * Customer companies, and the lookups that decide which one somebody is in.
 *
 * These three collections are the only unscoped ones in the deployment, so a mistake
 * here does not leak one customer's data into another's screen — it puts a person in
 * the wrong company entirely, which is worse and quieter.
 */

const NOW = '2026-09-01T00:00:00.000Z';

function store(): OrgStore {
  return new OrgStore(new InMemoryDocumentStore());
}

describe('creating a customer', () => {
  it('stores it and reads it back', async () => {
    const orgs = store();
    const made = await orgs.create({ id: 'acme', name: 'Acme Ltd' }, NOW);

    assert.equal(made.id, 'acme');
    assert.equal(made.status, 'active');
    assert.equal(made.limits.sessionsPerMonth, null, 'a new customer should start uncapped');
    assert.deepEqual(await orgs.get('acme'), made);
  });

  it('refuses a second customer with the same id', async () => {
    // Overwriting would point an existing customer's domains at a new empty
    // organisation, stranding their people outside their own records without
    // deleting anything — so nothing would look broken.
    const orgs = store();
    await orgs.create({ id: 'acme', name: 'Acme Ltd' }, NOW);

    await assert.rejects(
      () => orgs.create({ id: 'acme', name: 'Acme Holdings' }, NOW),
      OrgStoreError,
    );
    assert.equal((await orgs.get('acme'))?.name, 'Acme Ltd', 'the original was overwritten');
  });

  it('refuses an id that would change what a storage path means', async () => {
    // The id becomes a storage prefix. A slash invents a nesting level and a dot can
    // climb out of one, so these are refused rather than cleaned up — there is no
    // reading of "../etc" that somebody meant.
    const orgs = store();
    for (const id of ['a/b', '../etc', 'a.b', 'a b', 'a_b', '', '-acme', 'acme-']) {
      await assert.rejects(
        () => orgs.create({ id, name: 'Whoever' }, NOW),
        OrgStoreError,
        `"${id}" was accepted as an organisation id`,
      );
    }
  });

  it('normalises case and surrounding space rather than refusing them', async () => {
    // Different from the case above, and deliberately: "Acme" and " acme " have one
    // obvious reading, and this is typed by a person provisioning a customer. What
    // matters is that two spellings cannot become two organisations.
    const orgs = store();
    const made = await orgs.create({ id: '  Acme  ', name: 'Acme Ltd' }, NOW);

    assert.equal(made.id, 'acme');
    await assert.rejects(
      () => orgs.create({ id: 'ACME', name: 'Acme Again' }, NOW),
      OrgStoreError,
      'a differently-cased id created a second organisation',
    );
  });

  it('refuses a customer with no name', async () => {
    await assert.rejects(() => store().create({ id: 'acme', name: '  ' }, NOW), OrgStoreError);
  });

  it('normalises and deduplicates the domains it is given', async () => {
    const orgs = store();
    const made = await orgs.create(
      { id: 'acme', name: 'Acme Ltd', domains: ['@Acme.COM', 'acme.com', ' acme.co.uk '] },
      NOW,
    );

    assert.deepEqual(made.domains, ['acme.co.uk', 'acme.com']);
  });

  it('drops something that is not a domain rather than claiming it', async () => {
    const orgs = store();
    const made = await orgs.create({ id: 'acme', name: 'Acme', domains: ['acme', ''] }, NOW);
    assert.deepEqual(made.domains, []);
  });
});

describe('one domain, one customer', () => {
  it('refuses to create a customer holding a domain somebody else has', async () => {
    const orgs = store();
    await orgs.create({ id: 'acme', name: 'Acme', domains: ['shared.com'] }, NOW);

    await assert.rejects(
      () => orgs.create({ id: 'globex', name: 'Globex', domains: ['shared.com'] }, NOW),
      OrgStoreError,
    );
  });

  it('leaves nothing half-created when a domain clashes', async () => {
    // The clash is checked before anything is written. Without that, Globex would
    // exist with one of its two domains claimed and the request reported as failed —
    // and the next attempt would fail again, on its own leftovers.
    const orgs = store();
    await orgs.create({ id: 'acme', name: 'Acme', domains: ['shared.com'] }, NOW);

    await assert.rejects(
      () =>
        orgs.create({ id: 'globex', name: 'Globex', domains: ['globex.com', 'shared.com'] }, NOW),
      OrgStoreError,
    );

    assert.equal(await orgs.get('globex'), undefined, 'a rejected customer was still created');
    assert.equal(await orgs.orgIdForDomain('globex.com'), undefined, 'a domain was still claimed');
  });

  it('refuses to claim a domain another customer holds', async () => {
    const orgs = store();
    await orgs.create({ id: 'acme', name: 'Acme', domains: ['acme.com'] }, NOW);
    await orgs.create({ id: 'globex', name: 'Globex' }, NOW);

    await assert.rejects(() => orgs.claimDomain('globex', 'acme.com'), OrgStoreError);
    assert.equal(await orgs.orgIdForDomain('acme.com'), 'acme');
  });

  it('lets a customer re-claim its own domain without duplicating it', async () => {
    const orgs = store();
    await orgs.create({ id: 'acme', name: 'Acme', domains: ['acme.com'] }, NOW);

    const after = await orgs.claimDomain('acme', '@ACME.com');
    assert.deepEqual(after.domains, ['acme.com']);
  });

  it('refuses to release a domain belonging to somebody else', async () => {
    // Releasing another customer's domain would hand their people to whoever claimed
    // it next, and their next new joiner would sign in to a stranger's company.
    const orgs = store();
    await orgs.create({ id: 'acme', name: 'Acme', domains: ['acme.com'] }, NOW);
    await orgs.create({ id: 'globex', name: 'Globex' }, NOW);

    await assert.rejects(() => orgs.releaseDomain('globex', 'acme.com'), OrgStoreError);
    assert.equal(await orgs.orgIdForDomain('acme.com'), 'acme');
  });

  it('releases its own domain, from both the claim and the customer', async () => {
    const orgs = store();
    await orgs.create({ id: 'acme', name: 'Acme', domains: ['acme.com', 'acme.co.uk'] }, NOW);

    await orgs.releaseDomain('acme', 'acme.com');
    assert.equal(await orgs.orgIdForDomain('acme.com'), undefined);
    assert.deepEqual((await orgs.get('acme'))?.domains, ['acme.co.uk']);
  });

  it('refuses to claim something that is not a domain', async () => {
    const orgs = store();
    await orgs.create({ id: 'acme', name: 'Acme' }, NOW);
    await assert.rejects(() => orgs.claimDomain('acme', 'acme'), OrgStoreError);
  });

  it('refuses to claim a domain for a customer that does not exist', async () => {
    await assert.rejects(() => store().claimDomain('nobody', 'nobody.com'), OrgStoreError);
  });
});

describe('finding the customer for an address', () => {
  it('resolves by domain, however the address is written', async () => {
    const orgs = store();
    await orgs.create({ id: 'acme', name: 'Acme', domains: ['acme.com'] }, NOW);

    assert.equal(await orgs.orgIdForEmail('aditi@acme.com'), 'acme');
    assert.equal(await orgs.orgIdForEmail('  Aditi@ACME.com  '), 'acme');
  });

  it('returns nothing for a domain no customer has claimed', async () => {
    // The refusal this feeds is the one that stops a stranger enrolling themselves.
    const orgs = store();
    await orgs.create({ id: 'acme', name: 'Acme', domains: ['acme.com'] }, NOW);

    assert.equal(await orgs.orgIdForEmail('someone@gmail.com'), undefined);
    assert.equal(await orgs.orgIdForEmail('someone@acme.com.example'), undefined);
  });

  it('returns nothing for something that is not an address', async () => {
    assert.equal(await store().orgIdForEmail('acme.com'), undefined);
    assert.equal(await store().orgIdForEmail(''), undefined);
  });
});

describe('the directory', () => {
  it('remembers which customer a uid belongs to, and forgets on request', async () => {
    const orgs = store();
    await orgs.remember({ uid: 'uid-1', orgId: 'acme', emailKey: 'aditi@acme.com' });

    assert.equal(await orgs.orgIdForUid('uid-1'), 'acme');

    await orgs.forget('uid-1');
    assert.equal(await orgs.orgIdForUid('uid-1'), undefined);
  });

  it('returns nothing for a uid it has never seen', async () => {
    assert.equal(await store().orgIdForUid('nobody'), undefined);
  });
});

describe('suspending and capping a customer', () => {
  it('suspends without touching anything else', async () => {
    // Training somebody completed is evidence about a person. A lapsed invoice should
    // cost them access, not their records.
    const orgs = store();
    await orgs.create({ id: 'acme', name: 'Acme', domains: ['acme.com'] }, NOW);

    const after = await orgs.setStatus('acme', 'suspended');
    assert.equal(after.status, 'suspended');
    assert.deepEqual(after.domains, ['acme.com']);
    assert.equal(await orgs.orgIdForDomain('acme.com'), 'acme');
  });

  it('sets a monthly session cap and leaves the rest alone', async () => {
    const orgs = store();
    await orgs.create({ id: 'acme', name: 'Acme' }, NOW);

    const after = await orgs.setLimits('acme', { sessionsPerMonth: 500 });
    assert.equal(after.limits.sessionsPerMonth, 500);
    assert.equal(after.name, 'Acme');
  });

  it('refuses to change a customer that does not exist', async () => {
    await assert.rejects(() => store().setStatus('nobody', 'suspended'), OrgStoreError);
    await assert.rejects(() => store().setLimits('nobody', {}), OrgStoreError);
  });
});

describe('listing customers', () => {
  it('sorts by name, so a console is readable as it grows', async () => {
    const orgs = store();
    await orgs.create({ id: 'zeta', name: 'Zeta' }, NOW);
    await orgs.create({ id: 'acme', name: 'Acme' }, NOW);

    assert.deepEqual(
      (await orgs.list()).map((entry) => entry.id),
      ['acme', 'zeta'],
    );
  });
});

describe('the id and domain rules on their own', () => {
  it('accepts what a storage prefix can safely be', () => {
    for (const id of ['acme', 'a', 'acme-ltd', 'acme2', 'a-b-c']) {
      assert.equal(isUsableOrgId(id), true, `${id} should be usable`);
    }
  });

  it('refuses what would change what a path means', () => {
    for (const id of ['', 'A', 'a b', 'a/b', 'a.b', '-a', 'a-', '../x', 'a_b']) {
      assert.equal(isUsableOrgId(id), false, `${id} should not be usable`);
    }
  });

  it('reduces a domain to one spelling', () => {
    assert.equal(domainKeyOf('@Acme.COM'), 'acme.com');
    assert.equal(domainKeyOf('  acme.com '), 'acme.com');
  });
});
