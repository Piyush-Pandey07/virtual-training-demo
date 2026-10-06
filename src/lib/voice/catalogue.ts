/**
 * The languages a session can be held in, and the voices a delegate may choose in each.
 *
 * This is the only file that knows which provider a voice comes from. The session
 * screen asks `/api/voices` for the list, plays samples from `/api/voices/sample`, and
 * sends an id back with every sentence; it never reads meaning into an id. So moving
 * to another provider, or offering one per customer, is a change here and in
 * `synthesise.ts`, and the screen is untouched. That was a stated requirement of the
 * to-do this was built for, and it is what let Hindi arrive as a second provider.
 *
 * English is Deepgram's, exactly as before. Hindi is Sarvam's, offered only where the
 * Sarvam key is set.
 *
 * Safe to import from the browser, since nothing in it is secret, but the screen takes
 * its list from the API rather than from here so that the server stays the one place
 * that decides.
 */

import { DEEPGRAM_TTS_MODEL, hindiAvailable } from '../config';
import type { SessionLanguage } from '../types';

export interface VoiceOption {
  /** Opaque to the screen. Sent back as given, never parsed. */
  id: string;
  /** What the delegate sees. */
  name: string;
  accent: string;
  description: string;
}

/** One language a session can be held in, with the voices that can speak it. */
export interface LanguageOption {
  code: SessionLanguage;
  /** In its own script, which is what a speaker of it looks for. */
  name: string;
  /** The same in English, for everybody else on the screen. */
  englishName: string;
  voices: VoiceOption[];
  /** Selected before the delegate chooses, so starting straight away still works. */
  defaultVoiceId: string;
}

export interface VoiceCatalogue {
  /** English first and always. Hindi only where it can actually be spoken. */
  languages: LanguageOption[];
}

/** How the trainer refers to itself in a language whose verbs mark the speaker's gender. */
export type SpeaksAs = 'feminine' | 'masculine';

/** What the synthesis needs to know about a voice, and the screen never sees. */
export interface SpokenVoice {
  provider: 'deepgram' | 'sarvam';
  /** The provider's own name for the voice: an Aura model, or a Sarvam speaker. */
  model: string;
  /** The language the provider is told the text is in. Sarvam requires one. */
  languageCode?: 'hi-IN';
}

interface ProvidedVoice extends VoiceOption, SpokenVoice {
  speaksAs?: SpeaksAs;
}

/**
 * Eight of the 41 Aura-2 English voices on the live account.
 *
 * Forty-one is a list nobody chooses from, so this is a short one: four feminine and
 * four masculine, across the American, British and Australian accents Deepgram offers,
 * chosen on Deepgram's own descriptions for the qualities that suit a trainer, such as
 * clear, calm, patient, professional and trustworthy. There is no Indian English voice
 * on this provider.
 *
 * Thalia leads because she is the voice every session used before there was a choice.
 */
const DEEPGRAM_VOICES: readonly ProvidedVoice[] = [
  {
    id: 'aura-2-thalia-en',
    name: 'Thalia',
    accent: 'American',
    description: 'Clear and confident',
  },
  {
    id: 'aura-2-athena-en',
    name: 'Athena',
    accent: 'American',
    description: 'Calm and professional',
  },
  {
    id: 'aura-2-orpheus-en',
    name: 'Orpheus',
    accent: 'American',
    description: 'Clear and professional',
  },
  {
    id: 'aura-2-neptune-en',
    name: 'Neptune',
    accent: 'American',
    description: 'Patient and polite',
  },
  { id: 'aura-2-pandora-en', name: 'Pandora', accent: 'British', description: 'Smooth and calm' },
  { id: 'aura-2-draco-en', name: 'Draco', accent: 'British', description: 'Warm and trustworthy' },
  {
    id: 'aura-2-theia-en',
    name: 'Theia',
    accent: 'Australian',
    description: 'Expressive and sincere',
  },
  {
    id: 'aura-2-hyperion-en',
    name: 'Hyperion',
    accent: 'Australian',
    description: 'Warm and caring',
  },
].map((voice) => ({ ...voice, provider: 'deepgram' as const, model: voice.id }));

/**
 * Four of Bulbul v3's speakers, the four Sarvam itself recommends for Hindi.
 *
 * Its guidance ranks every speaker per language by measured pronunciation accuracy, and
 * names Priya and Suhani as the female voices and Shubh and Ashutosh as the male ones
 * for Hindi. Choosing from that rather than by ear keeps away from voices it warns
 * against, such as Varun, which it describes as a villain's voice for suspense.
 *
 * `speaksAs` is what the trainer's Hindi has to agree with. "मैं बताती हूँ" is a woman
 * speaking and "मैं बताता हूँ" a man; a voice and a verb that disagree are heard
 * immediately by anybody who speaks the language.
 */
