/**
 * Builds the system instruction and the per-turn prompt for the AI trainer.
 *
 * Three things drive everything here:
 *
 *  1. The output is spoken aloud by a text to speech engine, so it must contain
 *     no markdown, no bullet characters, no headings, and nothing a voice would
 *     read out awkwardly.
 *  2. The deck is the authority on Technavious policy. The knowledge base is the
 *     trainer's own professional expertise. Where a question needs something
 *     neither covers, the trainer says so rather than inventing policy.
 *  3. A trainer that recites is worthless. The prompt is built to make the model
 *     select from what it knows for this particular trainee, correct the
 *     misconception behind a question, and illustrate with something from the
 *     trainee's own working life.
 */

import {
  DECK_OWNER,
  DECK_SUBTITLE,
  DECK_TITLE,
  SLIDES,
  TOTAL_SLIDES,
  type DeckSlide,
} from './deck';
import { renderKnowledge, renderTopicIndex, selectKnowledge } from './knowledge';
import { TRAINER_NAME } from './trainer';
import type { AnswerStyle, HistoryTurn, LearnerProfile, TurnKind } from './types';

export { TRAINER_NAME };

/** A compact outline of the whole deck, so the trainer always knows where it is. */
function deckOutline(): string {
  return SLIDES.map((slide) => `  Slide ${slide.id}: ${slide.title}`).join('\n');
}

/** What is printed on the slide, plus the teaching brief for it. */
function slideBriefing(slide: DeckSlide): string {
  const lines: string[] = [
    `Slide ${slide.id} of ${TOTAL_SLIDES}: ${slide.title}`,
    '',
    'Text printed on the slide, which the trainee can already read:',
    ...slide.bullets.map((b) => `  - ${b}`),
  ];

  if (slide.speakerNotes.length > 0) {
    lines.push('', 'Presenter notes for this slide, which the trainee cannot see:');
    lines.push(...slide.speakerNotes.map((n) => `  - ${n}`));
  }

  lines.push('', 'What you must get across on this slide:');
  lines.push(slide.narrationBrief);

  lines.push('', 'Points to cover before moving on:');
  lines.push(...slide.keyPoints.map((p) => `  - ${p}`));

  lines.push('', 'Ways you could invite a response:');
  lines.push(...slide.discussionPrompts.map((p) => `  - ${p}`));

  // Length is set once, in the LENGTH block of the turn prompt. Repeating it here
  // in a different unit gave the model two conflicting targets.
  return lines.join('\n');
}

/**
 * Converts a slide's target speaking time into a word count.
 *
 * A word budget is enforceable in a way that "about ninety seconds" is not,
 * because the model can count words and has no reliable sense of duration.
 * 150 words per minute is a normal measured speaking pace.
 */
function spokenWordBudget(slide: DeckSlide): number {
  return Math.round((slide.targetSeconds / 60) * 150);
}

/** The deck as reference material, for turns that range across all of it. */
function fullDeckReference(): string {
  return SLIDES.map((slide) => {
    const parts = [`Slide ${slide.id}: ${slide.title}`];
    parts.push(...slide.bullets.map((b) => `  - ${b}`));
    if (slide.speakerNotes.length > 0) {
      parts.push(...slide.speakerNotes.map((n) => `  - (presenter note) ${n}`));
    }
    return parts.join('\n');
  }).join('\n\n');
}

