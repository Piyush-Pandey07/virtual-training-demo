/**
 * A sample question bank, generated from the deck, until the user team's banks arrive.
 *
 * Only so the assessments can be tried end to end before then. Every bank made here is
 * stored as a sample and shown everywhere as "Sample, not reviewed", because a model's
 * idea of the right answer is exactly the thing nobody has checked yet.
 *
 * The model is behind a small interface so the tests can hand in a fake and never call
 * Gemini, which costs money and would make the tests depend on what it felt like saying.
 */

import 'server-only';

import { GoogleGenAI, Type } from '@google/genai';

import { GEMINI_MODEL, requireEnv } from '../config';
import type { DeckRecord } from '../deck-types';
import {
  MAX_OPTION_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTION_LENGTH,
  MIN_OPTIONS,
  type BankKind,
  type BankQuestion,
} from './types';

/** About ten, as the BRD dev to-do asks. Enough to place somebody, short enough to sit. */
export const SAMPLE_QUESTION_COUNT = 10;

/** Fewer usable questions than this and the sample is not worth saving. */
export const SAMPLE_MINIMUM = 5;

/** Whatever answers a prompt with JSON text. Gemini in the app, a fake in the tests. */
export interface SampleModel {
  generate(prompt: string): Promise<string>;
}

/** The model returned something, but not enough usable questions to make a bank. */
export class SampleUnusable extends Error {}

const SAMPLE_SCHEMA = {
  type: Type.OBJECT,
  required: ['questions'],
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['question', 'options', 'correctIndex'],
        properties: {
          question: {
            type: Type.STRING,
            description: 'The question, in one or two plain sentences.',
          },
          options: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'Four answer options. Exactly one is right. The wrong ones are plausible mistakes a real participant might make, not jokes.',
          },
          correctIndex: {
            type: Type.INTEGER,
            description: 'Which option is right, counting from 0.',
          },
        },
      },
    },
  },
} as const;

/** The deck as text, capped so a very long deck does not become a very long prompt. */
function deckText(deck: DeckRecord): string {
  return deck.slides
    .map((slide) =>
      [
        `--- Slide ${slide.id}: ${slide.title} ---`,
        ...slide.bullets.slice(0, 12),
        ...(slide.keyPoints.length > 0 ? [`Key points: ${slide.keyPoints.join('; ')}`] : []),
        ...slide.speakerNotes.slice(0, 6),
      ].join('\n'),
    )
    .join('\n\n')
    .slice(0, 40_000);
}

export function samplePrompt(deck: DeckRecord, kind: BankKind): string {
  const purpose =
    kind === 'pre'
      ? 'This is the pre-session assessment, taken before the session to place each participant at Beginner, Intermediate or Advanced. Mix easy, middling and hard questions so the score spreads people out, and do not assume they have seen the deck.'
      : 'This is the post-session assessment, taken straight after the session to check what was learned. Ask about what the deck actually teaches, so a participant who attended can pass.';

  return `You are writing a multiple choice assessment for the training session "${deck.meta.title}", delivered to ${deck.meta.ownerDescription}.

${purpose}

Write ${SAMPLE_QUESTION_COUNT} questions, each with four options and exactly one right answer. Base every question on the deck below and nothing else. Do not ask about a figure, name, policy or clause number unless the deck states it. Write in British English, in plain words, and never use "all of the above" or "none of the above".

THE DECK
${deckText(deck)}`;
}

/** Gemini, with structured JSON output, as the deck analysis uses it. */
export function geminiSampleModel(): SampleModel {
  return {
    async generate(prompt) {
      const ai = new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });
      const result = await ai.models.generateContent({
        model: GEMINI_MODEL(),
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: SAMPLE_SCHEMA,
          temperature: 0.4,
        },
      });
      const text = result.text;
      if (!text) throw new SampleUnusable('The model returned nothing.');
      return text;
    },
  };
}

/**
 * The usable questions from what the model returned.
 *
 * Held to the same rules as an uploaded bank: two to six distinct, non-empty options, and
 * a correct answer that points at one of them. A question that breaks any of them is
 * dropped rather than repaired, since repairing means guessing which answer was meant.
 */
export function cleanSample(raw: unknown): Omit<BankQuestion, 'id'>[] {
  const list = (raw as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) return [];

  const questions: Omit<BankQuestion, 'id'>[] = [];
  for (const entry of list) {
    const { question, options, correctIndex } = (entry ?? {}) as Record<string, unknown>;
    if (typeof question !== 'string' || !Array.isArray(options)) continue;
    const text = question.trim();
    const cleaned = options
      .filter((option): option is string => typeof option === 'string')
      .map((option) => option.trim());
    if (!text || text.length > MAX_QUESTION_LENGTH) continue;
    if (cleaned.length !== options.length) continue;
    if (cleaned.length < MIN_OPTIONS || cleaned.length > MAX_OPTIONS) continue;
    if (cleaned.some((option) => !option || option.length > MAX_OPTION_LENGTH)) continue;
    if (new Set(cleaned.map((option) => option.toLowerCase())).size !== cleaned.length) continue;
    if (
      typeof correctIndex !== 'number' ||
      !Number.isInteger(correctIndex) ||
      correctIndex < 0 ||
      correctIndex >= cleaned.length
    ) {
      continue;
    }
    questions.push({ question: text, options: cleaned, correctIndex });
  }
  return questions.slice(0, SAMPLE_QUESTION_COUNT);
}

/**
 * Moves each question's right answer to a random position.
 *
 * A model asked for one right answer and three wrong ones tends to put the right one
 * first, and a bank whose answer is always A is a bank somebody can pass blind.
 */
export function shuffleOptions(
  questions: Omit<BankQuestion, 'id'>[],
  random: () => number = Math.random,
): Omit<BankQuestion, 'id'>[] {
  return questions.map((question) => {
    const order = question.options.map((_, index) => index);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    return {
      question: question.question,
      options: order.map((index) => question.options[index]!),
      correctIndex: order.indexOf(question.correctIndex),
    };
  });
}

/** Writes a sample bank's questions for a deck. Throws `SampleUnusable` if too few survive. */
export async function generateSampleQuestions(
  deck: DeckRecord,
  kind: BankKind,
  model: SampleModel = geminiSampleModel(),
  random: () => number = Math.random,
): Promise<Omit<BankQuestion, 'id'>[]> {
  const text = await model.generate(samplePrompt(deck, kind));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SampleUnusable(`The model's answer was not JSON: ${text.slice(0, 200)}`);
  }
  const questions = cleanSample(parsed);
  if (questions.length < SAMPLE_MINIMUM) {
    throw new SampleUnusable(
      `Only ${questions.length} usable questions came back, fewer than the ${SAMPLE_MINIMUM} a sample needs.`,
    );
  }
  return shuffleOptions(questions, random);
}
