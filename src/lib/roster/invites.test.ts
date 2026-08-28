import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_INVITE_DAYS,
  expiryFrom,
  explainProblem,
  hashToken,
  inviteProblem,
  inviteUrl,
  MAX_INVITE_DAYS,
  mintToken,
} from './invites';
import type { Invite } from './types';

const NOW = new Date('2026-03-03T10:00:00.000Z');

function invite(overrides: Partial<Invite> = {}): Invite {
  return {
    id: 'inv-1',
    tokenHash: hashToken('a-token'),
    email: null,
    deckIds: ['fire-safety'],
    createdBy: 'admin',
    createdAt: '2026-03-01T10:00:00.000Z',
    expiresAt: '2026-03-17T10:00:00.000Z',
    maxUses: 1,
    usedCount: 0,
    usedBy: [],
    revokedAt: null,
    ...overrides,
  };
}

describe('the token itself', () => {
  it('is long enough that guessing is not a threat worth modelling', () => {
    // 32 bytes, base64url. Anything materially shorter is a different design.
    assert.ok(mintToken().length >= 40);
  });

  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 50 }, () => mintToken()));
    assert.equal(seen.size, 50);
  });

  it('survives being pasted into a URL without escaping', () => {
    for (let i = 0; i < 20; i += 1) {
      const token = mintToken();
      assert.equal(encodeURIComponent(token), token);
    }
  });

  it('hashes the same token to the same digest, and a different one differently', () => {
    assert.equal(hashToken('abc'), hashToken('abc'));
    assert.notEqual(hashToken('abc'), hashToken('abd'));
  });

  it('ignores whitespace around a pasted token', () => {
    assert.equal(hashToken('  abc \n'), hashToken('abc'));
  });

  it('never yields the token back from the hash', () => {
    // Stated as a test because it is the whole reason to hash: what is stored must
    // not be usable. A digest is fixed width and hex; the token is neither.
    const token = mintToken();
    const digest = hashToken(token);
    assert.equal(digest.length, 64);
    assert.match(digest, /^[0-9a-f]+$/);
    assert.ok(!digest.includes(token));
  });
});

describe('how long an invitation lasts', () => {
  it('expires, always', () => {
    assert.ok(new Date(expiryFrom(NOW, DEFAULT_INVITE_DAYS)).getTime() > NOW.getTime());
  });

  it('refuses to last forever, however it is asked', () => {
    const far = new Date(expiryFrom(NOW, 100_000));
    const cap = new Date(NOW.getTime() + MAX_INVITE_DAYS * 24 * 60 * 60 * 1000);
    assert.equal(far.getTime(), cap.getTime());
  });

  it('is at least a day, even if asked for none', () => {
    assert.ok(new Date(expiryFrom(NOW, 0)).getTime() > NOW.getTime());
    assert.ok(new Date(expiryFrom(NOW, -5)).getTime() > NOW.getTime());
  });
});

describe('whether an invitation may be used', () => {
  it('lets a fresh one through', () => {
    assert.equal(inviteProblem(invite(), NOW), null);
  });

  it('refuses one that does not exist', () => {
    assert.equal(inviteProblem(undefined, NOW), 'unknown');
  });

  it('refuses a withdrawn one', () => {
    assert.equal(inviteProblem(invite({ revokedAt: NOW.toISOString() }), NOW), 'revoked');
  });

  it('refuses an expired one', () => {
    assert.equal(inviteProblem(invite({ expiresAt: '2026-03-01T10:00:00.000Z' }), NOW), 'expired');
  });

  it('refuses one on the exact moment it expires', () => {
    // Not a quibble: an off-by-one here means a link works for one more request than
    // it was supposed to, which is the wrong direction for a credential.
    assert.equal(inviteProblem(invite({ expiresAt: NOW.toISOString() }), NOW), 'expired');
  });

  it('refuses one that has been used up', () => {
    assert.equal(inviteProblem(invite({ maxUses: 3, usedCount: 3 }), NOW), 'exhausted');
  });

  it('lets a shared one through while seats remain', () => {
    assert.equal(inviteProblem(invite({ maxUses: 20, usedCount: 19 }), NOW), null);
  });

  describe('a personal invitation', () => {
    const personal = invite({ email: 'aditi@technavious.com' });

    it('accepts the address it was issued to, however it is capitalised', () => {
      assert.equal(inviteProblem(personal, NOW, 'Aditi@Technavious.COM'), null);
    });

    it('refuses anybody else, which is what makes forwarding it useless', () => {
      assert.equal(inviteProblem(personal, NOW, 'someone@else.com'), 'wrong-email');
    });

    it('says nothing about the address until somebody claims one', () => {
      // The page shows the invitation before knowing who is looking at it.
      assert.equal(inviteProblem(personal, NOW), null);
    });

    it('checks the address last, so a dead link is not held against the reader', () => {
      const dead = invite({ email: 'aditi@technavious.com', revokedAt: NOW.toISOString() });
      assert.equal(inviteProblem(dead, NOW, 'someone@else.com'), 'revoked');
    });
  });
});

describe('what a refused invitation says', () => {
  it('gives the same answer for a guessed link as for one that never existed', () => {
    // A different message for "no such invitation" would turn the page into an
    // oracle: a guesser could tell a real token from a wrong one.
    assert.equal(explainProblem('unknown'), 'This invitation link is not valid.');
  });

  it('is specific where being specific is safe', () => {
    assert.match(explainProblem('expired'), /expired/i);
    assert.match(explainProblem('revoked'), /withdrawn/i);
    assert.match(explainProblem('exhausted'), /used/i);
  });

  it('never repeats the address back', () => {
    assert.ok(!explainProblem('wrong-email').includes('@'));
  });
});

describe('the link itself', () => {
  it('is built from the host it was asked for on', () => {
    assert.equal(inviteUrl('https://example.com', 'abc'), 'https://example.com/invite/abc');
  });

  it('does not double the slash when the origin carries one', () => {
    assert.equal(inviteUrl('https://example.com/', 'abc'), 'https://example.com/invite/abc');
  });
});