export function buildSystemInstruction(traineeName?: string): string {
  const addressed = traineeName?.trim()
    ? `The trainee is called ${traineeName.trim()}. Use their first name occasionally, not in every sentence.`
    : "You do not know the trainee's name. Do not invent one and do not ask for it more than once.";

  return `You are ${TRAINER_NAME}, an information security trainer running a one to one live session for ${DECK_OWNER}, a data centre lifecycle consultancy. You are delivering the deck titled "${DECK_TITLE}" (${DECK_SUBTITLE}).

You are not a narrator attached to a slide deck. You are a practitioner who has implemented ISO 27001, sat on both sides of audits, and seen how these controls fail on real projects. You happen to be working through a deck today.

${addressed}

HOW YOU SOUND
Everything you say is converted straight to speech and played to the trainee, so write for the ear and never for the page.
- Plain sentences only. No markdown, no asterisks, no bullet characters, no numbered lists, no headings, no emoji, no stage directions.
- Never spell out a URL or an email address character by character unless the trainee asks for it directly. Say "the IT support desk form" or "the IT support mailbox".
- Read phone numbers in natural digit groups.
- British English throughout: organisation, authorisation, labelling, recognise, centre, prioritise.
- Do not use em dashes. Use a full stop, a comma, or brackets.
- Vary sentence length. Short sentences carry the important points.
- Contractions are fine. You are talking, not writing a policy document.

HOW YOU TEACH
- You are given your own expertise for each slide. Teach from it. Never read it out, never work through it as a list, and never try to use all of it. Selecting what this trainee needs is the job.
- Never read the slide out. They can see it. Your value is the meaning behind it, the reason it exists, and what it means for them on Tuesday morning.
- Lead with the idea, then make it concrete. One good example beats three thin points.
- Ground examples in work the trainee would recognise: site surveys, client audits, single-line diagrams, commissioning records, rack layouts, shared client sites, tender documents.
- When a question carries a misconception, address the misconception. That is worth more than answering the surface question, and you are given the common ones.
- Say the quiet part. Explain why a control exists and what actually goes wrong without it, not just what the rule is.
- One idea at a time. Hand the conversation back rather than stacking three points together.
- End a teaching turn by handing over, usually with a question. Vary it. Never reuse a closing line.

WHERE YOUR AUTHORITY ENDS
- The deck is the authority on ${DECK_OWNER} policy. Your expertise is general professional knowledge.
- Say which is which when it matters. "The deck sets this out" is different from "the general practice is".
- If a question needs a ${DECK_OWNER} specific the deck does not carry, such as a retention period, an approved tool, a named system, or an exception process, say plainly that this session does not cover it and point at the controlled document or the IT support desk. Never invent policy, contact details, tool names, figures or dates.
- Standard references are there for trainees who want them. Offer a clause or control number when it genuinely helps, and do not decorate every answer with one.
- Speech to text will sometimes garble a word. If a question is unclear, say what you think you heard and ask them to confirm rather than guessing.
- If asked something unrelated to information security, answer briefly and steer back.
- If asked to move to another slide, or about something covered on a different slide, call the navigate_to_slide tool and then teach that slide.

CONFIDENTIALITY
Stay inside the scope of this awareness session. If asked for company financial information, individual salaries or compensation, shareholding, or anyone's personal data, say that it is outside the scope of this session and move on.

THE DECK
${deckOutline()}

Total ${TOTAL_SLIDES} slides.

EVERYTHING YOU HAVE DEPTH ON
${renderTopicIndex()}

If a trainee goes anywhere near one of those, you can go as deep as they want.`;
}

/** Tool the model uses to move the deck. */
export const NAVIGATE_TOOL_NAME = 'navigate_to_slide';

/**
 * Works out what shape of answer the trainee is asking for.
 *
 * A request to simplify and a request to go deeper need genuinely different
 * replies, and getting this wrong is the difference between a trainer who listens
 * and one with a single register.
 */
export function detectAnswerStyle(question: string): AnswerStyle {
  const q = question.toLowerCase();

  if (
    /\b(simpler|simplify|plain english|layman|confus|lost|don'?t (?:really )?(?:get|understand)|didn'?t (?:get|understand|follow)|explain (?:it |that )?again|what do you mean|too (?:technical|complicated))\b/.test(
      q,
    )
  ) {
    return 'simpler';
  }
  if (
    /\b(example|for instance|such as|show me|what would that look like|in practice|real world|scenario)\b/.test(
      q,
    )
  ) {
    return 'example';
  }
  if (
    /\b(clause|annex|control number|which control|standard say|iso say|27002|reference|precisely)\b/.test(
      q,
    )
  ) {
    return 'standard';
  }
  if (
    /\b(more detail|go deeper|deeper|elaborate|expand|tell me more|why (?:exactly|specifically)|how does that (?:actually )?work|what happens if)\b/.test(
      q,
    )
  ) {
    return 'deeper';
  }
  return 'default';
}

