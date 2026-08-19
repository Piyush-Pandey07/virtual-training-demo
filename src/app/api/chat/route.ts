/**
 * POST /api/chat
 *
 * Streams the trainer's next spoken turn as server sent events. Text arrives as
 * `text` deltas so the client can start speaking before generation finishes, and
 * a slide change arrives as a `nav` event when the model calls the navigation
 * tool.
 */

import {
  GoogleGenAI,
  Type,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
} from '@google/genai';

import { GEMINI_ANSWER_MODEL, GEMINI_MODEL, requireEnv } from '@/lib/config';
import { clampSlideId, getSlide, TOTAL_SLIDES } from '@/lib/deck';
import {
  buildNavigationResult,
  buildSystemInstruction,
  buildTurnPrompt,
  NAVIGATE_TOOL_NAME,
  sanitiseForSpeech,
} from '@/lib/trainer-prompt';
import type { ChatEvent, ChatRequest, HistoryTurn, LearnerProfile, TurnKind } from '@/lib/types';

export const runtime = 'nodejs';
/** Streaming only makes sense uncached. */
export const dynamic = 'force-dynamic';

const VALID_KINDS: TurnKind[] = ['narrate', 'answer', 'recap', 'quiz'];

/**
 * Lets the trainer put a different slide on screen when a question is really
 * about another part of the deck. Declared here rather than alongside the prompt
 * text so the Gemini SDK never reaches the browser bundle.
 */
const navigateToolDeclaration: FunctionDeclaration = {
  name: NAVIGATE_TOOL_NAME,
  description:
    "Put a different slide on the trainee's screen. Call this when the trainee asks to go to, go back to, or revisit a specific slide or topic, so the slide they are looking at matches what you are talking about. Do not call it to advance through the deck in order, because the session controls handle that.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      slideId: {
        type: Type.INTEGER,
        description: `The slide number to show, between 1 and ${TOTAL_SLIDES}.`,
      },
      reason: {
        type: Type.STRING,
        description: 'A short note on why, for the session log. One sentence.',
      },
    },
    required: ['slideId', 'reason'],
  },
};

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

  const contents: Content[] = [
    {
      role: 'user',
      parts: [
        {
          text: buildTurnPrompt({
            kind,
            slide,
            history: parseHistory(body.history),
            question,
            coveredSlideIds,
            learner: parseLearner(body.learner),
          }),
        },
      ],
    },
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: ChatEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      let spoken = '';

      const model = kind === 'answer' ? GEMINI_ANSWER_MODEL() : GEMINI_MODEL();

      const config = {
        systemInstruction: buildSystemInstruction(traineeName),
        // Narration is fully briefed, so variation buys nothing and costs length
        // discipline. Questions are open-ended and benefit from a warmer setting.
        temperature: kind === 'narrate' ? 0.55 : 0.75,
        maxOutputTokens: 2400,
        tools: [{ functionDeclarations: [navigateToolDeclaration] }],
        abortSignal: request.signal,
      };

      /**
       * Streams one pass. Slide changes are forwarded the moment they appear so
       * the deck moves while the model is still composing, and any tool calls are
       * returned so the caller can answer them.
       */
      const runPass = async (turnContents: Content[]) => {
        const calls: FunctionCall[] = [];
        let text = '';

        const result = await ai.models.generateContentStream({
          model,
          contents: turnContents,
          config,
        });

        for await (const chunk of result) {
          for (const call of chunk.functionCalls ?? []) {
            if (call.name !== NAVIGATE_TOOL_NAME) continue;
            calls.push(call);
            const requested = Number(call.args?.slideId);
            if (!Number.isFinite(requested)) continue;
            send({
              type: 'nav',
              slideId: clampSlideId(requested),
              reason: String(call.args?.reason ?? 'Requested by the trainer.'),
            });
          }

          const delta = chunk.text;
          if (delta) {
            text += delta;
            send({ type: 'text', delta });
          }
        }

        return { calls, text };
      };

      try {
        const first = await runPass(contents);
        spoken = first.text;

        // Gemini will not produce speech in the same turn as a tool call. It
        // expects the function to be executed and its result handed back, so
        // without this second pass a slide change would leave the trainer silent.
        if (first.calls.length > 0 && !first.text.trim()) {
          const followUp: Content[] = [
            ...contents,
            {
              role: 'model',
              parts: first.calls.map((call) => ({ functionCall: call })),
            },
            {
              role: 'user',
              parts: first.calls.map((call) => {
                const shown = clampSlideId(Number(call.args?.slideId));
                return {
                  functionResponse: {
                    ...(call.id ? { id: call.id } : {}),
                    name: call.name ?? NAVIGATE_TOOL_NAME,
                    response: {
                      ok: true,
                      slideId: shown,
                      instruction: buildNavigationResult(getSlide(shown) ?? slide, question),
                    },
                  },
                };
              }),
            },
          ];

          const second = await runPass(followUp);
          spoken = second.text;
        }

        const finalText = sanitiseForSpeech(spoken);
        if (!finalText) {
          send({
            type: 'error',
            message:
              'The model returned no speech for this turn. This is usually a transient upstream issue, so try again.',
          });
        } else {
          send({ type: 'done', text: finalText, suggestedFollowUps: slide.discussionPrompts });
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
