import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { allowedEmailDomains, emailAllowed } from './roles';

/**
 * Who may sign in at all, before anything is known about the person.
 *
 * The exemption tested here is the one that reads like a hole: an address named in
 * AUTH_ADMIN_EMAILS passes whatever its domain. It grants nothing, because that list
 * already makes the same exact address an administrator over everything — but it is
 * worth pinning that it stays per address and never widens to the domain.
 */

const ORIGINAL = {
  domains: process.env.ALLOWED_EMAIL_DOMAINS,
  admins: process.env.AUTH_ADMIN_EMAILS,
};

function configure(domains: string | undefined, admins: string | undefined) {
  if (domains === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
  else process.env.ALLOWED_EMAIL_DOMAINS = domains;
  if (admins === undefined) delete process.env.AUTH_ADMIN_EMAILS;
  else process.env.AUTH_ADMIN_EMAILS = admins;
}

afterEach(() => configure(ORIGINAL.domains, ORIGINAL.admins));

describe('emailAllowed', () => {
  it('takes an address from a listed domain', () => {
    configure('technavious.com', '');
    assert.equal(emailAllowed('aditi@technavious.com'), true);
  });

  it('refuses an address from anywhere else', () => {
    configure('technavious.com', '');
    assert.equal(emailAllowed('someone@gmail.com'), false);
    assert.equal(emailAllowed('someone@nottechnavious.com'), false);
  });

  it('lets an address named as an administrator in from any domain', () => {
    // The bootstrap case: the first administrator of a deployment may not hold an
    // address at the company domain yet, and refusing them leaves nobody able to add
    // anybody. The list already grants that address everything, so this denies nothing.
    configure('technavious.com', 'founder@gmail.com');
    assert.equal(emailAllowed('founder@gmail.com'), true);
  });

  it('does not let the rest of that administrator’s domain in with them', () => {
    // The whole point of naming an exact address rather than widening the domain list.
    // Getting this wrong opens sign-up to everybody holding a public mailbox.
    configure('technavious.com', 'founder@gmail.com');
    assert.equal(emailAllowed('stranger@gmail.com'), false);
  });

  it('matches an administrator address regardless of case or padding', () => {
    configure('technavious.com', '  Founder@Gmail.com , spare@outlook.com ');
    assert.equal(emailAllowed('FOUNDER@gmail.com'), true);
    assert.equal(emailAllowed('spare@outlook.com'), true);
    assert.equal(emailAllowed('someone.else@outlook.com'), false);
  });

  it('allows everything when no domain is configured', () => {
    // Unrestricted is the right default for a deployment that has not said otherwise:
    // the roster is still the gate, and it is a real one.
    configure('', '');
    assert.equal(emailAllowed('anyone@anywhere.example'), true);
    configure(undefined, '');
    assert.equal(emailAllowed('anyone@anywhere.example'), true);
  });

  it('refuses something that is not an address at all', () => {
    configure('technavious.com', '');
    assert.equal(emailAllowed('technavious.com'), false);
    assert.equal(emailAllowed(''), false);
  });

  it('reads several domains, trimmed and lowercased', () => {
    configure(' Technavious.com , partner.example ', '');
    assert.deepEqual([...allowedEmailDomains()].sort(), ['partner.example', 'technavious.com']);
    assert.equal(emailAllowed('a@partner.example'), true);
  });
});
