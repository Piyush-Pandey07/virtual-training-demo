import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';

import {
  forgetRememberedSlides,
  openingSlide,
  rememberOpening,
  rememberSlide,
  SETTLE_MS,
  slideRecorder,
  slideToRunFrom,
} from './run-position';

/**
 * The facilitator's run screen reopens on the slide it was on (UAT issue 17), and keeping
 * the record in step costs at most one write for each slide the deck comes to rest on.
 */

describe('the slide the run screen opens on', () => {
  const slides = [1, 2, 3, 4, 5];

  it('is the one the session record keeps', () => {
    assert.equal(slideToRunFrom(slides, 4), 4);
  });

  it('is the first for a session that keeps none, as every session from before does', () => {
    assert.equal(slideToRunFrom(slides, undefined), 1);
    assert.equal(slideToRunFrom(slides, null), 1);
  });

  it('is the first when the deck no longer has the slide kept', () => {
    assert.equal(slideToRunFrom(slides, 9), 1);
    assert.equal(slideToRunFrom([3, 4, 5], 1), 3, 'a deck not numbered from one');
  });
});

/** A clock the test moves by hand, so a test about waiting does not wait. */
function handClock() {
  let now = 0;
  let next = 0;
  const due = new Map<number, { at: number; run: () => void }>();
  return {
    schedule(run: () => void, ms: number) {
      const id = (next += 1);
      due.set(id, { at: now + ms, run });
      return () => {
        due.delete(id);
      };
    },
    pass(ms: number) {
      now += ms;
      for (const [id, entry] of [...due]) {
        if (entry.at <= now) {
          due.delete(id);
          entry.run();
        }
      }
    },
  };
}

function recorder(kept = 1) {
  const clock = handClock();
  const sent: number[] = [];
  const recorder = slideRecorder({
    kept,
    send: (slideId) => sent.push(slideId),
    schedule: clock.schedule,
  });
  return { recorder, clock, sent };
}

describe('keeping the record on the facilitator’s slide', () => {
  it('sends a move once it has settled, and not before', () => {
    const { recorder: slides, clock, sent } = recorder();
    slides.moved(2);
    clock.pass(SETTLE_MS - 1);
    assert.deepEqual(sent, []);
    clock.pass(1);
    assert.deepEqual(sent, [2]);
  });

  it('sends one move for a run of presses, where the run stopped', () => {
    const { recorder: slides, clock, sent } = recorder();
    for (const slideId of [2, 3, 4, 5, 6]) {
      slides.moved(slideId);
      clock.pass(300);
    }
    clock.pass(SETTLE_MS);
    assert.deepEqual(sent, [6]);
  });

  it('sends nothing for a move back to the slide the record holds', () => {
    const { recorder: slides, clock, sent } = recorder(3);
    slides.moved(4);
    clock.pass(500);
    slides.moved(3);
    clock.pass(SETTLE_MS * 2);
    assert.deepEqual(sent, []);
  });

  it('sends each slide the deck rests on once, and not again', () => {
    const { recorder: slides, clock, sent } = recorder();
    slides.moved(2);
    clock.pass(SETTLE_MS);
    slides.moved(2);
    clock.pass(SETTLE_MS);
    slides.moved(3);
    clock.pass(SETTLE_MS);
    assert.deepEqual(sent, [2, 3]);
  });

  it('sends what is waiting at once when the page goes, and nothing twice', () => {
    const { recorder: slides, clock, sent } = recorder();
    slides.moved(7);
    slides.flush();
    assert.deepEqual(sent, [7]);
    clock.pass(SETTLE_MS);
    slides.flush();
    assert.deepEqual(sent, [7], 'the timer called off, and nothing left to send');
  });

  it('sends nothing when the page goes with nothing waiting', () => {
    const { recorder: slides, sent } = recorder();
    slides.flush();
    assert.deepEqual(sent, []);
  });
});

