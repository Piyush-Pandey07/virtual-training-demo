import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';

import { selfEnrolmentAllowed } from './roles';

/**
 * Who may add themselves without waiting for an administrator.
 *
 * The rule is small; what it removes is not. Until this existed, every account was
 * vouched for by somebody who already had one, and a great deal rested on that quietly
 * — including whether a new Firebase account was born with its address already
 * verified. The last two tests here are about that, and they read source rather than
 * behaviour because the failure they guard is silent.
 */

const ORIGINAL = {
  domains: process.env.ALLOWED_EMAIL_DOMAINS,
  admins: process.env.AUTH_ADMIN_EMAILS,
};

function configure(domains: string | undefined, admins = '') {
  if (domains === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
  else process.env.ALLOWED_EMAIL_DOMAINS = domains;
  process.env.AUTH_ADMIN_EMAILS = admins;
}

afterEach(() => {
  if (ORIGINAL.domains === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
  else process.env.ALLOWED_EMAIL_DOMAINS = ORIGINAL.domains;
  if (ORIGINAL.admins === undefined) delete process.env.AUTH_ADMIN_EMAILS;
  else process.env.AUTH_ADMIN_EMAILS = ORIGINAL.admins;
});

describe('selfEnrolmentAllowed', () => {
  it('admits somebody on the configured company domain', () => {
    configure('technavious.com');
    assert.equal(selfEnrolmentAllowed('newjoiner@technavious.com'), true);
    assert.equal(selfEnrolmentAllowed('NewJoiner@Technavious.com'), true);
  });

  it('refuses everybody else', () => {
    configure('technavious.com');
    assert.equal(selfEnrolmentAllowed('someone@gmail.com'), false);
    assert.equal(selfEnrolmentAllowed('someone@technavious.com.example'), false);
    assert.equal(selfEnrolmentAllowed('technavious.com'), false);
  });

  it('refuses everybody when no domain is configured', () => {
    // Silence means closed, and this is the whole safety argument for the feature: a
    // deployment that has not named its domain would otherwise admit any address on
    // the internet. Note this is the opposite of emailAllowed, where an empty list
    // means unrestricted — there the roster is still a gate, and here there is none.
    configure('');
    assert.equal(selfEnrolmentAllowed('anyone@anywhere.example'), false);
    configure(undefined);
    assert.equal(selfEnrolmentAllowed('anyone@anywhere.example'), false);
  });

  it('does not treat an administrator listing as a domain', () => {
    // isBootstrapAdmin covers the named address. This must not widen to its domain.
    configure('technavious.com', 'founder@gmail.com');
    assert.equal(selfEnrolmentAllowed('founder@gmail.com'), false);
    assert.equal(selfEnrolmentAllowed('stranger@gmail.com'), false);
  });
});

describe('a self-enrolled account has to prove its address', () => {
  it('creates a Firebase account unverified unless somebody vouched', () => {
    // createAccount used to set emailVerified: true unconditionally, which was correct
    // only while an administrator had to add every address first. With self-enrolment
    // that same line would let a stranger claim a colleague's address, receive the
    // training assigned to it, and lock the real person out — and the sign-in route
    // would wave it through, because it trusts this flag rather than re-checking.
    const source = readFileSync('src/lib/firebase/admin.ts', 'utf8');
    assert.match(source, /emailVerified: options\.verified/);
    assert.doesNotMatch(source, /emailVerified: true/);
  });

  it('checks the address is verified before it checks who may enrol', () => {
    // Order is the safety property. The verified-address check has to run first, so
    // that reaching the enrolment check means Firebase already saw somebody follow a
    // link sent to that mailbox. Swap them and this becomes open registration for
    // anybody who can spell the domain.
    const source = readFileSync('src/app/api/auth/session/route.ts', 'utf8');
    const verified = source.indexOf('email_verified');
    const enrolment = source.indexOf('selfEnrolmentAllowed(email)');

    assert.ok(verified > 0, 'the verified-address check has gone');
    assert.ok(enrolment > 0, 'the enrolment check has gone');
    assert.ok(
      verified < enrolment,
      'the enrolment check now runs before the address is known to be verified',
    );
  });
});
