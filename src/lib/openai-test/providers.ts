/**
 * The calls behind the OpenAI test: OpenAI speaking and listening, and Deepgram
 * listening to the same recording so the two transcripts can be read side by side.
 *
 * Server only, because the keys are. Nothing here is used by a training session.
 */

import 'server-only';

import {
  DEEPGRAM_STT_MODEL,
  OPENAI_TRANSCRIBE_MODEL,
  OPENAI_TTS_MODEL,
  requireEnv,
} from '../config';
import {
  deepgramLanguageFor,
  openAiLanguageFor,
  type ListeningChoice,
  type SpeakRequest,
} from './samples';

const OPENAI = 'https://api.openai.com/v1';

/**
 * Said on the page rather than requireEnv's own message, which is written for somebody
 * running the app on their own machine and tells them to restart a dev server.
 */
const NOT_CONNECTED = 'OpenAI is not connected yet: OPENAI_API_KEY is not set in this deployment.';

/**
 * Says what went wrong in words that tell somebody what to do about it.
 *
 * OpenAI reports an empty account and a busy one with the same status, 429, and only the
 * error's code tells them apart, so the code is read before the status.
 */
export function openAiFailure(status: number, detail: string): string {
  let code = '';
  let message = '';
  try {
    const parsed = JSON.parse(detail) as {
      error?: { code?: string; type?: string; message?: string };
    };
    code = parsed.error?.code ?? parsed.error?.type ?? '';
    message = parsed.error?.message ?? '';
  } catch {
    message = detail.slice(0, 200);
  }
  const said = message ? ` OpenAI said: "${message.slice(0, 200)}" (HTTP ${status}).` : '';

  if (code === 'insufficient_quota') {
    return `The OpenAI account has no credit left. Add credit at platform.openai.com.${said}`;
  }
  if (status === 401 || code === 'invalid_api_key') {
    return `OpenAI refused the key. Check that OPENAI_API_KEY is correct.${said}`;
  }
  if (status === 429) {
    return `OpenAI is asking for fewer requests. Wait a moment and try again.${said}`;
  }
  return `OpenAI failed (${status}).${said}`;
}

export type Spoken =
  { ok: true; audio: ReadableStream<Uint8Array> } | { ok: false; status: number; error: string };

/**
 * Raw 16-bit mono PCM at 24 kHz, OpenAI's `pcm` format, which is exactly what the session
 * player plays. So what the test page plays is what a session would sound like.
 */
export async function speakWithOpenAi(
  request: SpeakRequest,
  signal?: AbortSignal,
): Promise<Spoken> {
  let key: string;
  try {
    key = requireEnv('OPENAI_API_KEY');
  } catch {
    return { ok: false, status: 503, error: NOT_CONNECTED };
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${OPENAI}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_TTS_MODEL(),
        voice: request.voice,
        input: request.text,
        ...(request.instructions ? { instructions: request.instructions } : {}),
        response_format: 'pcm',
      }),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (signal?.aborted) return { ok: false, status: 499, error: '' };
    return { ok: false, status: 502, error: `Could not reach OpenAI: ${(error as Error).message}` };
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return { ok: false, status: 502, error: openAiFailure(upstream.status, detail) };
  }
  return { ok: true, audio: upstream.body };
}

export type Heard = { text: string; ms: number } | { error: string; ms: number };

/** One recording through OpenAI's transcription. */
export async function transcribeWithOpenAi(
  audio: Blob,
  choice: ListeningChoice,
  signal?: AbortSignal,
): Promise<Heard> {
  const started = Date.now();
  let key: string;
  try {
    key = requireEnv('OPENAI_API_KEY');
  } catch {
    return { error: NOT_CONNECTED, ms: 0 };
  }

  const form = new FormData();
  form.append('file', audio, fileNameFor(audio.type));
  form.append('model', OPENAI_TRANSCRIBE_MODEL());
  form.append('response_format', 'json');
  const language = openAiLanguageFor(choice);
  if (language) form.append('language', language);

  try {
    const response = await fetch(`${OPENAI}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      return {
        error: openAiFailure(response.status, await response.text().catch(() => '')),
        ms: Date.now() - started,
      };
    }
    const body = (await response.json()) as { text?: string };
    return { text: (body.text ?? '').trim(), ms: Date.now() - started };
  } catch (error) {
    return {
      error: `Could not reach OpenAI: ${(error as Error).message}`,
      ms: Date.now() - started,
    };
  }
}

/** The same recording through Deepgram, set the way a real session listens. */
export async function transcribeWithDeepgram(
  audio: Blob,
  choice: ListeningChoice,
  signal?: AbortSignal,
): Promise<Heard> {
  const started = Date.now();
  let key: string;
  try {
    key = requireEnv('DEEPGRAM_API_KEY');
  } catch (error) {
    return { error: (error as Error).message, ms: 0 };
  }

  const url = new URL('https://api.deepgram.com/v1/listen');
  url.searchParams.set('model', DEEPGRAM_STT_MODEL());
  url.searchParams.set('smart_format', 'true');
  url.searchParams.set('punctuate', 'true');
  url.searchParams.set('language', deepgramLanguageFor(choice));

  try {
    const response = await fetch(url, {
      method: 'POST',
      // The recording's own container. Deepgram reads WebM and Ogg without being told
      // the encoding, which is what a browser's recorder produces.
      headers: { Authorization: `Token ${key}`, 'Content-Type': audio.type || 'audio/webm' },
      body: audio,
      signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return {
        error: `Deepgram failed (${response.status}). ${detail.slice(0, 200)}`.trim(),
        ms: Date.now() - started,
      };
    }
    const body = (await response.json()) as {
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    };
    const text = body.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
    return { text: text.trim(), ms: Date.now() - started };
  } catch (error) {
    return {
      error: `Could not reach Deepgram: ${(error as Error).message}`,
      ms: Date.now() - started,
    };
  }
}

/** OpenAI reads the format from the file name, so the name has to match the recording. */
function fileNameFor(type: string): string {
  if (type.includes('ogg')) return 'speech.ogg';
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'speech.m4a';
  if (type.includes('wav')) return 'speech.wav';
  if (type.includes('mpeg') || type.includes('mp3')) return 'speech.mp3';
  return 'speech.webm';
}
