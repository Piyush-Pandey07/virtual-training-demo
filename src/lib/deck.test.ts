import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { clampSlideId, firstSlideId, lastSlideId, toClientView, totalSlides } from './deck';
import { ISMS_DECK } from './decks/isms';

const deck = ISMS_DECK;

describe('deck helpers read the deck rather than assuming it', () => {
  it('reports the slide count from the deck', () => {
    assert.equal(totalSlides(deck), deck.slides.length);
  });

  it("clamps into the deck's own range", () => {
    assert.equal(clampSlideId(deck, -5), 1);
    assert.equal(clampSlideId(deck, 0), 1);
    assert.equal(clampSlideId(deck, 99), totalSlides(deck));
    assert.equal(clampSlideId(deck, Number.NaN), 1);
    assert.equal(clampSlideId(deck, 2.6), 3);
  });

  it('clamps to a deck that does not start at 1', () => {
    // Generated decks have no guarantee of 1-based contiguous ids, and the old
    // implementation hardcoded a lower bound of 1.
    const offset = { ...deck, slides: deck.slides.map((s) => ({ ...s, id: s.id + 100 })) };
    assert.equal(clampSlideId(offset, 0), 101);
    assert.equal(clampSlideId(offset, 999), 100 + totalSlides(deck));
    assert.equal(firstSlideId(offset), 101);
    assert.equal(lastSlideId(offset), 100 + totalSlides(deck));
  });

  it('survives an empty deck without throwing', () => {
    const empty = { ...deck, slides: [] };
    assert.equal(totalSlides(empty), 0);
    assert.equal(clampSlideId(empty, 3), 1);
  });
});

/**
 * The client projection is a confidentiality boundary, not a payload optimisation.
 *
 * Two slides of this deck carry an author note about promoting a third-party
 * platform. It was kept out of the model's context by hand, which was the stated
 * design goal, but the components imported the deck module wholesale so the whole
 * thing shipped in the client bundle and was readable in devtools. These tests are
 * about the browser, not the model.
 */
describe('the client projection', () => {
  const view = toClientView(deck);
  const serialised = JSON.stringify(view);

  it('carries exactly the presentational fields, and no others', () => {
    const allowed = ['id', 'title', 'shortLabel', 'summary', 'image'];
    for (const slide of view.slides) {
      assert.deepEqual(
        Object.keys(slide).sort(),
        [...allowed].sort(),
        'a field was added to the projection; confirm it is safe for a trainee to read',
      );
    }
  });

  it('carries only meta fields a trainee may read', () => {
    // toClientView does `meta: deck.meta` wholesale, so every field on DeckMeta ships
    // to the browser. That is harmless today, because every one of them is speakable
    // copy the trainer says out loud anyway. It stops being harmless the moment
    // anything about ownership, assignment or access lands on DeckMeta, and the slide
    // allow-list above would not have caught it — this is that allow-list's other half.
    const allowed = [
      'id',
      'origin',
      'title',
      'subtitle',
      'spokenSubject',
      'owner',
      'ownerDescription',
      'trainerRole',
      'practitionerCredential',
      'exampleDomain',
      'exampleContext',
      'closingReminder',
      'outlineAnalysedAt',
      'outlinePromptVersion',
    ];
    for (const key of Object.keys(view.meta)) {
      assert.ok(
        allowed.includes(key),
        `DeckMeta.${key} now reaches the browser; confirm a trainee may read it, then add it here`,
      );
    }
  });

  it('contains no author-only note', () => {
    const notes = deck.slides.flatMap((slide) => slide.internalNotes);
    assert.ok(notes.length > 0, 'this fixture no longer exercises the rule');
    for (const note of notes) {
      assert.ok(!serialised.includes(note), `an internal note reached the client view: ${note}`);
    }
    // The canonical case, asserted literally so a refactor cannot lose it.
    assert.ok(!serialised.includes('OutThink'));
  });

  it('contains no presenter note, brief, key point or discussion prompt', () => {
    const trainerOnly = deck.slides.flatMap((slide) => [
      ...slide.speakerNotes,
      ...slide.keyPoints,
      ...slide.discussionPrompts,
      slide.narrationBrief,
    ]);
    for (const text of trainerOnly) {
      assert.ok(!serialised.includes(text), `trainer material reached the client view: ${text}`);
    }
  });

  it('is dramatically smaller than the deck it came from', () => {
    // Not a micro-optimisation: at 60 slides the full deck is a few hundred kB of
    // prose in the bundle, all of it useless to the browser.
    assert.ok(serialised.length * 4 < JSON.stringify(deck).length);
  });

  it('still carries everything the interface actually draws', () => {
    assert.equal(view.slides.length, deck.slides.length);
    assert.equal(view.totalSlides, deck.slides.length);
    assert.ok(view.estimatedMinutes > 0);
    for (const slide of view.slides) {
      assert.ok(slide.title && slide.shortLabel && slide.image && slide.summary);
    }
  });
});

