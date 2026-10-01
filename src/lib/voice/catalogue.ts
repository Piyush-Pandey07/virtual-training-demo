/**
 * The voices a delegate may choose for the trainer.
 *
 * This is the only file that knows which provider the voices come from. The session
 * screen asks `/api/voices` for the list, plays samples from `/api/voices/sample`, and
 * sends an id back with every sentence; it never reads meaning into an id. So moving
 * to another provider, or offering one per customer, is a change here and in
 * `synthesise.ts`, and the screen is untouched. That was a stated requirement of the
 * to-do this was built for.
 *
 * Safe to import from the browser, since nothing in it is secret, but the screen takes
 * its list from the API rather than from here so that the server stays the one place
 * that decides.
 */

import { DEEPGRAM_TTS_MODEL } from '../config';

export interface VoiceOption {
  /** Opaque to the screen. Sent back as given, never parsed. */
  id: string;
  /** What the delegate sees. */
  name: string;
  accent: string;
  description: string;
}

export interface VoiceCatalogue {
  voices: VoiceOption[];
  /** Selected before the delegate chooses, so starting straight away still works. */
  defaultVoiceId: string;
}

/**
 * Eight of the 41 Aura-2 English voices on the live account.
 *
 * Forty-one is a list nobody chooses from, so this is a short one: four feminine and
 * four masculine, across the American, British and Australian accents Deepgram offers,
 * chosen on Deepgram's own descriptions for the qualities that suit a trainer, such as
 * clear, calm, patient, professional and trustworthy. There is no Indian English voice
 * on this provider; that is the Sarvam proof of concept.
 *
 * Thalia leads because she is the voice every session used before there was a choice.
 */
const DEEPGRAM_VOICES: readonly VoiceOption[] = [
  { id: 'aura-2-thalia-en', name: 'Thalia', accent: 'American', description: 'Clear and confident' },
  { id: 'aura-2-athena-en', name: 'Athena', accent: 'American', description: 'Calm and professional' },
  { id: 'aura-2-orpheus-en', name: 'Orpheus', accent: 'American', description: 'Clear and professional' },
  { id: 'aura-2-neptune-en', name: 'Neptune', accent: 'American', description: 'Patient and polite' },
  { id: 'aura-2-pandora-en', name: 'Pandora', accent: 'British', description: 'Smooth and calm' },
  { id: 'aura-2-draco-en', name: 'Draco', accent: 'British', description: 'Warm and trustworthy' },
  { id: 'aura-2-theia-en', name: 'Theia', accent: 'Australian', description: 'Expressive and sincere' },
  { id: 'aura-2-hyperion-en', name: 'Hyperion', accent: 'Australian', description: 'Warm and caring' },
];

/** What each voice says when a delegate plays its sample. Short, and what Nova sounds like. */
export const VOICE_SAMPLE_TEXT =
  "Hello, I'll be your trainer for this session. Stop me whenever you have a question.";

export function voiceCatalogue(): VoiceCatalogue {
  const configured = DEEPGRAM_TTS_MODEL();
  const offered = DEEPGRAM_VOICES.some((voice) => voice.id === configured);
  return {
    voices: [...DEEPGRAM_VOICES],
    defaultVoiceId: offered ? configured : DEEPGRAM_VOICES[0]!.id,
  };
}

/**
 * The provider's name for the voice a request asked for, or null to refuse it.
 *
 * No voice at all means the deployment's default, exactly as every request behaved
 * before there was a choice, so nothing already in flight changes. A voice that is
 * named but not offered is refused rather than quietly replaced: a request asking for
 * something specific should hear that it cannot have it, not get something else.
 */
export function voiceModelFor(requested: unknown): string | null {
  if (requested === undefined || requested === null) return DEEPGRAM_TTS_MODEL();
  if (typeof requested !== 'string') return null;
  return DEEPGRAM_VOICES.some((voice) => voice.id === requested) ? requested : null;
}
