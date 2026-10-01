import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TextItem } from 'pdfjs-dist/types/src/display/api';

import { closeUpLetterSpacing, groupIntoRows, joinRow, titleHintFrom, type TextRow } from './render';

/**
 * A pdf.js text run.
 *
 * pdf.js reports text as positioned runs rather than lines, which is the whole
 * reason this module exists. `transform[4]` is x, `transform[5]` is y, and y grows
 * upwards, so a larger y is higher on the page.
 */
function run(str: string, x: number, y: number, width: number, height = 10): TextItem {
  return {
    str,
    dir: 'ltr',
    width,
    height,
    transform: [height, 0, 0, height, x, y],
    fontName: 'test',
    hasEOL: false,
  } as TextItem;
}

function row(parts: Array<[string, number, number]>, height = 10): TextRow {
  return {
    y: 0,
    height,
    parts: parts.map(([str, x, width]) => ({ str, x, width })),
  };
}

/**
 * The defect this guards was found by uploading a real PDF and reading the stored
 * deck: "one PDF from here on" had become "onePDFfromhereon", and that text goes
 * straight into the prompt to be read aloud.
 */
describe('joining a row of text runs', () => {
  it('puts a space where the page has a gap', () => {
    // Three runs with clear gaps between them, which is what a normal line of text
    // looks like once a PDF producer has finished with it.
    const line = joinRow(
      row([
        ['one', 0, 20],
        ['PDF', 25, 22],
        ['from', 52, 26],
        ['here', 83, 24],
        ['on', 112, 15],
      ]),
    );
    assert.equal(line, 'one PDF from here on');
  });

  it('does not split a word that arrived as two runs', () => {
    // Kerning and font changes split words mid-way, with no gap at the join.
    const line = joinRow(
      row([
        ['clas', 0, 30],
        ['sification', 30, 70],
      ]),
    );
    assert.equal(line, 'classification');
  });

  it('does not double a space the producer already emitted', () => {
    const line = joinRow(
      row([
        ['hello ', 0, 40],
        ['world', 45, 35],
      ]),
    );
    assert.equal(line, 'hello world');
  });

  it('scales the gap threshold to the type size', () => {
    // A four-unit gap is a word break in 8pt text and nothing at all in 40pt, so a
    // fixed threshold gets one of the two wrong.
    const small = joinRow(
      row(
        [
          ['a', 0, 4],
          ['b', 8, 4],
        ],
        8,
      ),
    );
    const large = joinRow(
      row(
        [
          ['a', 0, 4],
          ['b', 8, 4],
        ],
        60,
      ),
    );
    assert.equal(small, 'a b');
    assert.equal(large, 'ab');
  });

  it('reads left to right whatever order the runs arrive in', () => {
    const line = joinRow(
      row([
        ['world', 50, 35],
        ['hello', 0, 40],
      ]),
    );
    assert.equal(line, 'hello world');
  });

  it('collapses stray whitespace', () => {
    assert.equal(joinRow(row([['  spaced   out  ', 0, 80]])), 'spaced out');
  });
});

describe('grouping runs into rows', () => {
  it('puts runs at the same height on the same line', () => {
    const rows = groupIntoRows([run('left', 0, 700, 30), run('right', 40, 700, 35)]);
    assert.equal(rows.length, 1);
    assert.equal(joinRow(rows[0]), 'left right');
  });

  it('orders rows top to bottom, not by the order they arrive', () => {
    // y grows upwards in a PDF, and producers emit runs in no reliable order.
    const rows = groupIntoRows([run('bottom', 0, 100, 50), run('top', 0, 700, 30)]);
    assert.deepEqual(rows.map(joinRow), ['top', 'bottom']);
  });

  it('tolerates a baseline wobble within the type size', () => {
    const rows = groupIntoRows([run('same', 0, 700, 30), run('line', 40, 702, 30)]);
    assert.equal(rows.length, 1);
  });

  it('separates lines that are genuinely apart', () => {
    const rows = groupIntoRows([run('first', 0, 700, 30), run('second', 0, 680, 35)]);
    assert.equal(rows.length, 2);
  });

  it('ignores runs that carry no text', () => {
    const rows = groupIntoRows([run('   ', 0, 700, 10), run('real', 0, 680, 30)]);
    assert.deepEqual(rows.map(joinRow), ['real']);
  });
});

/**
 * The other defect from the same upload: a page holding a diagram had its title set
 * to a row of box-drawing characters, which then appeared in the slide rail and in
 * the prompt.
 */
