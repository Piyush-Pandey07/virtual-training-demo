/** Server-side configuration. Reads from the environment with sensible defaults. */

/** Reads a required environment variable, or throws a message worth showing. */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in, then restart the dev server.`,
    );
  }
  return value;
}

function envOr(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

function envIntOr(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const GEMINI_MODEL = () => envOr('GEMINI_MODEL', 'gemini-2.5-flash');
export const DEEPGRAM_STT_MODEL = () => envOr('DEEPGRAM_STT_MODEL', 'nova-3');
export const DEEPGRAM_TTS_MODEL = () => envOr('DEEPGRAM_TTS_MODEL', 'aura-2-thalia-en');

/**
 * Lifetime of the browser transcription token. Deepgram allows up to 3600
 * seconds; the token only has to be valid for the initial handshake, so keeping
 * it short limits the damage if one leaks.
 */
export const DEEPGRAM_TOKEN_TTL = () =>
  Math.min(Math.max(envIntOr('DEEPGRAM_TOKEN_TTL_SECONDS', 300), 30), 3600);

/** Sample rate used end to end for both capture and playback. */
export const AUDIO_SAMPLE_RATE = 24_000;

/** Capture rate sent to Deepgram. Nova models are happy at 16 kHz mono. */
export const CAPTURE_SAMPLE_RATE = 16_000;