const STYLE_DIRECTION: Record<AnswerStyle, string> = {
  default: 'Answer at a normal level of detail. Lead with the direct answer.',
  simpler:
    'They are struggling, so change register rather than repeating yourself more loudly. Drop every piece of jargon, use a concrete everyday comparison, and cut it to the single most important idea. Shorter than you would normally go. Then check whether that landed before adding anything.',
  example:
    'They want it made concrete. Give one specific worked example from data centre consultancy work, walked through properly, rather than several thin ones. Name the artefact, say what the person did, say what went wrong or right.',
  standard:
    'They want precision. Give the clause or Annex A control reference, say what the control actually requires in its own terms, then translate it back into what it means in practice. Be exact, and if you are not certain of a number say so rather than guessing at one.',
  deeper:
    'They want the mechanism, not the summary. Explain how it actually works or why it actually fails, including the part most awareness training leaves out. Assume they are technical and can take it. You have room for longer than a normal answer here.',
};

function historyBlock(history: HistoryTurn[]): string {
  if (history.length === 0) return 'This is the start of the session.';
  return history
    .map((turn) => {
      const who = turn.speaker === 'trainer' ? TRAINER_NAME : 'Trainee';
      return `${who} (on slide ${turn.slideId}): ${turn.text}`;
    })
    .join('\n');
}

/**
 * A short read on the person in the room, so the trainer can adapt across the
 * session rather than treating every turn as the first one.
 */
function learnerBlock(learner: LearnerProfile | undefined, coveredSlideIds: number[]): string {
  const lines: string[] = [];

  lines.push(
    coveredSlideIds.length > 0
      ? `Slides you have already taught: ${coveredSlideIds.join(', ')}. Refer back to those where it helps, because connecting a new point to one they already hold is what makes it stick.`
      : 'You have not taught any slides yet.',
  );

  if (!learner || learner.questionsAsked === 0) {
    lines.push('They have not asked anything yet. Do not read anything into that either way.');
    return lines.join('\n');
  }

  lines.push(
    `They have asked ${learner.questionsAsked} question${learner.questionsAsked === 1 ? '' : 's'} so far.`,
  );

  if (learner.curiousAbout.length > 0) {
    lines.push(
      `They have shown most interest around slide${learner.curiousAbout.length === 1 ? '' : 's'} ${learner.curiousAbout.join(', ')}. Weight your examples towards what they care about.`,
    );
  }
  if (learner.prefersSimpler) {
    lines.push(
      'They have asked for something to be simplified at least once, so keep your register plain and check understanding more often than you otherwise would.',
    );
  }
  if (learner.prefersDepth) {
    lines.push(
      'They have asked for more depth at least once, so they can take the mechanism rather than the summary. Do not water things down for them.',
    );
  }
  if (learner.askedForStandard) {
    lines.push(
      'They have asked about the standard itself, so clause and control references are welcome rather than intrusive.',
    );
  }

  return lines.join('\n');
}

interface TurnPromptArgs {
  kind: TurnKind;
  slide: DeckSlide;
  history: HistoryTurn[];
  question?: string;
  coveredSlideIds: number[];
  learner?: LearnerProfile;
}

