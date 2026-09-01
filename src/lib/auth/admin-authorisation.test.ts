import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { InMemoryDocumentStore } from '../roster/documents';
import { DocumentRosterStore } from '../roster/store-documents';

/**
 * Administrator access is granted by a person, never taken.
 *
 * Anybody on a customer's claimed domain can enrol themselves, which is the point —
 * but they arrive as a trainee and there is no path from there to administrator that
 * does not go through somebody who already is one. Two ways in, both deliberate:
 *
 *   - PLATFORM_ADMIN_EMAILS, which is Technavious and only whoever deploys can change
 *   - "Make HR" on the people screen, which only that customer's administrator reaches
 *
 * Those two are different powers, kept in different places on purpose: one is a role on
 * a row and confined to one customer, the other is an environment variable and is not.
 *
 * That guarantee is not written down in any one place. It is three pieces of code
 * agreeing: the store defaults a new row to trainee, the sign-in route declines to
 * pass a role, and the update branch declines to take one. Any of the three could be
 * loosened by somebody with a good local reason, so it is pinned here.
 */

function store(): DocumentRosterStore {
  return new DocumentRosterStore(new InMemoryDocumentStore());
}

describe('somebody who enrols themselves', () => {
  it('is a trainee', async () => {
    const roster = store();
    const person = await roster.upsertPerson({
      id: 'firebase-uid-1',
      email: 'new.joiner@technavious.com',
      name: 'New Joiner',
    });

    assert.equal(person.role, 'trainee');
  });

  it('is still a trainee after signing in again', async () => {
    // Every sign-in upserts, so a role that reset on each visit would be a slow leak in
    // either direction. This is the direction that matters.
    const roster = store();
    await roster.upsertPerson({ id: 'uid', email: 'a@technavious.com' });
    await roster.setRole('uid', 'admin');

    const again = await roster.upsertPerson({ id: 'uid', email: 'a@technavious.com' });
    assert.equal(again.role, 'admin', 'an administrator was demoted by signing in');

    await roster.setRole('uid', 'trainee');
    const back = await roster.upsertPerson({ id: 'uid', email: 'a@technavious.com' });
    assert.equal(back.role, 'trainee', 'signing in restored access an administrator removed');
  });

  it('cannot become an administrator by being upserted as one', async () => {
    // upsertPerson accepts a role on creation, which the people screen uses to add
    // somebody as HR directly. Nothing on the sign-in path may reach that argument;
    // the next test is what actually holds that.
    const roster = store();
    await roster.upsertPerson({ id: 'uid', email: 'b@technavious.com' });
    const escalated = await roster.upsertPerson({
      id: 'uid',
      email: 'b@technavious.com',
      role: 'admin',
    });

    assert.equal(escalated.role, 'trainee', 'a role passed on update was honoured');
  });
});

describe('the sign-in routes', () => {
  const SIGN_IN = [
    'src/app/api/auth/session/route.ts',
    'src/app/api/auth/register/route.ts',
  ] as const;

  it('never hand a role to the roster', () => {
    // The one line that would turn self-enrolment into self-promotion. A role reaching
    // upsertPerson from a request body is the textbook version, and it would look
    // entirely reasonable in a diff.
    for (const path of SIGN_IN) {
      const source = readFileSync(path, 'utf8');
      const call = source.slice(source.indexOf('upsertPerson('));
      const args = call.slice(0, call.indexOf('});') + 1);

      assert.doesNotMatch(args, /\brole\b/, `${path} passes a role when creating a person`);
    }
  });

  it('never read a role out of the request', () => {
    for (const path of SIGN_IN) {
      const source = readFileSync(path, 'utf8');
      assert.doesNotMatch(source, /body\.role/, `${path} takes a role from the caller`);
    }
  });

  it('grant admin only to Technavious, and only once', () => {
    // register promotes exactly once, guarded by isPlatformAdmin. Anybody else becomes
    // an administrator of a customer only because one of that customer's own
    // administrators said so, which happens on the people screen and not here.
    const source = readFileSync('src/app/api/auth/register/route.ts', 'utf8');
    const promotions = [...source.matchAll(/setRole\([^)]*\)/g)];

    assert.equal(promotions.length, 1, 'the number of promotions on the sign-up path changed');
    assert.match(source, /if \(!known && isPlatformAdmin\(email\)\) await store\.setRole/);
  });

  it('leave the session route unable to promote at all', () => {
    const source = readFileSync('src/app/api/auth/session/route.ts', 'utf8');
    assert.doesNotMatch(source, /store\.setRole\(/, 'signing in can now change a stored role');
  });
});

describe('the sign-in page role picker', () => {
  it('does not send the chosen role anywhere', () => {
    // The Trainee / HR buttons set expectations and where somebody lands. If the choice
    // were ever posted, whoever holds the page could pick administrator.
    const source = readFileSync('src/app/signin/PasswordSignIn.tsx', 'utf8');
    const posts = [...source.matchAll(/body: JSON\.stringify\(\{[^}]*\}\)/g)].map((m) => m[0]);

    assert.ok(posts.length > 0, 'the sign-in page stopped posting anything');
    for (const post of posts) {
      assert.doesNotMatch(post, /expecting|role/, `the chosen role is being sent: ${post}`);
    }
  });
});
