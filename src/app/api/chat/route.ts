/**
 * POST /api/chat
 *
 * Streams the trainer's next spoken turn as server sent events. Text arrives as
 * `text` deltas so the client can start speaking before generation finishes, and
 * a slide change arrives as a `nav` event, decided here before generation rather
 * than by the model. See src/lib/knowledge/index.ts for why.
 */

import { GoogleGenAI, type Content } from '@google/genai';

import { GEMINI_ANSWER_MODEL, GEMINI_MODEL, requireEnv } from '@/lib/config';
import { clampSlideId, getSlide, totalSlides } from '@/lib/deck';
import type { DeckRecord, DeckSlide } from '@/lib/deck-types';
import { DEFAULT_DECK_ID, loadDeck } from '@/lib/decks/registry';
import { classifyUtterance, isNavigationOnly } from '@/lib/intent';
import { bestSlideForQuestion } from '@/lib/knowledge';
import { buildSystemInstruction, buildTurnPrompt, sanitiseForSpeech } from '@/lib/trainer-prompt';
import type { ChatEvent, ChatRequest, HistoryTurn, LearnerProfile, TurnKind } from '@/lib/types';

import { checkAssignedDeck } from '@/lib/auth/guard';
import { mayStartSession } from '@/lib/usage/limits';
import { recordQuietly } from '@/lib/usage/store';

export const runtime = 'nodejs';
/** Streaming only makes sense uncached. */
export const dynamic = 'force-dynamic';
/**
 * Generation runs 3 to 8 seconds, and longer on the densest slides. Vercel's
 * default function timeout is 10 seconds, which would truncate a narration
 * mid-sentence, so this is raised to the Hobby plan ceiling. A stream cannot
 * outlive the function that produces it.
 */
export const maxDuration = 60;

const VALID_KINDS: TurnKind[] = ['narrate', 'answer', 'recap', 'quiz'];

/** Keeps the prompt bounded on a long session without losing the recent thread. */
const MAX_HISTORY_TURNS = 24;

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function parseHistory(deck: DeckRecord, raw: unknown): HistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (turn): turn is HistoryTurn =>
        !!turn &&
        typeof turn === 'object' &&
        typeof (turn as HistoryTurn).text === 'string' &&
        ((turn as HistoryTurn).speaker === 'trainer' ||
          (turn as HistoryTurn).speaker === 'trainee'),
    )
    .map((turn) => ({
      speaker: turn.speaker,
      text: turn.text.slice(0, 4000),
      slideId: clampSlideId(deck, Number(turn.slideId)),
    }))
    .slice(-MAX_HISTORY_TURNS);
}

/** The learner profile comes from the browser, so it is bounded before use. */
function parseLearner(deck: DeckRecord, raw: unknown): LearnerProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Partial<LearnerProfile>;
  const asked = Number(value.questionsAsked);
  return {
    questionsAsked: Number.isFinite(asked) ? Math.min(Math.max(Math.round(asked), 0), 999) : 0,
    curiousAbout: Array.isArray(value.curiousAbout)
      ? [...new Set(value.curiousAbout.map((id) => clampSlideId(deck, Number(id))))]
          .sort((a, b) => a - b)
          .slice(0, totalSlides(deck))
      : [],
    prefersSimpler: Boolean(value.prefersSimpler),
    prefersDepth: Boolean(value.prefersDepth),
    askedForStandard: Boolean(value.askedForStandard),
  };
}

