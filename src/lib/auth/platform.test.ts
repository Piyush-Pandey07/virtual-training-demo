import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { isActingElsewhere } from './acting-org';
import { effectiveRole, isPlatformAdmin, platformAdminEmails } from './roles';
import type { Person } from '../roster/types';

/**
 * Technavious, and everybody else.
 *
 * A customer administrator runs training inside one company. Platform staff may look
 * inside any of them. Those are different powers and the app keeps them in different
 * places — a role on a row, and an environment variable — so that no amount of writing
 * rows can produce the second one.
 */

const ORIGINAL = process.env.PLATFORM_ADMIN_EMAILS;
const ORIGINAL_LEGACY = process.env.AUTH_ADMIN_EMAILS;

function configure(platform?: string, legacy?: string) {
  if (platform === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = platform;
  if (legacy === undefined) delete process.env.AUTH_ADMIN_EMAILS;
  else process.env.AUTH_ADMIN_EMAILS = legacy;
}

afterEach(() => configure(ORIGINAL, ORIGINAL_LEGACY));

function person(over: Partial<Person> = {}): Person {
  return {
    id: 'uid',
    email: 'aditi@acme.com',
    emailKey: 'aditi@acme.com',
    name: 'Aditi',
    role: 'trainee',
    createdAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: null,
    orgId: 'acme',
    ...over,
  };
}

describe('who counts as Technavious', () => {
  it('takes exactly the addresses named, however they are spelled', () => {
    configure('  Work.Of.God02@Gmail.com , second@technavious.com ');

    assert.equal(isPlatformAdmin('work.of.god02@gmail.com'), true);
    assert.equal(isPlatformAdmin('WORK.OF.GOD02@gmail.com'), true);
    assert.equal(isPlatformAdmin('second@technavious.com'), true);
  });

  it('takes nobody else, including the rest of a named address’s domain', () => {
    // The list is addresses, never domains. If it widened to a domain, every colleague
    // of a platform administrator would be able to read every customer.
    configure('work.of.god02@gmail.com');

    assert.equal(isPlatformAdmin('someone.else@gmail.com'), false);
    assert.equal(isPlatformAdmin('aditi@acme.com'), false);
    assert.equal(isPlatformAdmin(''), false);
  });

  it('takes nobody at all when nothing is configured', () => {
    // A deployment with no platform list has no cross-customer access, which is the
    // right default: the power should have to be granted, never assumed.
    configure(undefined, undefined);
    assert.equal(platformAdminEmails().size, 0);
    assert.equal(isPlatformAdmin('anyone@anywhere.example'), false);
  });

  it('still reads the old variable name, so a deploy cannot lose its staff', () => {
    // AUTH_ADMIN_EMAILS meant this when there was one company. Reading both means a
    // config change and a deploy can happen in either order.
    configure(undefined, 'legacy@technavious.com');
    assert.equal(isPlatformAdmin('legacy@technavious.com'), true);
  });

  it('prefers the new name when both are set', () => {
    configure('new@technavious.com', 'legacy@technavious.com');
    assert.equal(isPlatformAdmin('new@technavious.com'), true);
    assert.equal(isPlatformAdmin('legacy@technavious.com'), false);
  });
});

describe('the role that applies', () => {
  it('makes platform staff an administrator whatever the row says', () => {
    configure('work.of.god02@gmail.com');
    assert.equal(
      effectiveRole(person({ email: 'work.of.god02@gmail.com', role: 'trainee' })),
      'admin',
    );
  });

  it('leaves everybody else with the role they were given', () => {
    configure('work.of.god02@gmail.com');
    assert.equal(effectiveRole(person({ role: 'trainee' })), 'trainee');
    assert.equal(effectiveRole(person({ role: 'admin' })), 'admin');
  });

  it('does not decide which customer somebody may look at', () => {
    // Being an administrator and being inside a customer are different facts. A
    // customer's own administrator is an administrator of exactly one company, and
    // `effectiveRole` saying "admin" must never be read as "admin of anywhere".
    configure('');
    const admin = person({ role: 'admin', orgId: 'acme' });
    assert.equal(effectiveRole(admin), 'admin');
    assert.equal(
      isActingElsewhere({ email: admin.email, orgId: 'globex', homeOrgId: 'acme' }),
      false,
      'a customer administrator was treated as though they could act elsewhere',
    );
  });
});

describe('looking inside somebody else’s customer', () => {
  it('is true only for platform staff who have moved', () => {
    configure('work.of.god02@gmail.com');

    assert.equal(
      isActingElsewhere({
        email: 'work.of.god02@gmail.com',
        orgId: 'acme',
        homeOrgId: 'technavious',
      }),
      true,
    );
    assert.equal(
      isActingElsewhere({
        email: 'work.of.god02@gmail.com',
        orgId: 'technavious',
        homeOrgId: 'technavious',
      }),
      false,
    );
  });

  it('is never true for a customer administrator, whatever their organisation says', () => {
    configure('work.of.god02@gmail.com');
    assert.equal(
      isActingElsewhere({ email: 'hr@acme.com', orgId: 'globex', homeOrgId: 'acme' }),
      false,
    );
  });
});

describe('the acting-organisation cookie', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
    }
    return out;
  }

  const FILES = walk('src').map((path) => path.split('\\').join('/'));

  it('is read in one place, which checks who is asking before believing it', () => {
    // The cookie says which customer to look at. It is not the authority and must not
    // become one: anything that reads it without first asking whether this person is
    // Technavious has turned a cookie a customer can set into cross-customer access.
    //
    // So it is read in exactly one function, and this is what keeps that true.
    const readers = FILES.filter(
      (path) =>
        path !== 'src/lib/auth/acting-org.ts' &&
        /ACTING_ORG_COOKIE|acting_org/.test(readFileSync(path, 'utf8')) &&
        !path.endsWith('src/app/api/platform/route.ts'),
    );

    assert.deepEqual(readers, [], `the acting-organisation cookie is read in: ${readers.join(', ')}`);
  });

  it('checks the platform list before it reads the cookie at all', () => {
    // Order matters. Reading the cookie and then checking would still be correct, but
    // it invites a later edit that returns early on a match. This way the only path to
    // the cookie runs through the check.
    const source = readFileSync('src/lib/auth/acting-org.ts', 'utf8');
    const check = source.indexOf('isPlatformAdmin(email)');
    // The read, not the declaration. Looking for the constant found where it is
    // defined at the top of the file, which is before everything and so proved
    // nothing — the assertion would have held with the check removed entirely.
    const read = source.indexOf('jar.get(ACTING_ORG_COOKIE)');

    assert.ok(check > 0, 'acting-org.ts no longer checks the platform list');
    assert.ok(read > 0, 'acting-org.ts no longer reads the cookie the way this expects');
    assert.ok(check < read, 'the cookie is read before anybody asks who is reading it');
  });

  it('found enough files to have actually looked', () => {
    assert.ok(FILES.length >= 60, `only walked ${FILES.length} files`);
  });
});
