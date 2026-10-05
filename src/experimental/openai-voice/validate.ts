/**
 * EXPERIMENTAL -- OpenAI voice trial. What the two trial routes will accept.
 *
 * Pure functions, so they are tested without a network or a key. Anything not offered
 * in `catalogue.ts` is refused rather than passed through, because the key behind
 * these routes is billed.
 */

import {
  MAX_STYLE_CHARS,
  MAX_TEXT_CHARS,
  MAX_UPLOAD_BYTES,
  speechModel,
  transcribeModel,
  type TranscribeModelOption,
} from './catalogue';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export interface SpeechRequest {
  text: string;
  voice: string;
  model: string;
  /** Null for a model that does not take one, whatever the page sent. */
  style: string | null;
}

export function parseSpeechRequest(body: unknown): Parsed<SpeechRequest> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Send a JSON object.' };
  const { text, voice, model, style } = body as Record<string, unknown>;

  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, error: 'Give it something to say.' };
  }
  if (text.length > MAX_TEXT_CHARS) {
    return { ok: false, error: `Keep it to ${MAX_TEXT_CHARS} characters.` };
  }

  const option = typeof model === 'string' ? speechModel(model) : undefined;
  if (!option) return { ok: false, error: 'Choose a model this trial offers.' };

  if (typeof voice !== 'string' || !option.voices.includes(voice)) {
    return { ok: false, error: `${option.name} does not offer that voice.` };
  }

  if (style !== undefined && style !== null && typeof style !== 'string') {
    return { ok: false, error: 'The speaking style must be text.' };
  }
  const trimmedStyle = typeof style === 'string' ? style.trim() : '';
  if (trimmedStyle.length > MAX_STYLE_CHARS) {
    return { ok: false, error: `Keep the speaking style to ${MAX_STYLE_CHARS} characters.` };
  }

  return {
    ok: true,
    value: {
      text: text.trim(),
      voice,
      model: option.id,
      style: option.takesStyle && trimmedStyle.length > 0 ? trimmedStyle : null,
    },
  };
}

/** The extension OpenAI identifies the format by, from what the browser recorded. */
const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
};

/** `speech.webm` for `audio/webm;codecs=opus`, or null for a format OpenAI cannot read. */
export function uploadNameFor(mimeType: string): string | null {
  const base = mimeType.split(';')[0]!.trim().toLowerCase();
  const extension = EXTENSIONS[base];
  return extension ? `speech.${extension}` : null;
}

export interface TranscribeRequest {
  model: TranscribeModelOption;
  /** Whether to send the training vocabulary along with the audio. */
  hint: boolean;
  fileName: string;
}

export function parseTranscribeRequest(fields: {
  model: unknown;
  hint: unknown;
  audioType: string;
  audioSize: number;
}): Parsed<TranscribeRequest> {
  const model = typeof fields.model === 'string' ? transcribeModel(fields.model) : undefined;
  if (!model) return { ok: false, error: 'Choose a model this trial offers.' };

  if (fields.audioSize === 0) return { ok: false, error: 'The recording is empty.' };
  if (fields.audioSize > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'That recording is too long. Keep it under thirty seconds.' };
  }

  const fileName = uploadNameFor(fields.audioType);
  if (!fileName) {
    return {
      ok: false,
      error: `This browser recorded ${fields.audioType || 'an unknown format'}, which OpenAI cannot read.`,
    };
  }

  return { ok: true, value: { model, hint: fields.hint === '1', fileName } };
}

// ------------------------------------------------------------------ scoring

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .split(' ')
    .filter((word) => word.length > 0);
}

/**
 * How much of what was meant to be said came back, as a whole percentage.
 *
 * One minus the word error rate: the word-level edit distance between the sentence
 * the tester read out and what the model heard, over the sentence's length. Case and
 * punctuation are ignored, since no listener would count those as mishearing.
 */
export function wordAccuracy(expected: string, heard: string): number {
  const want = words(expected);
  const got = words(heard);
  if (want.length === 0) return got.length === 0 ? 100 : 0;

  let previous = Array.from({ length: got.length + 1 }, (_, index) => index);
  for (let i = 1; i <= want.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= got.length; j += 1) {
      const substitution = previous[j - 1]! + (want[i - 1] === got[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution));
    }
    previous = current;
  }

  const errors = previous[got.length]!;
  return Math.max(0, Math.round((1 - errors / want.length) * 100));
}
