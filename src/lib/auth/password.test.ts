import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MIN_PASSWORD_LENGTH, passwordProblem, passwordStrength } from './password';

describe('what counts as an acceptable password', () => {
  it('accepts a passphrase, which is the shape being encouraged', () => {
    assert.equal(passwordProblem('correct horse battery staple'), null);
  });

  it('accepts a long mixed string', () => {
    assert.equal(passwordProblem('7fQ!zm2Kd9vLxR'), null);
  });

  it('refuses anything short, whatever else is true of it', () => {
    // The classic four-classes password, and short. It fails on the thing that
    // actually costs an attacker something.
    assert.ok(passwordProblem('Ab3!xY') !== null);
    assert.ok(passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH - 1)) !== null);
  });

  it('does not demand punctuation or capitals', () => {
    // Demanding them produces Password1! and nothing else.
    assert.equal(passwordProblem('the quiet blue kettle'), null);
  });

  for (const bad of [
    'mypasswordislong',
    'Welcome-to-the-team',
    'technavious2026!!',
    'qwertyqwerty1',
  ]) {
    it(`refuses "${bad}", which is guessed early`, () => {
      assert.ok(passwordProblem(bad) !== null);
    });
  }

  it('refuses one built from the address it protects', () => {
    assert.ok(passwordProblem('aditi-sharma-2026', 'aditi@technavious.com') !== null);
  });

  it('does not read a two-letter address into every password', () => {
    // A short local part would otherwise match almost anything by coincidence.
    assert.equal(passwordProblem('the quiet blue kettle', 'jo@technavious.com'), null);
  });

  it('refuses one long character run', () => {
    assert.ok(passwordProblem('aaaaaaaaaaaaaaaa') !== null);
    assert.ok(passwordProblem('abababababababab') !== null);
  });

  it('refuses whitespace pretending to be length', () => {
    assert.ok(passwordProblem('              ') !== null);
  });

  it('says what to do, not just what is wrong', () => {
    const said = passwordProblem('short');
    assert.ok(said && said.length > 20, 'a bare rejection tells somebody nothing');
  });
});

describe('the strength hint', () => {
  it('calls an unacceptable password weak', () => {
    assert.equal(passwordStrength('short'), 'weak');
  });

  it('rates a long passphrase above a bare minimum one', () => {
    assert.equal(passwordStrength('the quiet blue kettle on the shelf'), 'good');
    assert.equal(passwordStrength('kettle blue x'), 'fair');
  });
});
