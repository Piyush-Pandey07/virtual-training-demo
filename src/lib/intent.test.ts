import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyUtterance, detectAnswerStyle, isNavigationOnly, type Utterance } from './intent';

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

/**
 * Register detection on what people actually say out loud.
 *
 * Found by running a real session end to end and reading what the classifier made
 * of the transcripts. Getting this wrong is not cosmetic: the default register
 * answers at normal depth and repeats the very thing the trainee has just said they
 * could not follow.
 */
describe('asking for something to be made simpler', () => {
  const simpler = [
    // "more simply" is among the most natural phrasings and matched nothing: the
    // pattern had simpler and simplify, but not simply.
    'can you explain that more simply',
    'put that in simple terms',
    'in simpler terms please',
    'can you simplify that',
    'break it down for me',
    'dumb it down a bit',
    // Speech to text returns either form of the contraction depending on delivery,
    // and only the contracted one was matched.
    "I don't understand",
    'I do not understand',
    'I do not follow',
    'I did not get that',
    'sorry I am not following',
    'sorry I got lost',
    'that is too technical',
    'what do you mean',
    // A typographic apostrophe is what a phone and a Mac produce, and it is
    // indistinguishable on screen from the ASCII one the patterns are written with.
    'I don’t understand',
    'I didn’t follow that',
  ];

  for (const utterance of simpler) {
    it(`reads "${utterance}" as a request to simplify`, () => {
      assert.equal(detectAnswerStyle(utterance), 'simpler');
    });
  }

  it('still tells the other registers apart', () => {
    assert.equal(detectAnswerStyle('give me an example'), 'example');
    assert.equal(detectAnswerStyle('which annex a control is that'), 'standard');
    assert.equal(detectAnswerStyle('go deeper on that'), 'deeper');
    assert.equal(detectAnswerStyle('what about passwords'), 'default');
    assert.equal(detectAnswerStyle('who do I report an incident to'), 'default');
  });
});

describe('typographic apostrophes in navigation', () => {
  it('reads a contraction with a curly apostrophe the same as a straight one', () => {
    assert.equal(classifyUtterance('what’s a phishing email'), 'question');
    assert.equal(classifyUtterance("what's a phishing email"), 'question');
  });

  it('still hears a rhetorical request to move on as one', () => {
    assert.equal(classifyUtterance('can’t we just move on'), 'advance');
  });

  it('still refuses to advance on negated readiness', () => {
    assert.equal(classifyUtterance('I’m not ready'), 'question');
    assert.equal(classifyUtterance("I'm not ready"), 'question');
  });
});

/**
 * A question asking for a set of things.
 *
 * Its own register because the others could not hold one. "What are the four
 * classification tiers" fell through to `default`, was told three sentences, and came
 * back at 107 words. That was not indiscipline: naming two tiers of four would have
 * been a wrong answer, and the deck is the authority a trainee acts on.
 */
describe('asking for a list', () => {
  const lists = [
    'what are the four classification tiers',
    'what are the three reporting routes',
    'which policies apply to me',
    'what are the main threats',
    'can you list them',
    'could you name the tiers',
    'run through the levels',
    'walk me through the steps',
    'please list the options',
    'ok so list them',
    'what are the 4 tiers',
  ];

  for (const utterance of lists) {
    it(`reads "${utterance}" as a request for a set`, () => {
      assert.equal(detectAnswerStyle(utterance), 'list');
    });
  }

  /**
   * The expensive failure. A false positive hands an ordinary question half again as
   * many words as it needs, which is the thing the whole length exercise removed.
   */
  const notLists: Array<[string, string]> = [
    ['can I use my own laptop for work', 'default'],
    ['what if I lose it at a client site', 'default'],
    ['who do I tell', 'default'],
    ['is tailgating really a problem', 'default'],
    ['what is an ISMS', 'default'],
    ['where are the policies kept', 'default'],
    // A list mentioned in passing is not a request for one. Both of these matched
    // until the request verbs were anchored to the front of the utterance.
    ['is the list of policies long', 'default'],
    ['I saw a list of threats yesterday', 'default'],
    ['do I need to name the file a certain way', 'default'],
    // The registers that come first, and should keep winning.
    ['sorry, what actually is an ISMS? I got lost', 'simpler'],
    ['can you give me an example of that', 'example'],
    ['which annex a control covers that', 'standard'],
  ];

  for (const [utterance, expected] of notLists) {
    it(`reads "${utterance}" as ${expected}, not a list`, () => {
      assert.equal(detectAnswerStyle(utterance), expected);
    });
  }
});
