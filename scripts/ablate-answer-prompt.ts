/**
 * Which part of the answer prompt is buying the length?
 *
 * The controlled temperature test showed this prompt reliably produces about 81 words
 * against a 66 word ceiling, at any temperature. That is not sampling noise; it means
 * the prompt asks for roughly 81 words of content. So the question is which block is
 * doing the asking.
 *
 * Removes one section at a time and measures. Whatever drops the length most is the
 * thing to change; anything whose removal changes nothing is not the cause, however
 * plausible it reads.
 *
 * What it found, and the reason it is committed rather than thrown away: nothing in
 * the answer prompt shortens a reply when taken away. Without the knowledge block the
 * reply grew by 5 words, without the wider expertise by 12, without the LENGTH block
 * by 19. There was no obligation to delete, which is what nine rounds of rewording
 * had assumed, and the real fault was arithmetic in the sentence budget. Run this
 * before rewriting a prompt on a hunch about what it is asking for.
 *
 * `npm run ablate`. Costs one model call per block per sample, so it is not free.
 */

import { readFileSync } from 'node:fs';

import { GoogleGenAI } from '@google/genai';

import { getSlide } from '../src/lib/deck';
import { ISMS_DECK } from '../src/lib/decks/isms';
import { buildSystemInstruction, buildTurnPrompt } from '../src/lib/trainer-prompt';
import type { HistoryTurn } from '../src/lib/types';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}

const SAMPLES = 4;

const HISTORY: HistoryTurn[] = [
  { speaker: 'trainer', text: 'Those are the main policies on this slide.', slideId: 4 },
  { speaker: 'trainee', text: 'ok', slideId: 4 },
];

const QUESTION = 'can I use my own laptop for work';

const system = buildSystemInstruction(ISMS_DECK);
const full = buildTurnPrompt({
  deck: ISMS_DECK,
  kind: 'answer',
  slide: getSlide(ISMS_DECK, 4)!,
  history: HISTORY,
  question: QUESTION,
  coveredSlideIds: [1, 2, 3, 4],
});

/** The headers that begin each block of the assembled answer prompt. */
const HEADERS = [
  'CONVERSATION SO FAR',
  'WHERE THIS TRAINEE IS',
  'SLIDE NOW ON SCREEN',
  'YOUR EXPERTISE ON WHAT IS CURRENTLY ON SCREEN',
  'FURTHER EXPERTISE YOU CAN REACH FOR',
  'WHERE THIS SITS IN THE DECK',
  'THE TRAINEE JUST ASKED',
  'WHAT KIND OF ANSWER THEY WANT',
  'YOUR TASK',
  'LENGTH',
  'THE LENGTH THIS MEANS',
  'HOW TO HAND BACK',
];

/** Splits the prompt into labelled blocks by header. */
function blocks(prompt: string): Array<{ header: string; text: string }> {
  const found: Array<{ header: string; at: number }> = [];
  for (const header of HEADERS) {
    const at = prompt.indexOf(`\n${header}\n`);
    if (at !== -1) found.push({ header, at });
  }
  found.sort((a, b) => a.at - b.at);

  return found.map((entry, index) => ({
    header: entry.header,
    text: prompt.slice(entry.at, index + 1 < found.length ? found[index + 1].at : prompt.length),
  }));
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

async function measure(prompt: string): Promise<number> {
  let total = 0;
  for (let index = 0; index < SAMPLES; index += 1) {
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { systemInstruction: system, temperature: 0.6, maxOutputTokens: 2400 },
    });
    total += (result.text ?? '').trim().split(/\s+/).filter(Boolean).length;
  }
  return Math.round(total / SAMPLES);
}

async function main() {
  const parts = blocks(full);
  console.log(`prompt is ${full.length} chars in ${parts.length} blocks`);
  for (const part of parts) {
    console.log(`  ${String(part.text.length).padStart(6)} chars  ${part.header}`);
  }

  const baseline = await measure(full);
  console.log(`\nbaseline (whole prompt): ${baseline} words, mean of ${SAMPLES}\n`);
  console.log('removing one block at a time:');

  for (const part of parts) {
    // Never remove the question itself; there would be nothing to answer.
    if (part.header === 'THE TRAINEE JUST ASKED') continue;

    const without = full.replace(part.text, '\n');
    const words = await measure(without);
    const delta = words - baseline;
    const arrow = delta <= -8 ? '  <-- big drop' : delta >= 8 ? '  <-- got longer' : '';
    console.log(
      `  ${String(words).padStart(3)} words  (${delta >= 0 ? '+' : ''}${delta})  without ${part.header}${arrow}`,
    );
  }
}

void main();