/**
 * The projection only helps if nothing on the client reaches around it.
 *
 * A `server-only` import makes this a build failure too, but this test names the
 * offending file and runs in a second, which is what someone wants when the build
 * error arrives.
 */
describe('the client bundle boundary', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
    });
  }

  const all = sources('src');

  /**
   * Modules that declare themselves server-only, read out of the source rather
   * than listed here.
   *
   * This used to be a list of path prefixes, and it flagged
   * src/lib/decks/asset-paths.ts, which exists so the upload page can build the URL
   * it uploads to without touching storage. A prefix cannot tell a pure string
   * helper apart from the module next to it that reads a filesystem. The marker can,
   * and a list derived from the code cannot go stale as files move.
   */
  const serverOnly = new Set(
    all
      .filter((path) => /^\s*import\s+['"]server-only['"]/m.test(readFileSync(path, 'utf8')))
      .map((path) => path.replace(/\\/g, '/')),
  );

  /** Turns an import specifier into the file it refers to, if it is one of ours. */
  function resolve(fromFile: string, specifier: string): string | null {
    const from = fromFile.replace(/\\/g, '/');

    let base: string;
    if (specifier.startsWith('@/')) {
      base = `src/${specifier.slice(2)}`;
    } else if (specifier.startsWith('.')) {
      const dir = from.slice(0, from.lastIndexOf('/'));
      const parts = `${dir}/${specifier}`.split('/');
      const stack: string[] = [];
      for (const part of parts) {
        if (part === '.' || part === '') continue;
        if (part === '..') stack.pop();
        else stack.push(part);
      }
      base = stack.join('/');
    } else {
      // A package, not one of ours.
      return null;
    }

    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (serverOnly.has(candidate)) return candidate;
    }
    return null;
  }

  it('finds the server-only modules, so a broken check cannot pass silently', () => {
    assert.ok(serverOnly.size >= 4, `only found ${serverOnly.size} server-only modules`);
  });

  it('has no client component importing a server-only module', () => {
    const offenders: string[] = [];

    for (const path of all) {
      const text = readFileSync(path, 'utf8');
      if (!/^\s*['"]use client['"]/m.test(text)) continue;

      for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const hit = resolve(path, match[1]);
        if (hit) offenders.push(`${path} imports ${hit}, which is server-only`);
      }
    }

    assert.deepEqual(offenders, [], offenders.join('; '));
  });

  it('keeps the session hook off the prompt builder', () => {
    // It imported detectAnswerStyle from trainer-prompt.ts, which pulled the whole
    // prompt module, and behind it the entire knowledge base, into the browser to
    // run one regex.
    const hook = readFileSync('src/hooks/useTrainingSession.ts', 'utf8');
    assert.ok(!hook.includes('trainer-prompt'));
    assert.match(hook, /detectAnswerStyle \} from '@\/lib\/intent'/);
  });
});
