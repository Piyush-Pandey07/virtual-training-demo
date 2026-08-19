/**
 * POST /api/chat
 *
 * Streams the trainer's next spoken turn as server sent events. Text arrives as
 * `text` deltas so the client can start speaking before generation finishes, and
 * a slide change arrives as a `nav` event when the model calls the navigation
 * tool.
 */

import { GoogleGenAI, type Content } from '@google/genai';

import { GEMINI_ANSWER_MODEL, GEMINI_MODEL, requireEnv } from '@/lib/config';
import { clampSlideId, getSlide, TOTAL_SLIDES, type DeckSlide } from '@/lib/deck';
import { classifyUtterance, isNavigationOnly } from '@/lib/intent';
import { bestSlideForQuestion } from '@/lib/knowledge';
import { buildSystemInstruction, buildTurnPrompt, sanitiseForSpeech } from '@/lib/trainer-prompt';
import type { ChatEvent, ChatRequest, HistoryTurn, LearnerProfile, TurnKind } from '@/lib/types';

export const runtime = 'nodejs';
/** Streaming only makes sense uncached. */
export const dynamic = 'force-dynamic';

const VALID_KINDS: TurnKind[] = ['narrate', 'answer', 'recap', 'quiz'];

/** Keeps the prompt bounded on a long session without losing the recent thread. */
const MAX_HISTORY_TURNS = 24;

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function parseHistory(raw: unknown): HistoryTurn[] {
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
      slideId: clampSlideId(Number(turn.slideId)),
    }))
    .slice(-MAX_HISTORY_TURNS);
}

/** The learner profile comes from the browser, so it is bounded before use. */
function parseLearner(raw: unknown): LearnerProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Partial<LearnerProfile>;
  const asked = Number(value.questionsAsked);
  return {
    questionsAsked: Number.isFinite(asked) ? Math.min(Math.max(Math.round(asked), 0), 999) : 0,
    curiousAbout: Array.isArray(value.curiousAbout)
      ? [...new Set(value.curiousAbout.map((id) => clampSlideId(Number(id))))]
          .sort((a, b) => a - b)
          .slice(0, TOTAL_SLIDES)
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

  const kind = VALID_KINDS.includes(body.kind) ? body.kind : 'narrate';
  const slideId = clampSlideId(Number(body.slideId));
  const slide = getSlide(slideId);
  if (!slide) return badRequest(`slideId must be between 1 and ${TOTAL_SLIDES}.`);

  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : '';
  if (kind === 'answer' && !question) {
    return badRequest("A question is required when kind is 'answer'.");
  }

  const traineeName =
    typeof body.traineeName === 'string' ? body.traineeName.trim().slice(0, 80) : undefined;

  const coveredSlideIds = Array.isArray(body.coveredSlideIds)
    ? [...new Set(body.coveredSlideIds.map((id) => clampSlideId(Number(id))))].sort((a, b) => a - b)
    : [];

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

    if (target > TOTAL_SLIDES) {
      // They asked to move on from the last slide, so close the session.
      effectiveKind = 'recap';
    } else {
      const clamped = clampSlideId(target);
      effectiveKind = 'narrate';
      effectiveSlide = getSlide(clamped) ?? slide;
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
    const match = bestSlideForQuestion(question, slideId);
    if (match) {
      const matched = getSlide(match.slideId);
      if (matched) {
        effectiveSlide = matched;
        coercedNav = match.slideId;
      }
    }
  }

  const history = parseHistory(body.history);
  const learner = parseLearner(body.learner);

  /** Builds a single-message conversation for one turn against one slide. */
  const turnFor = (turnKind: TurnKind, turnSlide: DeckSlide): Content[] => [
    {
      role: 'user',
      parts: [
        {
          text: buildTurnPrompt({
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
        systemInstruction: buildSystemInstruction(traineeName),
        // Narration is fully briefed, so variation buys nothing and costs length
        // discipline. Questions are open-ended and benefit from a warmer setting.
        temperature: effectiveKind === 'narrate' ? 0.55 : 0.75,
        maxOutputTokens: 2400,
        abortSignal: request.signal,
      };

      try {
        const result = await ai.models.generateContentStream({
          model,
          contents,
          config,
        });

        for await (const chunk of result) {
          const delta = chunk.text;
          if (delta) {
            spoken += delta;
            send({ type: 'text', delta });
          }
        }

        const finalText = sanitiseForSpeech(spoken);
        if (!finalText) {
          send({
            type: 'error',
            message:
              'The model returned no speech for this turn. This is usually a transient upstream issue, so try again.',
          });
        } else {
          send({
            type: 'done',
            text: finalText,
            suggestedFollowUps: effectiveSlide.discussionPrompts,
          });
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
