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
  /** Path to the exported slide image under /public, or a storage URL. */
  image: string;
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
   * A title card or a section divider does not, and a question should never move
   * the deck onto one. This replaces a hardcoded `new Set([1])` in the navigation
   * code, which was true of this deck and of no other.
   */
  teaches: boolean;
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
export interface DeckMeta {
  /** Stable identifier, used as the storage prefix. */
  id: string;
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
}

/** A deck as the browser sees it. */
export interface DeckClientView {
  meta: DeckMeta;
  slides: ClientSlide[];
  totalSlides: number;
  /** Estimated narration time, precomputed so targetSeconds need not be sent. */
  estimatedMinutes: number;
}
