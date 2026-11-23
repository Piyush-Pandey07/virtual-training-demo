import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { allowanceTone } from './limit-tone';

/** The monthly allowance a customer sees (UAT, issue 19). */
describe('how the monthly allowance reads', () => {
  it('says there is no cap when there is none, however many have been used', () => {
    assert.equal(allowanceTone({ used: 0, limit: null }), 'unlimited');
    assert.equal(allowanceTone({ used: 500, limit: null }), 'unlimited');
  });

  it('is fine with plenty left, warns within a fifth of the cap, and is used up at the cap', () => {
    assert.equal(allowanceTone({ used: 10, limit: 50 }), 'fine');
    assert.equal(allowanceTone({ used: 39, limit: 50 }), 'fine');
    assert.equal(allowanceTone({ used: 40, limit: 50 }), 'nearly');
    assert.equal(allowanceTone({ used: 49, limit: 50 }), 'nearly');
    assert.equal(allowanceTone({ used: 50, limit: 50 }), 'reached');
    assert.equal(allowanceTone({ used: 53, limit: 50 }), 'reached');
  });

  it('warns at two left on a small cap, where a fifth would round to nothing', () => {
    assert.equal(allowanceTone({ used: 2, limit: 5 }), 'fine');
    assert.equal(allowanceTone({ used: 3, limit: 5 }), 'nearly');
    assert.equal(allowanceTone({ used: 0, limit: 0 }), 'reached');
  });
});