describe('guessing a page title', () => {
  it('picks the line set in the largest type', () => {
    const hint = titleHintFrom([
      row([['The one new service', 0, 200]], 24),
      row([['A single-purpose container', 0, 200]], 10),
      row([['Google Cloud Run or Fly.io', 0, 200]], 10),
    ]);
    assert.equal(hint, 'The one new service');
  });

  it('refuses box-drawing characters however large they are set', () => {
    const hint = titleHintFrom([
      row([['└─────────────────►', 0, 200]], 40),
      row([['The one new service', 0, 200]], 24),
      row([['body text here', 0, 200]], 10),
      row([['more body text', 0, 200]], 10),
    ]);
    assert.equal(hint, 'The one new service');
  });

  it('offers nothing on a page of uniform body text', () => {
    // There is no title on such a page, and calling the first line one is a guess
    // the caller is better off making itself.
    const hint = titleHintFrom([
      row([['first line of a paragraph', 0, 200]], 10),
      row([['second line of a paragraph', 0, 200]], 10),
      row([['third line of a paragraph', 0, 200]], 10),
    ]);
    assert.equal(hint, undefined);
  });

  it('offers nothing when there is no prose at all', () => {
    assert.equal(titleHintFrom([row([['───────', 0, 100]], 20)]), undefined);
  });

  it('ignores a heading too long to be one', () => {
    const long = 'x'.repeat(200);
    const hint = titleHintFrom([
      row([[long, 0, 400]], 40),
      row([['Actual Heading', 0, 200]], 24),
      row([['body', 0, 100]], 10),
      row([['body', 0, 100]], 10),
    ]);
    assert.equal(hint, 'Actual Heading');
  });
});

/**
 * Letter-spaced headings, as pdf.js 6.2.108 actually reports them.
 *
 * Captured from a PDF built for the purpose: one heading letter-spaced by the renderer,
 * one with mixed case and digits, one spaced out by hand with three spaces between the
 * words, and ordinary lines either side. Both kinds of spacing arrive the same way: one
 * run per word with a space between every letter, and the gap between words as its own
 * whitespace-only run. Real output rather than what pdf.js was assumed to do, which is
 * the reason a deck's title came out as "C A P A B I L I T Y B U I L D I N G".
 */
const SPACED_PAGE: TextItem[] = [
  run("C A P A B I L I T Y", 60, 520, 249, 28),
  run(" ", 309, 520, 25.78, 0),
  run("B U I L D I N G", 334.78, 520, 198.32, 28),
  run("", 60, 460, 0, 0),
  run("R E V E N U E", 60, 460, 148.35, 22),
  run(" ", 208.35, 460, 20.12, 0),
  run("v s", 228.46, 460, 31.46, 22),
  run(" ", 259.93, 460, 20.12, 0),
  run("F Y 2 6 - 2 7", 280.04, 460, 126.37, 22),
  run(" ", 406.41, 460, 20.12, 0),
  run("T A R G E T", 426.53, 460, 125.44, 22),
  run("", 60, 400, 0, 0),
  run("Monthly Business Review", 60, 400, 392.99, 32),
  run("", 60, 350, 0, 0),
  run("The ISMS policy applies to all staff and contractors.", 60, 350, 343.1, 14),
  run("Step 1 of 3", 60, 310, 70.8, 14),
  run("", 60, 270, 0, 0),
  run("C A P A B I L I T Y", 60, 270, 187.04, 22),
  run(" ", 247.04, 270, 18.35, 0),
  run("B U I L D I N G", 265.39, 270, 149.14, 22),
  run("", 60, 230, 0, 0),
  run("1 2 3 4 5", 60, 230, 54.49, 14)
];

describe('headings printed with their letters spread out', () => {
  const lines = groupIntoRows(SPACED_PAGE).map(joinRow);

  it('reads a letter-spaced heading as words, keeping the space between them', () => {
    assert.equal(lines[0], 'CAPABILITY BUILDING');
  });

  it('keeps mixed case, digits and hyphens inside a letter-spaced heading', () => {
    assert.equal(lines[1], 'REVENUE vs FY26-27 TARGET');
  });

  it('reads a heading spaced out by hand the same way', () => {
    assert.equal(lines[5], 'CAPABILITY BUILDING');
  });

  it('leaves ordinary lines exactly as they were', () => {
    assert.equal(lines[2], 'Monthly Business Review');
    assert.equal(lines[3], 'The ISMS policy applies to all staff and contractors.');
    assert.equal(lines[4], 'Step 1 of 3');
  });

  it('leaves a row of numbers alone, since it has no letters to close up', () => {
    // A rating scale or a row of step markers. Closing it up would read "12345".
    assert.equal(lines[6], '1 2 3 4 5');
  });

  it('gives the title hint the words, not the letters', () => {
    // The spaced heading over two lines of body text, so it stands out as a title the
    // way titleHintFrom requires. Before the fix this returned the letters, spaced.
    const page = [...SPACED_PAGE.slice(0, 3), SPACED_PAGE[14]!, SPACED_PAGE[15]!];
    assert.equal(titleHintFrom(groupIntoRows(page)), 'CAPABILITY BUILDING');
  });
});

describe('closing up one run', () => {
  it('closes up a word whose letters are spaced', () => {
    assert.equal(closeUpLetterSpacing('C A P A B I L I T Y'), 'CAPABILITY');
    assert.equal(closeUpLetterSpacing('v s'), 'vs');
  });

  it('splits a whole spaced heading kept in one run at its wider gaps', () => {
    assert.equal(closeUpLetterSpacing('C A P A B I L I T Y   B U I L D I N G'), 'CAPABILITY BUILDING');
  });

  it('touches nothing that is not spaced letter by letter', () => {
    for (const text of ['Step 1 of 3', 'The ISMS policy', 'a', 'AB C', '1 2 3 4 5', 'x', '']) {
      assert.equal(closeUpLetterSpacing(text), text, `${JSON.stringify(text)} was changed`);
    }
  });
});
