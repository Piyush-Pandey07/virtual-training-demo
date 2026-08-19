/**
 * The trainer's knowledge base.
 *
 * The deck (src/lib/deck.ts) is what is on screen and is the authority on
 * Technavious policy. This is different: it is the domain expertise a
 * practitioner brings to the room. Standard references, how an attack actually
 * works, worked examples from data centre consultancy, the misconceptions people
 * arrive with, and the questions they always ask.
 *
 * Nothing here invents Technavious policy. Where a topic touches something only
 * Technavious can answer, it says so and points at the controlled document, so
 * the trainer stays honest about the boundary.
 */

/** How much a topic should be leaned on for a given turn. */
export type TopicWeight = 'core' | 'supporting';

export interface Misconception {
  /** What trainees often believe. */
  belief: string;
  /** What an expert says instead. Written to be spoken. */
  correction: string;
}

export interface Faq {
  /** A question trainees genuinely ask, in their own words. */
  q: string;
  /** The expert answer, written to be spoken aloud. */
  a: string;
}

export interface KnowledgeTopic {
  id: string;
  /** Short label used in the assembled prompt. */
  title: string;
  /** Slides this topic supports. Drives what is loaded for a narration turn. */
  slideIds: number[];
  /**
   * Words and phrases that should pull this topic in when a question is asked,
   * regardless of which slide is on screen. Matched case-insensitively against
   * the question.
   */
  triggers: string[];
  /** The substance. One idea per entry, written to be spoken. */
  explanation: string[];
  /** Concrete illustrations, ideally from data centre consultancy work. */
  examples?: string[];
  /** ISO/IEC 27001:2022 references, for trainees who want the clause. */
  standardRefs?: string[];
  /** An analogy that makes an abstract point land. */
  analogy?: string;
  misconceptions?: Misconception[];
  faqs?: Faq[];
  /**
   * Anything the deck does not settle and the trainer must not guess at. The
   * trainer names the gap and points somewhere useful instead.
   */
  outOfScope?: string[];
}

/** A topic selected for one turn, with how heavily to use it. */
export interface SelectedTopic {
  topic: KnowledgeTopic;
  weight: TopicWeight;
  /** Why it was pulled in. Useful when debugging retrieval. */
  reason: string;
}
