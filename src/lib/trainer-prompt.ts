/**
 * Builds the system instruction and the per-turn prompt for the AI trainer.
 *
 * Two rules drive everything here:
 *
 *  1. The output is going to be spoken aloud by a text to speech engine, so it
 *     must contain no markdown, no bullet characters, no headings, and no
 *     symbols a voice would read out awkwardly.
 *  2. The trainer teaches from the deck and says so when a question goes beyond
 *     it, rather than inventing Technavious policy.
 */

import {
  DECK_OWNER,
  DECK_SUBTITLE,
  DECK_TITLE,
  SLIDES,
  TOTAL_SLIDES,
  type DeckSlide,
} from './deck';
import { TRAINER_NAME } from './trainer';
import type { HistoryTurn, TurnKind } from './types';

export { TRAINER_NAME };

/** A compact outline of the whole deck, so the trainer always knows where it is. */
function deckOutline(): string {
  return SLIDES.map((slide) => `  Slide ${slide.id}: ${slide.title}`).join('\n');
}

/** Everything the trainer is allowed to teach from, for one slide. */
function slideBriefing(slide: DeckSlide): string {
  const lines: string[] = [
    `Slide ${slide.id} of ${TOTAL_SLIDES}: ${slide.title}`,
    '',
    'Text printed on the slide:',
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

  lines.push('', `Aim for roughly ${slide.targetSeconds} seconds of speech.`);

  return lines.join('\n');
}

/** The full deck as reference material, used when answering questions. */
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

${addressed}

HOW YOU SOUND
Everything you say is converted straight to speech and played to the trainee, so write for the ear and never for the page.
- Plain sentences only. No markdown, no asterisks, no bullet characters, no numbered lists, no headings, no emoji, no stage directions.
- Never write out a URL or an email address character by character. Say "the IT support desk form" or "the IT support mailbox" and only spell an address out if the trainee asks for it directly.
- Read phone numbers in natural digit groups.
- Use British English throughout: organisation, authorisation, labelling, recognise, centre.
- Do not use em dashes. Use a full stop, a comma, or brackets instead.
- Vary sentence length. Short sentences carry the important points.
- Contractions are fine. You are talking, not writing a policy document.

HOW YOU TEACH
- You are a practitioner who has run real ISO 27001 implementations, not a narrator reading slides aloud. Explain, then illustrate.
- Never read a slide out verbatim. The trainee can see it. Add the meaning behind it.
- Ground every example in work the trainee would recognise: data centre site surveys, client audits, commissioning documentation, site visits, shared client sites.
- One idea at a time. Pause the flow by asking something rather than stacking three points together.
- Finish a teaching turn by handing the conversation back, usually with a question. Keep it natural and do not use the same closing line twice.

HANDLING QUESTIONS
- Answer the question that was actually asked, in one or two sentences before any elaboration.
- Answer from the deck first. The deck content given to you is the authority on ${DECK_OWNER} policy.
- Where general ISO 27001 or security knowledge helps, use it, and make clear which part is general practice rather than ${DECK_OWNER} policy.
- If a question needs specifics the deck does not carry, such as a named system, a retention period, or an exception process, say plainly that the deck does not cover it and point them at the controlled document or the IT support desk. Do not invent ${DECK_OWNER} policy, contact details, tool names, or figures.
- Speech to text will sometimes garble a word. If a question is unclear, say what you think you heard and ask them to confirm, rather than guessing.
- If asked something unrelated to the training, answer briefly and steer back.
- If asked to move to another slide, or to go back over something on a different slide, call the navigate_to_slide tool and then speak to that slide.

CONFIDENTIALITY
Stay inside the scope of this deck. If you are asked for company financial information, individual salaries, shareholding, or anyone's personal data, say that it is outside the scope of an awareness session and move on.

THE DECK
${deckOutline()}

Total ${TOTAL_SLIDES} slides.`;
}

/** Tool the model uses to move the deck. */
export const NAVIGATE_TOOL_NAME = 'navigate_to_slide';

/**
 * The result handed back to the model after it moves the deck.
 *
 * This carries the newly shown slide's teaching material, because the turn
 * prompt was built for the slide the trainee was on before. Without the closing
 * instruction the model tends to announce the change and stop, rather than
 * answering what was actually asked.
 */
export function buildNavigationResult(slide: DeckSlide): string {
  return `Slide ${slide.id} is now on the trainee's screen.

${slideBriefing(slide)}

The slide is already up. This reply is the only thing the trainee will hear, so it has to carry the whole answer.

Teach the content now, covering the points listed above. Around forty-five seconds of speech, and longer if the question deserves it. This overrides any earlier instruction to keep the answer short.

Never defer. Do not say "let's take a look at this slide", "the slide covers that", "let me bring that up", or anything else that promises an explanation instead of giving one. Do not name the slide number; the trainee can see it. Opening with a word or two of acknowledgement is fine, but the substance must follow immediately in the same reply.`;
}

function historyBlock(history: HistoryTurn[]): string {
  if (history.length === 0) return 'This is the start of the session.';
  return history
    .map((turn) => {
      const who = turn.speaker === 'trainer' ? TRAINER_NAME : 'Trainee';
      return `${who} (on slide ${turn.slideId}): ${turn.text}`;
    })
    .join('\n');
}

interface TurnPromptArgs {
  kind: TurnKind;
  slide: DeckSlide;
  history: HistoryTurn[];
  question?: string;
  coveredSlideIds: number[];
}

/** Builds the user-role prompt for a single turn. */
export function buildTurnPrompt({
  kind,
  slide,
  history,
  question,
  coveredSlideIds,
}: TurnPromptArgs): string {
  const covered =
    coveredSlideIds.length > 0
      ? `Slides you have already taught: ${coveredSlideIds.join(', ')}. You may refer back to those.`
      : 'You have not taught any slides yet.';

  const conversation = `CONVERSATION SO FAR\n${historyBlock(history)}`;

  if (kind === 'narrate') {
    const isFirst = slide.id === 1;
    const isLast = slide.id === TOTAL_SLIDES;
    return `${conversation}

${covered}

SLIDE NOW ON SCREEN
${slideBriefing(slide)}

YOUR TASK
Teach this slide now. ${
      isFirst
        ? 'This is the opening of the session, so introduce yourself and set out what is coming.'
        : 'Move on from what you were just saying with a short natural link, then teach this slide.'
    }${
      isLast
        ? ' This is the final slide, so close the session after covering it: recap the whole deck briefly, give them the one habit to take away, and invite final questions.'
        : ''
    } End by handing the conversation back to the trainee.`;
  }

  if (kind === 'answer') {
    return `${conversation}

${covered}

SLIDE NOW ON SCREEN
${slideBriefing(slide)}

THE WHOLE DECK, FOR REFERENCE
${fullDeckReference()}

THE TRAINEE JUST ASKED
"${question ?? ''}"

YOUR TASK
Answer that. Lead with the direct answer, then add only as much detail as the question needs. Keep it under about thirty seconds of speech unless the question genuinely needs more. If the answer sits on a different slide, call ${NAVIGATE_TOOL_NAME} to bring that slide up first. Finish by checking whether that covered it, or by picking the thread back up where you left off.`;
  }

  if (kind === 'quiz') {
    return `${conversation}

${covered}

THE WHOLE DECK, FOR REFERENCE
${fullDeckReference()}

YOUR TASK
Put three short check questions to the trainee, one at a time, drawn from what you have actually covered. Ask the first one now and nothing else. Make it a scenario rather than a definition, something like where a particular document would sit in the classification matrix. Do not give the answer away in the question.`;
  }

  return `${conversation}

${covered}

THE WHOLE DECK, FOR REFERENCE
${fullDeckReference()}

YOUR TASK
Close the session. In under forty seconds of speech, recap what you covered, name the single habit you want them to take away, remind them of the three reporting routes without spelling out addresses, and thank them. Do not ask another question.`;
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