describe('this tab’s own last slide', () => {
  const slides = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const hadWindow = 'window' in globalThis;
  const inBrowser = () => {
    (globalThis as { window?: unknown }).window = globalThis;
  };
  afterEach(() => {
    forgetRememberedSlides();
    if (!hadWindow) delete (globalThis as { window?: unknown }).window;
  });

  it('is where the screen opens after Back, which shows the page as it was first given', () => {
    inBrowser();
    // Opened on 2, moved to 6, left; Back brings the page again with 2.
    rememberOpening('s-room1', 2, 2);
    rememberSlide('s-room1', 6);
    assert.equal(openingSlide('s-room1', 2, slides), 6);
  });

  it('gives way to the record when the page has been asked again and has a different slide', () => {
    // Another device moved the session on to 9 meanwhile: the record wins.
    inBrowser();
    rememberOpening('s-room1', 2, 2);
    rememberSlide('s-room1', 6);
    assert.equal(openingSlide('s-room1', 9, slides), 9);
  });

  it('is kept for each session apart, and is nothing for a session not opened here', () => {
    inBrowser();
    rememberOpening('s-room1', 1, 1);
    rememberSlide('s-room1', 4);
    rememberOpening('s-room2', 1, 1);
    rememberSlide('s-room2', 7);
    assert.equal(openingSlide('s-room1', 1, slides), 4);
    assert.equal(openingSlide('s-room2', 1, slides), 7);
    assert.equal(openingSlide('s-other', 3, slides), 3);
  });

  it('is not used for a slide the deck no longer has', () => {
    inBrowser();
    rememberOpening('s-room1', 1, 1);
    rememberSlide('s-room1', 12);
    assert.equal(openingSlide('s-room1', 1, slides), 1);
  });

  it('is never kept on the server, where every facilitator would share it', () => {
    if (hadWindow) return;
    rememberOpening('s-room1', 1, 1);
    rememberSlide('s-room1', 6);
    assert.equal(openingSlide('s-room1', 1, slides), 1);
  });
});

/**
 * How the run screen and page use it, read from source as the session hook's tests read
 * it: the property is which path does what, not what a render looks like.
 */
describe('the run screen', () => {
  const SCREEN = readFileSync('src/app/sessions/[id]/run/FacilitatorScreen.tsx', 'utf8');
  const PAGE = readFileSync('src/app/sessions/[id]/run/page.tsx', 'utf8');

  it('opens where the record says, not at the deck’s first slide', () => {
    assert.match(
      PAGE,
      /startSlideId=\{slideToRunFrom\(\s*deck\.slides\.map\(\(slide\) => slide\.id\),\s*session\.currentSlideId,\s*\)\}/,
    );
    assert.doesNotMatch(SCREEN, /useState\(deck\.slides\[0\]/);
  });

  it('opens on this tab’s own slide only through openingSlide', () => {
    assert.match(
      SCREEN,
      /useState\(\(\) =>\s*openingSlide\(\s*sessionId,\s*startSlideId,\s*deck\.slides\.map\(\(slide\) => slide\.id\),\s*\),\s*\)/,
    );
    assert.match(SCREEN, /rememberOpening\(sessionId, startSlideId, slideRef\.current\);/);
  });

  it('records a move only from the facilitator moving, and sends it to the slide route', () => {
    const move = SCREEN.slice(SCREEN.indexOf('const move = '));
    assert.match(move.slice(0, 300), /rememberSlide\(sessionId, to\);/);
    assert.match(move.slice(0, 300), /recorderRef\.current\?\.moved\(to\);/);
    assert.match(SCREEN, /\/api\/training-sessions\/\$\{encodeURIComponent\(sessionId\)\}\/slide/);
    assert.match(SCREEN, /method: 'PUT'/);
    assert.match(SCREEN, /keepalive: true/);
  });

  it('sends what is waiting when the page is hidden, closed or left', () => {
    assert.match(SCREEN, /addEventListener\('pagehide', leaving\)/);
    assert.match(SCREEN, /addEventListener\('visibilitychange', hidden\)/);
    assert.match(SCREEN, /return \(\) => \{[\s\S]*?recorder\.flush\(\);/);
  });
});
