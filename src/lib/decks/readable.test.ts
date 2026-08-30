import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readable } from './readable';

/**
 * Text arriving from a browser, cleaned.
 *
 * The case worth the code is the non-breaking space: it renders as a space, is not one,
 * and silently defeats every word comparison downstream.
 */
describe('readable', () => {
  it('flattens a non-breaking space so words still match', () => {
    assert.equal(readable('data\u00A0classification'), 'data classification');
    assert.equal(readable('data classification'.replace(' ', '\u00A0')).split(' ').length, 2);
  });

  it('drops a glyph the font could not explain', () => {
    // A subset font with no ToUnicode table gives the browser nothing to map back, and
    // it emits U+FFFD. Nothing can recover the character, and it reads as damage.
    assert.equal(readable('Threats \uFFFDand Practices'), 'Threats and Practices');
  });

  it('leaves ordinary text exactly alone', () => {
    assert.equal(readable('Report an Incident/ IT Support'), 'Report an Incident/ IT Support');
    assert.equal(readable('A.8.1 User endpoint devices.'), 'A.8.1 User endpoint devices.');
  });

  it('keeps punctuation an author actually typed', () => {
    // "ISMS -Awareness Session" is what one real deck says, en dash and missing space
    // included. Extraction reported it correctly and this must not tidy it: a cleanup
    // that inserts spaces is guessing at a slide it cannot read.
    assert.equal(readable('ISMS \u2013Awareness Session'), 'ISMS \u2013Awareness Session');
  });

  it('keeps letters that appear in the escapes themselves', () => {
    // A character class written \uAD rather than \u00AD is not a syntax error: the regex
    // quietly matches the letters u, A and D instead, and every word containing one
    // loses it. This was written wrong the first time and caught here.
    assert.equal(readable('Fraud audit BCDEF uUaAdDfF'), 'Fraud audit BCDEF uUaAdDfF');
  });

  it('removes the invisibles that ride along with copied text', () => {
    assert.equal(readable('\uFEFFPolicies\u200B for\u00AD users'), 'Policies for users');
  });

  it('collapses runs of whitespace and trims', () => {
    assert.equal(readable('  Threats   and\tPractices \n'), 'Threats and Practices');
  });

  it('turns a line with nothing readable in it into an empty string', () => {
    // Callers drop these rather than storing a blank line against a slide.
    assert.equal(readable('\uFFFD\uFFFD'), '');
    assert.equal(readable(''), '');
  });

  it('keeps text in scripts that are not Latin', () => {
    // Nothing here is debris, and a cleanup that ate them would gut any deck not
    // written in English.
    const hindi = '\u0938\u0942\u091A\u0928\u093E \u0938\u0941\u0930\u0915\u094D\u0937\u093E';
    const japanese = '\u60C5\u5831\u30BB\u30AD\u30E5\u30EA\u30C6\u30A3';
    assert.equal(readable(hindi), hindi);
    assert.equal(readable(japanese), japanese);
  });

  it('strips control characters rather than storing them', () => {
    assert.equal(readable('Threats\u0000and\u001FPractices'), 'Threats and Practices');
  });
});
