/**
 * EXPERIMENTAL -- OpenAI voice trial. The only file that talks to OpenAI.
 *
 * Plain `fetch` rather than the OpenAI SDK, so the trial adds no dependency to the
 * app and removing it leaves package.json exactly as it was.
 *
 * The key is read from OPENAI_API_KEY and never leaves the server. OPENAI_BASE_URL
 * may point somewhere else, such as a proxy or a local stand-in for testing.
 */

import 'server-only';

import { OPENAI_PCM_SAMPLE_RATE, TRAINING_PROMPT, TRAINING_VOCABULARY } from './catalogue';
import type { SpeechRequest, TranscribeRequest } from './validate';

export function openAiKey(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

function baseUrl(): string {
  return (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

export type Failure = { ok: false; status: number; error: string };

const NOT_CONFIGURED: Failure = {
  ok: false,
  status: 503,
  error: 'OPENAI_API_KEY is not set on this deployment, so the trial cannot call OpenAI.',
};

/** OpenAI's own message, which names the actual problem, such as a model the key cannot use. */
async function upstreamFailure(response: Response): Promise<Failure> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === 'string') detail = body.error.message;
  } catch {
    // Not JSON. The status says enough.
  }

  if (response.status === 401) {
    // The message would echo part of the key back. The variable name is what helps.
    return {
      ok: false,
      status: 502,
      error: 'OpenAI did not accept the key. Check OPENAI_API_KEY on this deployment.',
    };
  }
  if (response.status === 429) {
    return {
      ok: false,
      status: 429,
      error: `OpenAI says the key is over its rate limit or out of credit. ${detail}`.trim(),
    };
  }
  if (response.status >= 500) {
    return {
      ok: false,
      status: 502,
      error: `OpenAI had a problem (${response.status}). ${detail}`.trim(),
    };
  }
  return {
    ok: false,
    status: 400,
    error: `OpenAI refused the request. ${detail}`.trim(),
  };
}

async function call(path: string, init: RequestInit): Promise<Response | Failure> {
  const key = openAiKey();
  if (!key) return NOT_CONFIGURED;
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    return response.ok ? response : await upstreamFailure(response);
  } catch (error) {
    if (init.signal?.aborted) return { ok: false, status: 499, error: '' };
    return { ok: false, status: 502, error: `Could not reach OpenAI: ${(error as Error).message}` };
  }
}

export type Speech = { ok: true; audio: ReadableStream<Uint8Array>; sampleRate: number } | Failure;

/** Raw 16-bit mono PCM, streamed as OpenAI produces it, so playback can start early. */
export async function speak(request: SpeechRequest, signal?: AbortSignal): Promise<Speech> {
  const response = await call('/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: request.model,
      voice: request.voice,
      input: request.text,
      response_format: 'pcm',
      ...(request.style ? { instructions: request.style } : {}),
    }),
    signal,
  });
  if (!(response instanceof Response)) return response;
  if (!response.body) return { ok: false, status: 502, error: 'OpenAI returned no audio.' };
  return { ok: true, audio: response.body, sampleRate: OPENAI_PCM_SAMPLE_RATE };
}

export type Transcript = { ok: true; text: string; upstreamMs: number } | Failure;

export async function transcribe(
  request: TranscribeRequest,
  audio: Blob,
  signal?: AbortSignal,
): Promise<Transcript> {
  const form = new FormData();
  form.append('file', audio, request.fileName);
  form.append('model', request.model.id);
  form.append('response_format', 'json');

  // gpt-transcribe detects the language and takes a word list. The rest are told the
  // language, which OpenAI says helps both accuracy and speed, and take a prompt.
  if (request.model.hint === 'prompt') form.append('language', 'en');
  if (request.hint) {
    if (request.model.hint === 'keywords') {
      for (const word of TRAINING_VOCABULARY) form.append('keywords[]', word);
    } else {
      form.append('prompt', TRAINING_PROMPT);
    }
  }

  const started = performance.now();
  const response = await call('/audio/transcriptions', { method: 'POST', body: form, signal });
  if (!(response instanceof Response)) return response;

  let text: unknown;
  try {
    text = ((await response.json()) as { text?: unknown }).text;
  } catch {
    return {
      ok: false,
      status: 502,
      error: 'OpenAI returned something that was not a transcript.',
    };
  }
  if (typeof text !== 'string') {
    return { ok: false, status: 502, error: 'OpenAI returned no transcript.' };
  }
  return { ok: true, text: text.trim(), upstreamMs: Math.round(performance.now() - started) };
}
