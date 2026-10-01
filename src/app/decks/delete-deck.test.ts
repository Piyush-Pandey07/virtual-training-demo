import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * Deleting a deck from the review screen, and the small things the full in-browser
 * check of 1 October turned up.
 *
 * The server could always delete a deck; nothing on screen called it, which came to
 * light when two decks needed removing and there was no way to do it. Deleting cannot
 * be undone, since the original PDF is never kept, so the control is two steps and says
 * what will go before it goes.
 */

const DELETE = readFileSync('src/app/decks/[id]/DeleteDeck.tsx', 'utf8');
const PAGE = readFileSync('src/app/decks/[id]/page.tsx', 'utf8');
const CSS = readFileSync('src/app/globals.css', 'utf8');
const CONTROLS = readFileSync('src/components/SessionControls.tsx', 'utf8');
const HOME = readFileSync('src/app/HomeForAdmin.tsx', 'utf8');

describe('deleting a deck', () => {
  it('asks first, and only the second step deletes', () => {
    // The first button only opens the confirmation. The request lives in remove(),
    // which only the confirming button calls.
    const first = DELETE.slice(DELETE.lastIndexOf('<button'));
    assert.match(first, /onClick=\{\(\) => setConfirming\(true\)\}/);
    assert.doesNotMatch(first, /remove\(/);
    assert.match(DELETE, /onClick=\{\(\) => void remove\(\)\}/);
    assert.equal((DELETE.match(/method: 'DELETE'/g) ?? []).length, 1);
    assert.match(DELETE.slice(DELETE.indexOf('const remove')), /method: 'DELETE'/);
  });

  it('says who will lose it before it goes', () => {
    assert.match(DELETE, /will have it taken off their list/);
    assert.match(DELETE, /This cannot be\s*\n?\s*undone/);
    assert.match(PAGE, /assignedCount=\{assigned\.length\}/);
  });

  it('is not offered for a read-only deck, which the server would refuse', () => {
    const block = PAGE.slice(PAGE.indexOf('<DeleteDeck') - 120, PAGE.indexOf('<DeleteDeck'));
    assert.match(block, /!stored\.readOnly && \(/);
  });

  it('leaves the deck in place and says so when the server could not finish', () => {
    // The server refuses part-way failures with a message; that message is shown, and
    // the screen stays rather than moving on as though it had worked.
    const failure = DELETE.slice(DELETE.indexOf('catch (caught)'));
    assert.match(failure.slice(0, 300), /setError\(/);
    assert.doesNotMatch(failure.slice(0, 300), /router\.push/);
  });
});

describe('polish from the in-browser check', () => {
  it('never lights up a disabled button on hover', () => {
    // Tailwind's own hover applies to disabled buttons too, so a greyed-out Next slide
    // turned teal under the pointer. One redefinition covers every button in the app.
    assert.match(CSS, /@custom-variant hover \{\s*@media \(hover: hover\) \{\s*&:hover:not\(:disabled\) \{\s*@slot;/);
  });

  it('does not invite somebody to speak to a session that has ended', () => {
    const hint = CONTROLS.slice(CONTROLS.indexOf('{ended ? ('));
    assert.match(hint.slice(0, 200), /This session has ended, and your microphone is off\./);
  });

  it('does not call a product sold to other companies internal', () => {
    assert.doesNotMatch(HOME, /internal training platform/i);
  });
});

describe('review thumbnails', () => {
  const REVIEW = readFileSync('src/app/decks/[id]/DeckReview.tsx', 'utf8');

  it('come from the server, which knows whether the deck was uploaded', () => {
    // The screen built an uploaded-asset address for every deck, and the authored
    // example has none, so each of its thumbnails was a broken image.
    assert.match(REVIEW, /src=\{slide\.thumbnail\}/);
    assert.doesNotMatch(REVIEW, /\/assets\/\$\{pageAssetName/);
  });

  it('use the slide image for the authored example and the render for uploads', () => {
    const pick = PAGE.slice(PAGE.indexOf('thumbnail:'));
    assert.match(pick.slice(0, 260), /record\.meta\.origin === 'authored'\s*\?\s*slide\.image/);
    assert.match(pick.slice(0, 260), /pageAssetName\(slide\.id, 'thumb'\)/);
  });
});