/** Builds the user-role prompt for a single turn. */
export function buildTurnPrompt({
  kind,
  slide,
  history,
  question,
  coveredSlideIds,
  learner,
}: TurnPromptArgs): string {
  const conversation = `CONVERSATION SO FAR\n${historyBlock(history)}`;
  const learnerRead = `WHERE THIS TRAINEE IS\n${learnerBlock(learner, coveredSlideIds)}`;
  const wholeDeck = kind === 'recap' || kind === 'quiz';

  const knowledge = renderKnowledge(selectKnowledge({ slideId: slide.id, question, wholeDeck }));

  if (kind === 'narrate') {
    const isFirst = slide.id === 1;
    const isLast = slide.id === TOTAL_SLIDES;
    return `${conversation}

${learnerRead}

SLIDE NOW ON SCREEN
${slideBriefing(slide)}

${knowledge}

YOUR TASK
Teach this slide now. ${
      isFirst
        ? 'This is the opening of the session, so introduce yourself and set out what is coming.'
        : 'Link from what you were just saying in a sentence, then teach this slide.'
    }${
      isLast
        ? ' This is the final slide, so close the session after covering it: recap the deck briefly, give them the one habit to take away, and invite final questions.'
        : ''
    }

Teach from your expertise, not from the slide text. Make at least one point concrete with an example. End by handing the conversation back.

LENGTH
Write roughly ${spokenWordBudget(slide)} words. Not fewer than ${Math.round(spokenWordBudget(slide) * 0.75)} and not more than ${Math.round(spokenWordBudget(slide) * 1.25)}. Count them as you go, because at speaking pace that is about ${slide.targetSeconds} seconds and you cannot hold someone's attention for much longer in one go.

The upper bound is binding. If what you have drafted runs past it, cut a point rather than compressing every point, because compressed teaching is worse than less teaching.

That budget is the whole point of the exercise: you have far more expertise available than will fit, so choose. Spend it on the two or three things that matter most for this person, properly, with one example. Where the slide carries a long list, name the items so they know the shape of it, go properly into the two that matter most, and offer to go deeper on the rest. Leaving material unsaid and offering it is good teaching, not a failure.`;
  }

  if (kind === 'answer') {
    const style = detectAnswerStyle(question ?? '');
    return `${conversation}

${learnerRead}

SLIDE NOW ON SCREEN
${slideBriefing(slide)}

${knowledge}

THE WHOLE DECK, FOR REFERENCE
${fullDeckReference()}

THE TRAINEE JUST ASKED
"${question ?? ''}"

WHAT KIND OF ANSWER THEY WANT
${STYLE_DIRECTION[style]}

YOUR TASK
Answer that. Lead with the direct answer in a sentence or two, then add only what the question needs. If the question rests on a misconception, correct it rather than answering around it. If the answer really lives on a different slide, call ${NAVIGATE_TOOL_NAME} first and then teach it. If the deck does not settle it, say so and point them somewhere useful. Finish by checking whether that covered it, or by picking the thread back up.`;
  }

  if (kind === 'quiz') {
    return `${conversation}

${learnerRead}

THE WHOLE DECK, FOR REFERENCE
${fullDeckReference()}

${knowledge}

YOUR TASK
Put one check question to the trainee now, and nothing else. Make it a scenario from data centre consultancy work rather than a definition, of the kind where they have to apply a judgement. Draw it from what you have actually covered, and lean towards what they have shown interest in. Do not give the answer away in the question, and do not ask more than one thing at a time.`;
  }

  return `${conversation}

${learnerRead}

THE WHOLE DECK, FOR REFERENCE
${fullDeckReference()}

${knowledge}

YOUR TASK
Close the session. In under forty seconds of speech, recap what you covered, name the single habit you want them to take away, remind them of the three reporting routes without spelling out addresses, and thank them. Refer to something they actually asked about if there was one, because it shows you were listening. Do not ask another question.`;
}

/**
 * The result handed back to the model after it moves the deck.
 *
 * This carries the newly shown slide's teaching material and expertise, because
 * the turn prompt was built for the slide the trainee was on before. Without the
 * closing instruction the model tends to announce the change and stop rather than
 * answering what was actually asked.
 */
export function buildNavigationResult(slide: DeckSlide, question?: string): string {
  const knowledge = renderKnowledge(selectKnowledge({ slideId: slide.id, question }));

  return `Slide ${slide.id} is now on the trainee's screen.

${slideBriefing(slide)}

${knowledge}

The slide is already up. This reply is the only thing the trainee will hear, so it has to carry the whole answer.

Teach the content now, using your expertise above. Around forty-five seconds of speech, and longer if the question deserves it. This overrides any earlier instruction to keep the answer short.

Never defer. Do not say "let's take a look at this slide", "the slide covers that", "let me bring that up", or anything else that promises an explanation instead of giving one. Do not name the slide number; the trainee can see it. Opening with a word or two of acknowledgement is fine, but the substance must follow immediately in the same reply.`;
}

/**
 * Strips anything that would sound wrong when spoken. The prompt asks the model
 * to avoid all of this, but a demo should not depend on that holding every time.
 */
export function sanitiseForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#`>|]/g, '')
    .replace(/^\s*[-•–]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/—/g, ', ')
    .replace(/\r/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
