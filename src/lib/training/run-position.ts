/**
 * Where the facilitator's run screen opens, and keeping the session record in step with
 * the slide it is on (UAT issue 17).
 *
 * The run screen used to open at slide 1 every time: on a reload, on coming back from the
 * attendance page, and on another device. The record now keeps the slide, and the run page
 * opens there.
 *
 * Client-safe and free of imports, so the run page on the server and the run screen in the
 * browser follow the same rule, and the tests need neither.
 */

/**
 * How long the deck must rest on a slide before the move is sent.
 *
 * Long enough that pressing Next through a few slides to reach the one wanted is a single
 * write, on the free Firestore plan, and short enough that a reload straight after talking
 * through a slide finds it. A page that is going sends what is waiting at once instead.
 */
export const SETTLE_MS = 2000;

/**
 * The slide the run screen opens on: the one the record keeps, while it is still a slide
 * of this deck, and otherwise the first. A session from before the slide was kept, one
 * nobody has moved through, or one whose deck has since lost that slide, starts at the
 * beginning, as every session used to.
 */
export function slideToRunFrom(
  slideIds: readonly number[],
  kept: number | null | undefined,
): number {
  if (typeof kept === 'number' && slideIds.includes(kept)) return kept;
  return slideIds[0] ?? 1;
}

/**
 * What each session's run screen did in this tab: the slide the page gave it to open on,
 * and the slide it was last on.
 *
 * The record is what a reload and another device read. This covers the browser's Back
 * button, which brings the run page back as it was first drawn, with the slide it was
 * first given, rather than asking the server again. Written only from the browser, so
 * never on the server, where a module's memory would be shared by everybody.
 */
const inThisTab = new Map<string, { openedWith: number; last: number }>();

/**
 * The slide the run screen opens on in this tab.
 *
 * The page's, unless this tab has been here before and the page has given the same slide
 * it gave then: that is the Back button showing the page as it was, and the tab's own last
 * slide is the one the facilitator was on. A page with a different slide has been asked
 * again, and has the record, which another device may have moved since, so it wins.
 */
export function openingSlide(
  sessionId: string,
  given: number,
  slideIds: readonly number[],
): number {
  const here = typeof window === 'undefined' ? undefined : inThisTab.get(sessionId);
  if (here && here.openedWith === given && slideIds.includes(here.last)) return here.last;
  return given;
}

/** The run screen has opened on `slideId`, from the page's `given`. */
export function rememberOpening(sessionId: string, given: number, slideId: number): void {
  if (typeof window === 'undefined') return;
  inThisTab.set(sessionId, { openedWith: given, last: slideId });
}

/** The facilitator has moved to `slideId`. */
export function rememberSlide(sessionId: string, slideId: number): void {
  const here = typeof window === 'undefined' ? undefined : inThisTab.get(sessionId);
  if (here) here.last = slideId;
}

/** For the tests, which run without a window. */
export function forgetRememberedSlides(): void {
  inThisTab.clear();
}

export interface SlideRecorder {
  /** The facilitator is now on this slide. Sent once it has settled, if the record needs it. */
  moved(slideId: number): void;
  /** Sends a move still waiting to settle, now. For a page that is going. */
  flush(): void;
}

export interface SlideRecorderOptions {
  /** The slide the record holds, as far as this screen knows. Sending it again is a waste. */
  kept: number;
  /** Sends one move. Best effort: whatever it does with a failure, the session carries on. */
  send: (slideId: number) => void;
  settleMs?: number;
  /** Runs `run` after `ms`, and returns a way to call it off. A timer, unless a test gives one. */
  schedule?: (run: () => void, ms: number) => () => void;
}

const timer = (run: () => void, ms: number) => {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
};

/**
 * Sends the facilitator's moves to the session record, at most one for each slide the deck
 * comes to rest on.
 *
 * Every move restarts the wait, so a run of presses sends only where it stopped, and a
 * move back to the slide the record already holds sends nothing at all.
 */
export function slideRecorder(options: SlideRecorderOptions): SlideRecorder {
  const { send, settleMs = SETTLE_MS, schedule = timer } = options;
  let kept = options.kept;
  let waiting: number | null = null;
  let callOff: (() => void) | null = null;

  const flush = () => {
    callOff?.();
    callOff = null;
    if (waiting === null) return;
    const slideId = waiting;
    waiting = null;
    if (slideId === kept) return;
    kept = slideId;
    send(slideId);
  };

  return {
    moved(slideId) {
      callOff?.();
      callOff = null;
      if (slideId === kept) {
        waiting = null;
        return;
      }
      waiting = slideId;
      callOff = schedule(flush, settleMs);
    },
    flush,
  };
}
