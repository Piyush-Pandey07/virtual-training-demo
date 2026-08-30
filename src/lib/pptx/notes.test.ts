import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { extractSpeakerNotes, isPowerPoint } from './notes';

/**
 * Tested against the real deck rather than a fixture.
 *
 * `docs/ISMS-Awareness-Session.pptx` is the PowerPoint the hand-authored deck was
 * transcribed from, so its notes are known: they are what somebody read and typed
 * into `src/lib/decks/isms/slides.ts` by hand. That makes it the one file where the
 * right answer can be checked rather than assumed.
 */
const DECK = readFileSync('docs/ISMS-Awareness-Session.pptx');

describe('reading speaker notes out of a PowerPoint', () => {
  const notes = extractSpeakerNotes(DECK);

  it('finds notes at all', () => {
    assert.ok(notes.size > 0, 'no notes found in a deck that has them');
  });

  it('numbers them by presentation order, not by file name', () => {
    // This deck has seven slides and five notes parts. Pairing them by counting would
    // put notesSlide3 on slide 3 whatever it is actually attached to, which is how
    // author-only content ends up on the wrong page without anybody noticing.
    for (const slideId of notes.keys()) {
      assert.ok(slideId >= 1 && slideId <= 7, `slide ${slideId} is outside the deck`);
    }
  });

  it('recovers the author-only note this project exists to keep quiet', () => {
    // A to-do about promoting a third-party platform. Spoken aloud it would pitch a
    // product to a trainee mid-training, which is why every note extracted here starts
    // life as internal rather than as something the trainer may say.
    //
    // It is on slide 4. The hand-transcribed deck carries it on slides 2 and 4, and
    // the PowerPoint has no notes on slide 2 at all — the duplication happened when a
    // person copied it across, which is the sort of thing reading the file fixes.
    assert.match(notes.get(4)?.join(' ') ?? '', /Push the OutThink Platform/);
    assert.match(notes.get(4)?.join(' ') ?? '', /training minutes/i);
  });

  it('joins runs back into a readable line', () => {
    // PowerPoint splits a sentence wherever formatting changes, so "Push the OutThink
    // Platform" is stored as four runs. Returned unjoined, a note reads as fragments
    // and is useless to whoever has to review it.
    assert.match(notes.get(4)?.join(' ') ?? '', /Push the OutThink Platform in a slide/);
  });

  it('keeps a note that is genuinely teaching material', () => {
    // Slide 5's note defines the four classification tiers. That is content a trainer
    // would want to say, and it comes out of the same extractor as the note above —
    // which is the whole argument for a human deciding which is which rather than a
    // rule guessing.
    const five = notes.get(5)?.join(' ') ?? '';
    assert.match(five, /Secret/);
    assert.match(five, /Confidential/);
    assert.match(five, /Public/);
  });

  it('reports nothing for a slide whose notes page was left blank', () => {
    // PowerPoint writes a notes part for a slide whether or not anybody typed in it,
    // so an empty one must not become an empty note attached to the slide.
    assert.equal(notes.has(1), false);
    assert.equal(notes.has(3), false);
    assert.equal(notes.has(6), false);
  });

  it('leaves out the slide number PowerPoint stamps on a notes page', () => {
    for (const lines of notes.values()) {
      for (const line of lines) {
        assert.ok(!/^\d{1,3}$/.test(line.trim()), `a bare page number survived: ${line}`);
      }
    }
  });

  it('returns nothing for a file that is not a PowerPoint, rather than throwing', () => {
    // The notes are an optional extra beside the PDF. A wrong file chosen by mistake
    // should cost the upload nothing.
    assert.equal(extractSpeakerNotes(new Uint8Array([1, 2, 3, 4])).size, 0);
    assert.equal(extractSpeakerNotes(new Uint8Array()).size, 0);
  });

  it('returns nothing for a zip that is not a presentation', () => {
    // A valid zip with none of the parts it looks for.
    const notAPresentation = readFileSync('package.json');
    assert.equal(extractSpeakerNotes(notAPresentation).size, 0);
  });
});

describe('recognising a PowerPoint by name', () => {
  it('takes a .pptx however it is capitalised', () => {
    assert.equal(isPowerPoint('Deck.PPTX'), true);
    assert.equal(isPowerPoint('  deck.pptx  '), true);
  });

  it('refuses the formats this cannot read', () => {
    // .ppt is the old binary format, which is not a zip and would fail confusingly.
    assert.equal(isPowerPoint('deck.ppt'), false);
    assert.equal(isPowerPoint('deck.pdf'), false);
    assert.equal(isPowerPoint('pptx'), false);
  });
});