export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return badRequest('Request body must be JSON.');
  }

  // Checked here and not only on the session page, because this route narrates
  // whatever deck id its body names. A check on the page alone would protect
  // nothing: the browser could post another id and have the trainer read out a deck
  // the trainee was never assigned.
  const T0 = Date.now();
  const gate = await checkAssignedDeck(body.deckId ?? DEFAULT_DECK_ID);
  if (!gate.ok) return gate.response;
  const T_AUTH = Date.now() - T0;

  const deck = await loadDeck(gate.person.orgId, body.deckId);
  if (!deck) return badRequest('No such deck.');
  const T_DECK = Date.now() - T0;

  const kind = VALID_KINDS.includes(body.kind) ? body.kind : 'narrate';
  const slideId = clampSlideId(deck, Number(body.slideId));
  const slide = getSlide(deck, slideId);
  if (!slide) return badRequest(`slideId must be between 1 and ${totalSlides(deck)}.`);

  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : '';
  if (kind === 'answer' && !question) {
    return badRequest("A question is required when kind is 'answer'.");
  }

  const traineeName =
    typeof body.traineeName === 'string' ? body.traineeName.trim().slice(0, 80) : undefined;

  const coveredSlideIds = Array.isArray(body.coveredSlideIds)
    ? [...new Set(body.coveredSlideIds.map((id) => clampSlideId(deck, Number(id))))].sort(
        (a, b) => a - b,
      )
    : [];

  // The start of a session: a narration with nothing covered yet. Checked here and
  // only here, because a cap that read two documents before every sentence would tax
  // the thing it protects -- and because stopping somebody halfway through a deck
  // costs them the session they were in and refuses spend that already happened.
  //
  // Somebody who abandons a session and starts again counts twice. That is right: it
  // is twice the spend.
  const startingASession = kind === 'narrate' && coveredSlideIds.length === 0;
  if (startingASession) {
    const verdict = await mayStartSession(gate.person.orgId);
    if (!verdict.allowed) {
      return Response.json({ error: verdict.reason }, { status: 429 });
    }
    recordQuietly(gate.person.orgId, { sessions: 1 });
  }

  let apiKey: string;
  try {
    apiKey = requireEnv('GEMINI_API_KEY');
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }

  const ai = new GoogleGenAI({ apiKey });

  /**
   * A navigation request is not a question.
   *
   * If one reaches the answer path, asking the model to "answer" it produces an
   * acknowledgement ("right, let's move on") and no teaching, and no amount of
   * instruction in the tool response overcomes the answer-turn framing already in
   * the conversation. So the turn is coerced here instead: work out where they
   * wanted to go, tell the client to move, and narrate that slide properly.
   */
  let effectiveKind = kind;
  let effectiveSlide = slide;
  let coercedNav: number | null = null;

  if (kind === 'answer' && isNavigationOnly(question)) {
    const goingBack = classifyUtterance(question) === 'back';
    const target = slideId + (goingBack ? -1 : 1);

    if (target > totalSlides(deck)) {
      // They asked to move on from the last slide, so close the session.
      effectiveKind = 'recap';
    } else {
      const clamped = clampSlideId(deck, target);
      effectiveKind = 'narrate';
      effectiveSlide = getSlide(deck, clamped) ?? slide;
      coercedNav = clamped === slideId ? null : clamped;
    }
  } else if (kind === 'answer' && question) {
    // A question whose subject lives on another slide moves the deck to it, so
    // the trainee is looking at what they are being told about. This is decided
    // here rather than by giving the model a navigation tool: Gemini does not emit
    // speech in the same turn as a tool call, and every attempt to repair that
    // with a second pass sometimes produced an acknowledgement instead of an
    // answer. Deciding it from the knowledge base is deterministic, testable, and
    // keeps the reply streaming from the first token.
    const match = bestSlideForQuestion(deck, question, slideId);
    if (match) {
      const matched = getSlide(deck, match.slideId);
      if (matched) {
        effectiveSlide = matched;
        coercedNav = match.slideId;
      }
    }
  }

  const history = parseHistory(deck, body.history);
  const learner = parseLearner(deck, body.learner);

  /** Builds a single-message conversation for one turn against one slide. */
  const turnFor = (turnKind: TurnKind, turnSlide: DeckSlide): Content[] => [
    {
      role: 'user',
      parts: [
        {
          text: buildTurnPrompt({
            deck,
            kind: turnKind,
            slide: turnSlide,
            history,
            question: turnKind === 'answer' ? question : undefined,
            coveredSlideIds,
            learner,
          }),
        },
      ],
    },
  ];

  const contents = turnFor(effectiveKind, effectiveSlide);
  const T_PROMPT = Date.now() - T0;
  const PROMPT_CHARS = JSON.stringify(contents).length;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: ChatEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      let spoken = '';

      // Sent before generation starts, so the deck moves as the trainer begins
      // speaking rather than after the whole reply has arrived.
      if (coercedNav !== null) {
        send({
          type: 'nav',
          slideId: coercedNav,
          reason: 'The trainee asked to move, so the deck was advanced.',
        });
      }

      const model = effectiveKind === 'answer' ? GEMINI_ANSWER_MODEL() : GEMINI_MODEL();

      const config = {
        systemInstruction: buildSystemInstruction(deck, traineeName),
        /**
         * Narration is fully briefed, so variation buys nothing and costs length
         * discipline.
         *
         * Answers are back at 0.75, where they started. They were moved to 0.6 on the
         * theory that the warmth was costing length discipline, and a controlled test
         * disproved it: one fixed prompt sampled eight times gave a mean of 81 words at
         * 0.6 and 82 at 0.3, with standard deviations of 6 and 5. Halving the
         * temperature moved the mean by one word. Length is decided by how many things
         * the prompt asks for, not by how the next token is sampled, so the setting
         * goes back to the value chosen for the reason that still holds: a question is
         * open-ended and the reply should not sound rehearsed.
         */
        temperature: effectiveKind === 'narrate' ? 0.55 : 0.75,
        /**
         * A runaway guard, and nothing else.
         *
         * Sizing this to the word budget was tried and is a trap. At 900 tokens every
         * one of ten measured replies was severed mid-sentence, and the harness scored
         * that run as its best ever: mean 38 words, nothing over its ceiling. A token
         * cap cannot make a model choose to be brief, only cut it off, and the trainee
         * hears the trainer stop mid-word because the stream is spoken as it arrives.
         *
         * Raised from 2400 because this counts thinking tokens as well as spoken ones,
         * and one reply in thirty was still being cut off at that figure. The largest
         * legitimate reply is a five sentence answer at about 170 tokens, so this is
         * headroom of more than twentyfold: it can only bite something already broken.
         */
        maxOutputTokens: 4000,
        abortSignal: request.signal,
      };

      send({
        type: 'timing',
        auth: T_AUTH,
        deck: T_DECK,
        prompt: T_PROMPT,
        promptChars: PROMPT_CHARS,
        systemChars: JSON.stringify(config.systemInstruction).length,
      } as unknown as ChatEvent);

      try {
        const openedAt = Date.now();
        const result = await ai.models.generateContentStream({
          model,
          contents,
          config,
        });
        send({ type: 'timing', modelOpened: Date.now() - openedAt } as unknown as ChatEvent);

        // Reported on the last chunk of the stream rather than up front, so it is read
        // as the stream is consumed and kept for after it finishes.
        let inputTokens = 0;
        let outputTokens = 0;

        for await (const chunk of result) {
          const delta = chunk.text;
          if (delta) {
            spoken += delta;
            send({ type: 'text', delta });
          }
          if (chunk.usageMetadata) {
            inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
            outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
          }
        }

        const finalText = sanitiseForSpeech(spoken);

        // Counted here rather than in /api/tts, which is the other obvious place and
        // the wrong one. That route is called once per sentence, so metering there
        // would put a database write in front of every utterance in an app whose whole
        // design is to start speaking before generation finishes. This text is exactly
        // what will be spoken, and counting it costs one write per turn instead of
        // thirty. The trade is that a direct call to /api/tts goes uncounted, and
        // nothing in the app makes one.
        recordQuietly(gate.person.orgId, {
          geminiInputTokens: inputTokens,
          geminiOutputTokens: outputTokens,
          ttsCharacters: finalText.length,
        });
        if (!finalText) {
          send({
            type: 'error',
            message:
              'The model returned no speech for this turn. This is usually a transient upstream issue, so try again.',
          });
        } else {
          send({ type: 'done', text: finalText });
        }
      } catch (error) {
        // An aborted request is the client hanging up, not a failure worth reporting.
        if (!request.signal.aborted) {
          const message = error instanceof Error ? error.message : 'Unknown error calling Gemini.';
          send({ type: 'error', message });
        }
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
