import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { bankFromCsv, CSV_TEMPLATE, parseBankCsv, splitCsv } from './csv';
import {
  AnswersRejected,
  checkBands,
  checkFeedback,
  levelFor,
  mark,
  paperFor,
  passes,
  percentOf,
  summaryOf,
} from './scoring';
import { cleanSample, generateSampleQuestions, SampleUnusable, shuffleOptions } from './sample';
import type { DeckRecord } from '../deck-types';
import type { AssessmentResult, BankQuestion, QuestionBank } from './types';

/**
 * The rules an assessment is marked by, read without a store.
 *
 * Every edge here is one somebody's result depends on: 69% beside "Fail" and 70% beside
 * "Pass", a score exactly on a band edge, and a CSV row that would be wrong if the parser
 * guessed. The service tests cover who may submit and how often; these cover what the
 * answer is once they have.
 */

const QUESTIONS: BankQuestion[] = Array.from({ length: 10 }, (_, index) => ({
  id: `q${index + 1}`,
  question: `Question ${index + 1}`,
  options: ['Right', 'Wrong', 'Also wrong'],
  correctIndex: 0,
}));

/** Answers with the first `right` correct and the rest wrong. */
function answersWith(right: number): Record<string, number> {
  return Object.fromEntries(
    QUESTIONS.map((question, index) => [question.id, index < right ? 0 : 1]),
  );
}

describe('marking', () => {
  it('counts the right answers and records each one', () => {
    const marked = mark(QUESTIONS, answersWith(7));
    assert.equal(marked.correct, 7);
    assert.equal(marked.total, 10);
    assert.equal(marked.percent, 70);
    assert.equal(marked.answers.length, 10);
    assert.deepEqual(marked.answers[0], { questionId: 'q1', chosenIndex: 0, correct: true });
    assert.deepEqual(marked.answers[9], { questionId: 'q10', chosenIndex: 1, correct: false });
  });

  it('rounds a percentage down, so nothing short of the mark is shown as reaching it', () => {
    assert.equal(percentOf(2, 3), 66);
    assert.equal(percentOf(7, 10), 70);
    assert.equal(percentOf(139, 200), 69);
    assert.equal(percentOf(0, 0), 0);
  });

  it('refuses an unanswered question rather than marking it wrong', () => {
    const answers: Record<string, number> = answersWith(10);
    delete answers.q4;
    assert.throws(
      () => mark(QUESTIONS, answers),
      (error: unknown) =>
        error instanceof AnswersRejected &&
        error.status === 400 &&
        /Question 4/.test(error.message),
    );
  });

  it('refuses an option that does not exist', () => {
    for (const bad of [3, -1, 1.5, '0', null]) {
      assert.throws(() => mark(QUESTIONS, { ...answersWith(10), q2: bad }), AnswersRejected);
    }
  });

  it('refuses answers to a question the bank does not have, as a changed paper', () => {
    assert.throws(
      () => mark(QUESTIONS, { ...answersWith(10), q99: 0 }),
      (error: unknown) => error instanceof AnswersRejected && error.status === 409,
    );
  });
});

describe('the pass mark', () => {
  it('passes at 70% and above, and not below', () => {
    assert.equal(passes(70), true);
    assert.equal(passes(100), true);
    assert.equal(passes(69), false);
    assert.equal(passes(percentOf(7, 10)), true);
    assert.equal(passes(percentOf(6, 9)), false);
  });
});

describe('level bands', () => {
  it('places a score by the default bands, each edge in the band above', () => {
    assert.equal(levelFor(0), 'beginner');
    assert.equal(levelFor(39), 'beginner');
    assert.equal(levelFor(40), 'intermediate');
    assert.equal(levelFor(74), 'intermediate');
    assert.equal(levelFor(75), 'advanced');
    assert.equal(levelFor(100), 'advanced');
  });

  it('uses bands an administrator set', () => {
    const bands = { intermediateFrom: 50, advancedFrom: 90 };
    assert.equal(levelFor(49, bands), 'beginner');
    assert.equal(levelFor(50, bands), 'intermediate');
    assert.equal(levelFor(90, bands), 'advanced');
  });

  it('accepts sensible bands and refuses the rest with a reason', () => {
    assert.deepEqual(checkBands({ intermediateFrom: 30, advancedFrom: 80 }), {
      ok: true,
      bands: { intermediateFrom: 30, advancedFrom: 80 },
    });
    for (const bad of [
      { intermediateFrom: 0, advancedFrom: 50 },
      { intermediateFrom: 60, advancedFrom: 60 },
      { intermediateFrom: 60, advancedFrom: 40 },
      { intermediateFrom: 40, advancedFrom: 101 },
      { intermediateFrom: 40.5, advancedFrom: 75 },
      { intermediateFrom: '40', advancedFrom: 75 },
      null,
    ]) {
      const checked = checkBands(bad);
      assert.equal(checked.ok, false, JSON.stringify(bad));
      if (!checked.ok) assert.ok(checked.error.length > 10);
    }
  });
});

