import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyUtterance, isNavigationOnly, type Utterance } from './intent';

/**
 * These cases are the specification, not a sample.
 *
 * Every entry here is a phrasing that was either observed in a real session or
 * caused a bug. The one that started it was "please move to the next topic",
 * which was read as a question, answered with "right, let's move on", and left
 * the next slide on screen with nobody teaching it.
 */
const CASES: Array<[string, Utterance]> = [
  // The utterance that broke a live session.
  ['Yeah. Please move to the next topic.', 'advance'],

  // Advancing, in the many ways people say it.
  ['next slide', 'advance'],
  ['next topic please', 'advance'],
  ['can we move on', 'advance'],
  ['move to the next slide', 'advance'],
  ['go ahead', 'advance'],
  ['carry on', 'advance'],
  ['keep going', 'advance'],
  ['continue', 'advance'],
  ["what's next", 'advance'],
  ['skip ahead', 'advance'],
  ["let's crack on", 'advance'],
  ['got it, next one', 'advance'],

  // Having nothing to ask is also a request to move on.
  ['no questions', 'advance'],
  ['nothing else for now', 'advance'],
  ['ok yeah I am good', 'advance'],
  ["I'm good", 'advance'],
  ['understood', 'advance'],
  ['makes sense', 'advance'],
  ['yep ready', 'advance'],

  // Negation flips the meaning. "ready" matched the advance pattern, so the deck
  // used to move on at the exact moment the trainee asked it not to.
  ["I'm not ready", 'question'],
  ['not ready yet', 'question'],
  ["I don't understand", 'question'],
  ["that's not clear", 'question'],
  ['I am not done', 'question'],
  ["I'm not sure I follow", 'question'],

  // Going back.
  ['go back', 'back'],
  ['previous slide', 'back'],
  ['take me back to the last slide', 'back'],

  // Repeating what was just said, with no new subject.
  ['can you say that again', 'repeat'],
  ['repeat that', 'repeat'],
  ['one more time', 'repeat'],

  // Questions must never be swallowed by a navigational reading.
  ['what is spear phishing', 'question'],
  ['why does classification matter', 'question'],
  ['how do I spot a malicious link', 'question'],
  ['give me an example', 'question'],
  ['what happens if I lose my laptop', 'question'],
  ['can I use my own laptop', 'question'],
  ['tell me more about passwords', 'question'],
  ['is public wifi safe', 'question'],
  ['I am not sure I understand the impact test', 'question'],

  // Naming a topic makes it a question, so the trainer can bring up that slide
  // and teach it rather than repeating whatever is currently showing.
  ['could you go over the classification matrix again please', 'question'],

  // Length wins: a nudge is short, and anything substantive is a question.
  [
    'whats next after classification and why does it matter so much for our client work',
    'question',
  ],
];

describe('classifyUtterance', () => {
  for (const [input, expected] of CASES) {
    it(`reads ${JSON.stringify(input)} as ${expected}`, () => {
      assert.equal(classifyUtterance(input), expected);
    });
  }

  it('treats a question mark as decisive, whatever else is present', () => {
    assert.equal(classifyUtterance('can we move on?'), 'question');
    assert.equal(classifyUtterance('next slide?'), 'question');
  });

  it('falls back to question on empty input rather than advancing', () => {
    assert.equal(classifyUtterance(''), 'question');
    assert.equal(classifyUtterance('   '), 'question');
  });
});

describe('isNavigationOnly', () => {
  it('is true for advance and back, which carry nothing to answer', () => {
    assert.equal(isNavigationOnly('next slide'), true);
    assert.equal(isNavigationOnly('go back'), true);
  });

  it('is false for anything with content', () => {
    assert.equal(isNavigationOnly('what is an ISMS'), false);
    assert.equal(isNavigationOnly('say that again'), false);
  });

  it('is true for nothing at all, so a blank utterance cannot become a question', () => {
    assert.equal(isNavigationOnly(undefined), true);
    assert.equal(isNavigationOnly(''), true);
  });
});