const SARVAM_HINDI_VOICES: readonly ProvidedVoice[] = [
  {
    name: 'Priya',
    speaksAs: 'feminine' as const,
    description: "Female. Sarvam's first choice for Hindi",
  },
  {
    name: 'Shubh',
    speaksAs: 'masculine' as const,
    description: "Male. Sarvam's first choice for Hindi",
  },
  { name: 'Suhani', speaksAs: 'feminine' as const, description: 'Female. Recommended for Hindi' },
  { name: 'Ashutosh', speaksAs: 'masculine' as const, description: 'Male. Recommended for Hindi' },
].map((voice) => ({
  ...voice,
  id: `sarvam-hi-${voice.name.toLowerCase()}`,
  accent: 'Hindi',
  provider: 'sarvam' as const,
  // Sarvam's speaker names are case-sensitive and lowercase.
  model: voice.name.toLowerCase(),
  languageCode: 'hi-IN' as const,
}));

/** What each voice says when a delegate plays its sample. Short, and what Nova sounds like. */
export const VOICE_SAMPLE_TEXT =
  "Hello, I'll be your trainer for this session. Stop me whenever you have a question.";

/**
 * The Hindi sample, written to Sarvam's own guidance: Hindi in Devanagari, the English
 * word in English, and a danda to end each sentence. It says nothing about the speaker,
 * so the same line is right in a male voice and a female one.
 */
export const HINDI_SAMPLE_TEXT =
  'नमस्ते, इस training session में आपका स्वागत है। कोई भी सवाल हो, तो बीच में ज़रूर पूछिए।';

/** Only what the screen may see. The provider and its names for things stay here. */
function shown({ id, name, accent, description }: ProvidedVoice): VoiceOption {
  return { id, name, accent, description };
}

function offeredVoices(): readonly ProvidedVoice[] {
  return hindiAvailable() ? [...DEEPGRAM_VOICES, ...SARVAM_HINDI_VOICES] : DEEPGRAM_VOICES;
}

export function voiceCatalogue(): VoiceCatalogue {
  const configured = DEEPGRAM_TTS_MODEL();
  const offered = DEEPGRAM_VOICES.some((voice) => voice.id === configured);
  const languages: LanguageOption[] = [
    {
      code: 'en',
      name: 'English',
      englishName: 'English',
      voices: DEEPGRAM_VOICES.map(shown),
      defaultVoiceId: offered ? configured : DEEPGRAM_VOICES[0]!.id,
    },
  ];
  if (hindiAvailable()) {
    languages.push({
      code: 'hi',
      name: 'हिन्दी',
      englishName: 'Hindi',
      voices: SARVAM_HINDI_VOICES.map(shown),
      defaultVoiceId: SARVAM_HINDI_VOICES[0]!.id,
    });
  }
  return { languages };
}

/**
 * The voice a request asked for, or null to refuse it.
 *
 * No voice at all means the deployment's default English voice, exactly as every request
 * behaved before there was a choice, so nothing already in flight changes. A voice that
 * is named but not offered is refused rather than quietly replaced: a request asking for
 * something specific should hear that it cannot have it, not get something else. That
 * includes a Hindi voice on a deployment with no Sarvam key.
 */
export function voiceFor(requested: unknown): SpokenVoice | null {
  if (requested === undefined || requested === null) {
    return { provider: 'deepgram', model: DEEPGRAM_TTS_MODEL() };
  }
  if (typeof requested !== 'string') return null;
  const voice = offeredVoices().find((candidate) => candidate.id === requested);
  if (!voice) return null;
  const { provider, model, languageCode } = voice;
  return languageCode ? { provider, model, languageCode } : { provider, model };
}

/** The line a voice's sample says, in the language the voice speaks. */
export function sampleTextFor(voice: SpokenVoice): string {
  return voice.languageCode === 'hi-IN' ? HINDI_SAMPLE_TEXT : VOICE_SAMPLE_TEXT;
}

/**
 * Whether the trainer, speaking in this voice, is a woman or a man to Hindi grammar.
 *
 * Undefined for an English voice, where nothing turns on it, and for anything not
 * offered. The prompt then falls back to phrasing that avoids the question.
 */
export function speaksAsFor(requested: unknown): SpeaksAs | undefined {
  if (typeof requested !== 'string') return undefined;
  return offeredVoices().find((voice) => voice.id === requested)?.speaksAs;
}

/** Letters only, so a vowel sign is not counted as a second letter beside its consonant. */
const DEVANAGARI_LETTER = /(?=\p{L})\p{Script=Devanagari}/gu;
const LETTER = /\p{L}/gu;

/**
 * Whether a voice can say this text, as opposed to producing sound from it.
 *
 * Deepgram's voices are English. Handed Hindi they do not refuse: they return audio of
 * the Devanagari read with English phonetics, which plays, sounds like nonsense, and
 * looks from every log like a success. So text that is mostly Devanagari is refused for
 * them up front. Mostly, rather than any, so that a trainee who types their name in
 * Hindi still gets an English session that greets them.
 */
export function canSpeak(voice: SpokenVoice, text: string): boolean {
  if (voice.provider !== 'deepgram') return true;
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters === 0) return true;
  const devanagari = text.match(DEVANAGARI_LETTER)?.length ?? 0;
  return devanagari / letters <= 0.5;
}