describe('answer secrecy', () => {
  const bank: QuestionBank = {
    id: 'deck__pre',
    deckId: 'deck',
    kind: 'pre',
    questions: QUESTIONS,
    source: 'upload',
    version: 'v1',
    savedBy: 'admin',
    savedAt: '2026-11-08T00:00:00.000Z',
  };

  it('sends a participant no answer, under any name', () => {
    const paper = paperFor(bank);
    const text = JSON.stringify(paper);
    assert.doesNotMatch(text, /correct/i);
    assert.deepEqual(Object.keys(paper.questions[0]!).sort(), ['id', 'options', 'question']);
  });

  it('tells a participant their score, not which questions they got right', () => {
    const result: AssessmentResult = {
      id: 'p__deck__post',
      personId: 'p',
      deckId: 'deck',
      kind: 'post',
      sessionId: null,
      answers: mark(QUESTIONS, answersWith(8)).answers,
      correct: 8,
      total: 10,
      percent: 80,
      passed: true,
      passMark: 70,
      bankVersion: 'v1',
      bankSource: 'upload',
      submittedAt: '2026-11-08T00:00:00.000Z',
    };
    const summary = summaryOf(result);
    assert.equal(summary.passed, true);
    assert.equal('answers' in summary, false);
    assert.doesNotMatch(JSON.stringify(summary), /questionId|chosenIndex/);
  });

  it('keeps the participant screens off the answer field entirely', () => {
    // The paper type has no answer field, so these could only reach one by importing the
    // bank itself. Read rather than trusted.
    for (const path of [
      'src/app/assessment/[kind]/AssessmentForm.tsx',
      'src/app/assessment/[kind]/ResultCard.tsx',
      'src/app/assessment/[kind]/page.tsx',
      'src/app/feedback/FeedbackForm.tsx',
      'src/app/api/assessments/route.ts',
    ]) {
      assert.doesNotMatch(
        readFileSync(path, 'utf8'),
        /correctIndex|getBank\(|bankForAdministrator/,
        path,
      );
    }
  });
});

describe('reading a CSV', () => {
  it('reads the template it offers', () => {
    const parsed = parseBankCsv(CSV_TEMPLATE);
    assert.deepEqual(parsed.problems, []);
    assert.equal(parsed.questions.length, 2);
    assert.equal(parsed.questions[0]!.correctIndex, 0);
    assert.equal(parsed.questions[0]!.options.length, 3);
    // B is the second option.
    assert.equal(parsed.questions[1]!.correctIndex, 1);
    assert.equal(parsed.questions[1]!.options.length, 4);
  });

  it('handles what spreadsheets write: a BOM, CRLF, quotes, commas and line breaks', () => {
    const text =
      '﻿question,option_1,option_2,correct\r\n' +
      '"Which, of these, is right?","Say ""yes""","A line\r\nbreak",1\r\n' +
      ',,,\r\n';
    const parsed = parseBankCsv(text);
    assert.deepEqual(parsed.problems, []);
    assert.deepEqual(parsed.questions, [
      {
        question: 'Which, of these, is right?',
        options: ['Say "yes"', 'A line\r\nbreak'],
        correctIndex: 0,
      },
    ]);
  });

  it('reads a file with no header row the same way', () => {
    const parsed = parseBankCsv('What is two and two?,Three,Four,B\n');
    assert.deepEqual(parsed.problems, []);
    assert.equal(parsed.questions[0]!.correctIndex, 1);
  });

  it('reports every bad row with the row a spreadsheet would show, and guesses at none', () => {
    const text = [
      'question,option_1,option_2,option_3,option_4,correct',
      'Good question,Yes,No,,,1', // row 2: fine
      ',Yes,No,,,1', // row 3: empty question
      'Only one option,Yes,,,,1', // row 4: too few options
      'A gap,Yes,,Maybe,,1', // row 5: gap between options
      'Points past the end,Yes,No,,,3', // row 6: correct option is empty
      'Not an option,Yes,No,,,Z', // row 7: no such letter for two options
      'Repeated,Yes,yes,,,1', // row 8: duplicate options
      'Missing answer,Yes,No,,,', // row 9: no correct answer
      'Short', // row 10: too few columns
    ].join('\n');
    const parsed = parseBankCsv(text);
    const rows = parsed.problems.map((problem) => problem.row);
    assert.deepEqual(rows, [3, 4, 5, 6, 7, 8, 9, 10]);
    assert.match(parsed.problems.find((p) => p.row === 5)!.message, /gap/);
    assert.match(parsed.problems.find((p) => p.row === 6)!.message, /only 2 options/);
    // The good row is still shown in the preview...
    assert.equal(parsed.questions.length, 1);
    // ...but a file with any bad row is not saved at all.
    const saved = bankFromCsv(text);
    assert.equal(saved.ok, false);
  });

  it('refuses more than six options and an empty file', () => {
    assert.match(parseBankCsv('Q,a,b,c,d,e,f,g,1').problems[0]!.message, /at most 6/);
    assert.match(
      parseBankCsv('question,option_1,option_2,correct\n').problems[0]!.message,
      /no questions/,
    );
    assert.match(parseBankCsv('').problems[0]!.message, /no questions/);
  });

  it('reports a row by the line it starts on, even after a quoted line break', () => {
    const parsed = parseBankCsv('question,a,b,correct\n"Two\nlines",Yes,No,1\n,Yes,No,1\n');
    assert.deepEqual(
      parsed.problems.map((problem) => problem.row),
      [4],
    );
  });

  it('splits rows without losing an empty last field', () => {
    assert.deepEqual(splitCsv('a,b,\n'), [{ line: 1, fields: ['a', 'b', ''] }]);
  });
});

describe('feedback answers', () => {
  const full = { trainer: 5, content: 4, material: 3, facility: 2, learned: 1 };

  it('takes every rating and an optional comment, trimmed', () => {
    const checked = checkFeedback(full, { comment: '  Very useful.  ' });
    assert.deepEqual(checked, {
      ok: true,
      feedback: { ratings: full, comments: { comment: 'Very useful.' } },
    });
    const without = checkFeedback(full, {});
    assert.equal(without.ok && Object.keys(without.feedback.comments).length, 0);
  });

  it('refuses a missing or out-of-range rating, an unknown field, and an over-long comment', () => {
    assert.equal(checkFeedback({ ...full, learned: undefined }, {}).ok, false);
    assert.equal(checkFeedback({ ...full, trainer: 6 }, {}).ok, false);
    assert.equal(checkFeedback({ ...full, trainer: 0 }, {}).ok, false);
    assert.equal(checkFeedback({ ...full, trainer: 4.5 }, {}).ok, false);
    assert.equal(checkFeedback({ ...full, extra: 3 }, {}).ok, false);
    assert.equal(checkFeedback(full, { comment: 'x'.repeat(1001) }).ok, false);
    assert.equal(checkFeedback(full, { comment: 'x'.repeat(1000) }).ok, true);
  });
});

describe('a sample bank', () => {
  const deck = {
    meta: { title: 'Security basics', ownerDescription: 'Office staff' },
    slides: [
      { id: 1, title: 'Passwords', bullets: ['Use a manager'], keyPoints: [], speakerNotes: [] },
    ],
    topics: [],
  } as unknown as DeckRecord;

  const good = (index: number) => ({
    question: `Question ${index}?`,
    options: ['Right', 'Wrong', 'Also wrong', 'Still wrong'],
    correctIndex: 0,
  });

  it('keeps only questions that meet the same rules as an upload', () => {
    const cleaned = cleanSample({
      questions: [
        good(1),
        { question: '', options: ['a', 'b'], correctIndex: 0 },
        { question: 'One option', options: ['a'], correctIndex: 0 },
        { question: 'Past the end', options: ['a', 'b'], correctIndex: 2 },
        { question: 'Repeated', options: ['a', 'A'], correctIndex: 0 },
        { question: 'Not text', options: ['a', 3], correctIndex: 0 },
      ],
    });
    assert.equal(cleaned.length, 1);
    assert.deepEqual(cleanSample('nonsense'), []);
  });

  it('moves the right answer without changing which answer is right', () => {
    let seed = 0.3;
    const random = () => (seed = (seed * 7.3) % 1);
    const shuffled = shuffleOptions([good(1), good(2), good(3)], random);
    for (const question of shuffled) {
      assert.equal(question.options[question.correctIndex], 'Right');
      assert.equal(question.options.length, 4);
    }
  });

  it('is generated through whatever model it is given, so no test calls Gemini', async () => {
    let prompt = '';
    const model = {
      async generate(text: string) {
        prompt = text;
        return JSON.stringify({ questions: Array.from({ length: 12 }, (_, i) => good(i)) });
      },
    };
    const questions = await generateSampleQuestions(deck, 'post', model, () => 0);
    assert.equal(questions.length, 10);
    assert.match(prompt, /Security basics/);
    assert.match(prompt, /Use a manager/);
    assert.match(prompt, /post-session/);
  });

  it('refuses a sample with too few usable questions, or an answer that is not JSON', async () => {
    const few = { generate: async () => JSON.stringify({ questions: [good(1), good(2)] }) };
    await assert.rejects(generateSampleQuestions(deck, 'pre', few), SampleUnusable);
    const prose = { generate: async () => 'Here are your questions!' };
    await assert.rejects(generateSampleQuestions(deck, 'pre', prose), SampleUnusable);
  });
});
