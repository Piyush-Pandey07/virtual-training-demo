import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { roleLabel, otherRoleLabel } from '@/lib/auth/labels';

/**
 * That every page can be reached from every other one it should be.
 *
 * Each page used to write its own header links, and the result was a set of screens
 * wired to a few of their neighbours and not the rest. `/people` linked home and
 * nothing else. `/platform` was reachable from exactly one place -- the banner shown
 * while already inside a customer -- so a platform administrator who was not acting
 * elsewhere had no link to it at all and had to know the URL.
 *
 * Nothing failed. Every page worked when opened directly, which is why it went
 * unnoticed, and why the check is worth having: a missing link is invisible from
 * inside the page that should have carried it.
 */

/** Every page with a header, and what its nav should mark as the current page. */
const PAGES: { path: string; current?: string }[] = [
  { path: 'src/app/HomeForAdmin.tsx', current: '"/"' },
  { path: 'src/app/HomeForTrainee.tsx', current: '"/"' },
  { path: 'src/app/decks/page.tsx', current: '"/decks"' },
  { path: 'src/app/decks/new/page.tsx' },
  { path: 'src/app/decks/[id]/page.tsx' },
  { path: 'src/app/decks/[id]/progress/page.tsx' },
  { path: 'src/app/people/page.tsx', current: '"/people"' },
  { path: 'src/app/people/[id]/page.tsx' },
  { path: 'src/app/platform/page.tsx', current: '"/platform"' },
];

describe('the header on every page', () => {
  for (const page of PAGES) {
    it(`${page.path} uses the shared nav`, () => {
      const source = readFileSync(page.path, 'utf8');

      assert.match(
        source,
        /<MainNav person=/,
        'this page writes its own header links, so they can drift from every other page',
      );

      if (page.current) {
        assert.ok(
          source.includes(`current=${page.current}`),
          `the nav should know it is already on ${page.current}, so it is not offered as a link`,
        );
      }
    });
  }

  it('offers the customer list from somewhere a platform admin will actually be', () => {
    // The bug: the only link to /platform lived in the banner that appears while you
    // are already inside a customer, which is not where you are when you want to pick
    // one. It now comes from the nav, which is on every page.
    const nav = readFileSync('src/components/MainNav.tsx', 'utf8');
    assert.match(nav, /person\.platform.*'\/platform'/s);
  });

  it('does not offer an employee a page that would refuse them', () => {
    // A trainee has no roster and no deck library. Offering the link would be offering
    // a redirect, and the guard would send them straight back.
    const nav = readFileSync('src/components/MainNav.tsx', 'utf8');
    const gated = nav.slice(nav.indexOf('const admin ='), nav.indexOf('return ('));
    for (const restricted of ['/people', '/decks']) {
      assert.ok(
        gated.includes(restricted),
        `${restricted} is no longer behind the administrator check in the nav`,
      );
    }
  });
});

describe('what the three kinds of person are called', () => {
  it('matches the three the sign-in page asks them to choose between', () => {
    // The sign-in page offers Admin, Company and Employee. Every other screen has to
    // use those words, and once did not: the same person was "HR" on their profile,
    // "administrator" in the list, and "Company" at sign-in.
    const signIn = readFileSync('src/app/signin/PasswordSignIn.tsx', 'utf8');
    for (const label of ['Admin', 'Company', 'Employee']) {
      assert.ok(signIn.includes(`'${label}'`), `the sign-in page no longer offers ${label}`);
    }

    assert.equal(roleLabel('admin', true), 'Admin');
    assert.equal(roleLabel('admin', false), 'Company');
    assert.equal(roleLabel('trainee', false), 'Employee');
    // Platform staff are administrators inside every customer, so a trainee row can
    // never be one; the label still must not claim otherwise if asked.
    assert.equal(roleLabel('trainee', true), 'Admin');
  });

  it('names the role a switch would produce, not the one they have', () => {
    assert.equal(otherRoleLabel('trainee'), 'Company');
    assert.equal(otherRoleLabel('admin'), 'Employee');
  });

  it('has no screen still calling somebody HR or a trainee', () => {
    // The stored role stays `trainee` -- that is the guard's business. What a person is
    // shown is not, and these are the words that leaked into the interface.
    for (const path of [
      'src/app/people/PeopleList.tsx',
      'src/app/people/[id]/page.tsx',
      'src/app/signin/SignInForm.tsx',
    ]) {
      const source = readFileSync(path, 'utf8');
      const rendered = source
        .split('\n')
        .filter((line) => /^\s*\{?['"]?(HR|Trainee)\b/.test(line.trim()) || /'HR'/.test(line));
      assert.deepEqual(rendered, [], `${path} still shows a role name of its own`);
    }
  });
});
