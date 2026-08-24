import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  closingSentence,
  earlierSimilarQuestion,
  lastTurnAskedSomething,
  questionOverlap,
  recentClosings,
  turnsOnSlide,
} from './trainee-read';
import type { HistoryTurn } from './types';

const trainer = (text: string, slideId = 2): HistoryTurn => ({ speaker: 'trainer', text, slideId });
const trainee = (text: string, slideId = 2): HistoryTurn => ({ speaker: 'trainee', text, slideId });

describe('finding where a turn hands back', () => {
  it('takes the last sentence, not the last line', () => {
    // A spoken turn is a paragraph; the closing is its final clause.
    assert.equal(
      closingSentence('An ISMS is a management system. It is not paperwork. Does that help?'),
      'Does that help?',
    );
  });

  it('copes with no terminal punctuation', () => {
    assert.equal(closingSentence('just one clause'), 'just one clause');
  });

  it('returns nothing for nothing', () => {
    assert.equal(closingSentence(''), '');
    assert.equal(closingSentence('   '), '');
  });
});

/**
 * The measurement that made this necessary: seven of nine replies in one session
 * closed with the same comprehension check in slightly different words, while the
 * prompt was explicitly asking for variety. A model cannot avoid a pattern it has
 * not been shown, so it gets shown.
 */
describe('remembering how the trainer has already closed', () => {
  const history = [
    trainer('An ISMS is a management system. Does that make sense?'),
    trainee('yes I think so'),
    trainer('Phishing is targeted. Does that help clarify it?'),
    trainee('what about passwords'),
    trainer('Use a passphrase. Which of these would you like next?'),
  ];

  it('collects the trainer’s closings, oldest first', () => {
    assert.deepEqual(recentClosings(history), [
      'Does that make sense?',
      'Does that help clarify it?',
      'Which of these would you like next?',
    ]);
  });

  it('ignores what the trainee said', () => {
    assert.ok(!recentClosings(history).some((closing) => closing.includes('yes I think so')));
  });

  it('keeps only the most recent, so a long session does not flood the prompt', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      trainer(`Turn ${index}. Closing ${index}?`),
    );
    const kept = recentClosings(many, 5);
    assert.equal(kept.length, 5);
    assert.equal(kept[4], 'Closing 19?');
  });

  it('returns nothing at the start of a session', () => {
    assert.deepEqual(recentClosings([]), []);
  });
});

/**
 * When the trainer's last turn asked something, the trainee's reply is as likely to
 * be an attempt at it as a new question, and the two need completely different
 * replies. The prompt always described how to handle an attempt; it had no way of
 * knowing one had arrived.
 */
describe('noticing that the trainer asked something', () => {
  it('is true when the last trainer turn ended on a question', () => {
    assert.equal(lastTurnAskedSomething([trainer('So what would you do?')]), true);
  });

  it('is false when it ended on a statement', () => {
    assert.equal(lastTurnAskedSomething([trainer('That is the whole policy.')]), false);
  });

  it('looks at the trainer, not the trainee', () => {
    const history = [trainer('That is the whole policy.'), trainee('is that everything?')];
    assert.equal(lastTurnAskedSomething(history), false);
  });

  it('only counts a question at the end, not one in passing', () => {
    // "Why does that matter? Because data leaves the building." asks nothing of them.
    assert.equal(
      lastTurnAskedSomething([trainer('Why does that matter? Because data leaves the building.')]),
      false,
    );
  });

  it('is false at the start of a session', () => {
    assert.equal(lastTurnAskedSomething([]), false);
  });
});

describe('measuring how alike two questions are', () => {
  it('scores a re-asking highly', () => {
    assert.ok(questionOverlap('what is an ISMS exactly', 'so what is an ISMS again') > 0.4);
  });

  it('scores unrelated questions low', () => {
    assert.ok(questionOverlap('can I use my own laptop', 'who do I report an incident to') < 0.2);
  });

  it('is not fooled by shared filler', () => {
    // Both are mostly stop words. Without filtering them these would look identical.
    assert.ok(questionOverlap('what about that then', 'what about this really') < 0.45);
  });

  it('handles empty input', () => {
    assert.equal(questionOverlap('', 'anything'), 0);
    assert.equal(questionOverlap('anything', ''), 0);
  });
});

/**
 * A trainee asking the same thing twice is telling you the first answer did not
 * land. Repeating it more slowly is the wrong response and the most likely one.
 */
describe('spotting a question asked before', () => {
  const history = [
    trainee('what is an ISMS exactly'),
    trainer('It is a management system.'),
    trainee('can I use my own laptop'),
    trainer('Not for client data.'),
  ];

  it('finds the earlier asking of the same thing', () => {
    const found = earlierSimilarQuestion(history, 'so what is an ISMS again');
    assert.equal(found, 'what is an ISMS exactly');
  });

  it('finds a word-for-word repeat', () => {
    assert.equal(
      earlierSimilarQuestion(history, 'can I use my own laptop'),
      'can I use my own laptop',
    );
  });

  it('does not fire on a genuine follow-up about the same subject', () => {
    // "what if I lose it" follows on from the laptop question without repeating it,
    // and treating it as a repeat would make the trainer apologise for nothing.
    assert.equal(earlierSimilarQuestion(history, 'what if I lose it at a client site'), undefined);
  });

  it('does not fire on an unrelated question', () => {
    assert.equal(earlierSimilarQuestion(history, 'who do I report an incident to'), undefined);
  });

  it('does not fire on the first question of a session', () => {
    assert.equal(earlierSimilarQuestion([], 'what is an ISMS'), undefined);
  });

  it('ignores what the trainer said, even when it echoes the question', () => {
    const echoing = [trainer('An ISMS is a management system for information security.')];
    assert.equal(earlierSimilarQuestion(echoing, 'what is an ISMS management system'), undefined);
  });
});

describe('counting turns spent on one slide', () => {
  it('counts the run at the end of the history', () => {
    const history = [trainer('a', 1), trainee('b', 2), trainer('c', 2), trainee('d', 2)];
    assert.equal(turnsOnSlide(history, 2), 3);
  });

  it('stops at a slide change rather than counting every visit', () => {
    const history = [trainer('a', 2), trainee('b', 3), trainer('c', 2)];
    assert.equal(turnsOnSlide(history, 2), 1);
  });

  it('is zero for a slide just arrived at', () => {
    assert.equal(turnsOnSlide([trainer('a', 1)], 5), 0);
  });
});
