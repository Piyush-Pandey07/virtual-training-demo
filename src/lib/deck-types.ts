/**
 * What a deck is.
 *
 * The app used to have one deck compiled into it, so "the deck" was a module and
 * every part of the engine reached for it directly. A trainer uploading their own
 * deck makes that impossible: the deck becomes a value that arrives at runtime and
 * has to be passed to the code that uses it.
 *
 * There are deliberately two shapes here. `DeckRecord` is the whole deck and stays
 * on the server. `DeckClientView` is the narrow projection that crosses to the
 * browser, and it exists because the alternative was shipping the entire deck,
 * presenter notes and author-only notes included, in the client bundle. That was
 * not hypothetical: `SlideStage` imported the deck wholesale, so both of the ISMS
 * author notes about promoting a third-party platform were sitting in
 * .next/static/chunks and readable in devtools. The model never saw them, which
 * was the thing the design set out to guarantee, but the trainee's browser did.
 *
 * Types only, no data and no logic, so both sides can import this file freely.
 */

import type { KnowledgeTopic } from './knowledge/types';

/**
 * What a page is doing in the deck.
 *
 * Lives here rather than with the analysis code because a slide carries it and
 * the review screen shows it, and both of those reach the browser.
 */
export type SlideRole =
  /** An opening cover page. Teaches nothing on its own. */
  | 'title'
  /** Ordinary teaching material. */
  | 'content'
  /** A section marker. Worth a sentence, not a lesson. */
  | 'divider'
  /** A final recap or thank-you page. */
  | 'closing';

/** One slide, in full. Server-side only: several fields must not reach a browser. */
export interface DeckSlide {
  /** 1-based slide number, matching the source deck. */
  id: number;
  /** Title as printed on the slide. */
  title: string;
  /** Short label for the slide rail and progress indicator. */
  shortLabel: string;
  /** One-line description of the slide, for the session outline on the landing page. */
  summary: string;
  /** Path to the exported slide image under /public, or an app asset route. */
  image: string;
  /**
   * Pixel size of the render, when it is known.
   *
   * Optional because the hand-authored deck predates it. It exists because the
   * slide stage assumed 16:9, which is true of a PowerPoint export and false of
   * the A4 PDFs people actually have: without this an uploaded A4 deck is either
   * letterboxed or stretched.
   */
  width?: number;
  height?: number;
  /** Text printed on the slide, in reading order. */
  bullets: string[];
  /** Presenter notes that are real teaching content. */
  speakerNotes: string[];
  /** Author-only notes. Excluded from the model context on purpose. */
  internalNotes: string[];
  /** What the trainer must get across on this slide. */
  narrationBrief: string;
  /** Points the trainer should not leave the slide without covering. */
  keyPoints: string[];
  /** Openers the trainer can use to draw the trainee into conversation. */
  discussionPrompts: string[];
  /** Rough spoken length target in seconds. Drives pacing, not a hard cut-off. */
  targetSeconds: number;
  /**
   * Whether this slide teaches anything.
   *
   * A title card does not, and a question should never move the deck onto one. This
   * replaces a hardcoded `new Set([1])` in the navigation code, which was true of
   * this deck and of no other. Derived from `role` once a deck has been analysed.
   */
  teaches: boolean;
  /**
   * What this page is doing in the deck.
   *
   * Optional because the hand-authored deck predates it and because a freshly
   * uploaded deck has not been analysed yet.
   */
  role?: SlideRole;
  /**
   * The line the page set in the largest type, as measured when it was rendered.
   *
   * Written once, at upload, and never changed. It is the only evidence of what a
   * page looked like: everything downstream sees extracted text, where a heading
   * and a code snippet are indistinguishable. Keeping it separate from `title`
   * also means re-analysing a deck reads the original page rather than the
   * previous answer fed back in.
   */
  printedTitle?: string;
}

/**
 * Everything about a deck that is not a slide or a topic.
 *
 * These read like a lot of small strings, and they are, but every one of them was
 * a literal spliced into the trainer's prompt. "a data centre lifecycle
 * consultancy" and "sat on both sides of audits" are true of this deck's audience
 * and absurd for a deck about fire safety, so they have to travel with the deck
 * rather than with the engine.
 */
/**
 * Where a deck's content came from.
 *
 * `authored` means a person wrote it and its claims have been checked. `uploaded`
 * means it was read out of a file and most of it is generated. The difference
 * decides whether the analysis passes are allowed to rewrite it: on an uploaded
 * deck that is the whole point, and on an authored one it is a downgrade.
 */
export type DeckOrigin = 'authored' | 'uploaded';

export interface DeckMeta {
  /** Stable identifier, used as the storage prefix. */
  id: string;
  /**
   * Where this deck's content came from.
   *
   * Optional for decks stored before it existed. Treated as `uploaded` when absent,
   * which is the permissive reading: a deck nobody marked as authored is one
   * analysis may improve.
   */
  origin?: DeckOrigin;
  /** Deck title, as shown and as spoken. */
  title: string;
  /** Formal subtitle, for the page. */
  subtitle: string;
  /**
   * How the subject is said out loud.
   *
   * The written subtitle is not speakable: "ISO/IEC" comes out of the speech
   * engine as "ISO IEC", which is not what a trainer says.
   */
  spokenSubject: string;
  /** Whose deck this is. The authority on policy, in the trainer's words. */
  owner: string;
  /** What the owner does, for the one clause that introduces them. */
  ownerDescription: string;
  /** What kind of trainer is delivering this. */
  trainerRole: string;
  /** Why the trainer is credible on this subject, in their own voice. */
  practitionerCredential: string;
  /** Artefacts a trainee would recognise, so examples land in their working life. */
  exampleDomain: string;
  /** Short form of the same, for "an example from ___ work". */
  exampleContext: string;
  /** The one thing the closing turn must remind them of. */
  closingReminder: string;
  /**
   * When the outline pass last ran, and against which prompt.
   *
   * Absent on a deck that has only been rendered. The version is recorded so a
   * later change to the prompts can offer a re-analysis where it would actually
   * change the answer, rather than re-reading every deck on every deploy.
   */
  outlineAnalysedAt?: string;
  outlinePromptVersion?: number;
}

/** A whole deck. Never send one of these to a browser. */
export interface DeckRecord {
  meta: DeckMeta;
  slides: DeckSlide[];
  topics: KnowledgeTopic[];
}

/**
 * A slide as the browser sees it: what is drawn on screen and nothing else.
 *
 * Everything absent from this type is absent on purpose. Notes, briefs, key
 * points and target lengths are the trainer's material, and the trainee is the one
 * person who must not read them.
 */
export interface ClientSlide {
  id: number;
  title: string;
  shortLabel: string;
  /** Shown in the session outline, which is public-facing copy. */
  summary: string;
  image: string;
  /** So the stage can size itself to the real page rather than assuming 16:9. */
  width?: number;
  height?: number;
}

/** A deck as the browser sees it. */
export interface DeckClientView {
  meta: DeckMeta;
  slides: ClientSlide[];
  totalSlides: number;
  /** Estimated narration time, precomputed so targetSeconds need not be sent. */
  estimatedMinutes: number;
}
