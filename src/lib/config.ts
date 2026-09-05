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

/**
 * Model used for the trainer's turns.
 *
 * gemini-3.7-flash was tried and reverted. On a short question it looked better,
 * faster and more concrete, which is what the original benchmark measured. On the
 * real narration workload it collapses: 79 words against a 375 word budget on
 * slide 2, and 77 against 313 on slide 4, where 2.5-flash gives 508 and 366. It
 * appears to read the "choose rather than exhaust" instruction as licence to
 * produce a stub. Latency was the same either way, so there was nothing to trade.
 *
 * Set GEMINI_MODEL to try another, and check narration length on slides 2, 4 and 5
 * before keeping it. A short Q&A is not a representative test.
 */
export const GEMINI_MODEL = () => envOr('GEMINI_MODEL', 'gemini-2.5-flash');

/**
 * Model used for answering questions, which is the hardest thing the trainer
 * does. Defaults to the same model; point it at a pro model if you would trade
 * some latency for depth.
 */
export const GEMINI_ANSWER_MODEL = () => envOr('GEMINI_ANSWER_MODEL', GEMINI_MODEL());
/**
 * How much the trainer may think before it starts speaking.
 *
 * Gemini 2.5 Flash thinks by default and thinking produces no speech, so every
 * thinking token is a trainee watching a silent slide. Measured on the real prompt,
 * four slides, against the word budget each slide carries:
 *
 *   narration    default  10.4s, 11.4s, 10.8s, 5.7s to the first spoken word
 *                off       1.1s,  1.2s,  1.1s, 1.0s
 *   answering    default  5.3s and 7.9s, at 70 and 79 words
 *                off      1.3s and 1.4s, at 50 and 59 words
 *
 * Roughly nine seconds a slide, and a seven slide deck opens seven times.
 *
 * The trade is honest rather than free. Narration runs about ten points longer
 * against its budget without thinking, on top of an overrun that is already there at
 * plus thirty eight per cent and has its own cause in how many topics a busy slide
 * hands over. Silence is the worse of the two for something a person is sitting in
 * front of, and the length has a separate lever in `maxCoreOnNarration`.
 *
 * Answering gains twice: faster, and shorter in the direction the answer prompt was
 * already trying and failing to go. `ablate-answer-prompt.ts` measured it reliably
 * producing about 81 words against a 66 word ceiling; without thinking it lands
 * inside the ceiling.
 *
 * Both are variables rather than constants so the trade can be revisited on a
 * deployment without a release. Zero disables thinking, -1 hands the decision back to
 * the model, and any positive number is a token ceiling: 512 was measured at 3.2s and
 * 3.7s, which is the middle of the road if narration length ever matters more than
 * the wait.
 *
 * Deliberately not applied to the analysis passes. Those run once per deck, in the
 * background, behind a progress bar nobody is listening to, and reasoning about a
 * slide is the whole point of them.
 */
export const NARRATE_THINKING_BUDGET = () => envIntOr('NARRATE_THINKING_BUDGET', 0);
export const ANSWER_THINKING_BUDGET = () => envIntOr('ANSWER_THINKING_BUDGET', 0);

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
