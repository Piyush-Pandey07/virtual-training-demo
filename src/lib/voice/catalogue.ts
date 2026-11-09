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
 * English is Deepgram's, exactly as before. Hindi and the other Indian languages are
 * Sarvam's, offered only where the Sarvam key is set. Arabic, Malay, Indonesian, Filipino
 * and Vietnamese are OpenAI's, offered only where the OpenAI key is set.
 *
 * Safe to import from the browser, since nothing in it is secret, but the screen takes
 * its list from the API rather than from here so that the server stays the one place
 * that decides.
 */

import {
  DEEPGRAM_TTS_MODEL,
  hindiAvailable,
  languagesForEveryone,
  openAiConfigured,
} from '../config';
import { LANGUAGES, languageInfo, type LanguageInfo, type SarvamLanguageCode } from '../languages';
import { HOME_ORG_ID } from '../orgs/types';
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
  /** Shown under the choice: what to expect in this language. */
  note?: string;
  /** Offered to Technavious's own people only, until a speaker of it has checked it. */
  testing?: boolean;
}

export interface VoiceCatalogue {
  /** English first and always. The others only where they can actually be spoken. */
  languages: LanguageOption[];
}

/** How the trainer refers to itself in a language whose verbs mark the speaker's gender. */
export type SpeaksAs = 'feminine' | 'masculine';

/** What the synthesis needs to know about a voice, and the screen never sees. */
export interface SpokenVoice {
  provider: 'deepgram' | 'sarvam' | 'openai';
  /** The provider's own name for the voice: an Aura model, a Sarvam speaker, an OpenAI voice. */
  model: string;
  /** The language the provider is told the text is in. Sarvam requires one. */
  languageCode?: SarvamLanguageCode;
  /** How OpenAI is asked to speak, accent included. OpenAI only. */
  instructions?: string;
  /**
   * The session language an OpenAI voice speaks. OpenAI is never told it, since its
   * voices take the language from the text and the accent from the instructions, but the
   * sample and the developer log need it. Sarvam's voices carry theirs in `languageCode`.
   */
  language?: SessionLanguage;
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
 * The Sarvam voices, built from the speakers languages.ts names for each language.
 *
 * Sarvam ranks its speakers per language by measured pronunciation accuracy and names
 * the ones to use for each; those are the ones offered. Choosing from that rather than
 * by ear keeps away from voices it warns against, such as Varun, which it describes as a
 * villain's voice for suspense.
 *
 * `speaksAs` is what the trainer's grammar has to agree with in a language whose verbs
 * mark the speaker's gender. "मैं बताती हूँ" is a woman speaking and "मैं बताता हूँ" a man;
 * a voice and a verb that disagree are heard immediately by anybody who speaks it.
 *
 * Hindi's ids are what they were before there were other languages, so a session that
 * started on one is not refused partway.
 */
interface LanguageVoice extends ProvidedVoice {
  language: SessionLanguage;
}

const capitalised = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

const SARVAM_VOICES: readonly LanguageVoice[] = LANGUAGES.flatMap((language) =>
  (language.sarvam?.speakers ?? []).map((speaker) => ({
    id: `sarvam-${language.code.toLowerCase()}-${speaker.speaker}`,
    name: capitalised(speaker.speaker),
    accent: language.code === 'en-IN' ? 'Indian' : language.englishName,
    description: speaker.description,
    provider: 'sarvam' as const,
    // Sarvam's speaker names are case-sensitive and lowercase.
    model: speaker.speaker,
    languageCode: language.sarvam!.code,
    speaksAs: speaker.speaksAs,
    language: language.code,
  })),
);

/**
 * The OpenAI voices, built from languages.ts in the same way.
 *
 * OpenAI's voices are not tied to a language, so the same voice is a different id in each
 * language it speaks, carrying that language's instructions. The accent shown is the one
 * the instructions ask for, which is what a delegate is choosing between.
 */
const OPENAI_VOICES: readonly LanguageVoice[] = LANGUAGES.flatMap((language) =>
  (language.openai?.voices ?? []).map((speaker) => ({
    id: `openai-${language.code}-${speaker.voice}`,
    name: capitalised(speaker.voice),
    accent: language.openai!.accent,
    description: speaker.description,
    provider: 'openai' as const,
    model: speaker.voice,
    instructions: language.openai!.instructions,
    speaksAs: speaker.speaksAs,
    language: language.code,
  })),
);

/** Every voice that speaks one language other than English. */
const LANGUAGE_VOICES: readonly LanguageVoice[] = [...SARVAM_VOICES, ...OPENAI_VOICES];

/** What each voice says when a delegate plays its sample. Short, and what Nova sounds like. */
export const VOICE_SAMPLE_TEXT =
  "Hello, I'll be your trainer for this session. Stop me whenever you have a question.";

/**
 * The Hindi sample, written to Sarvam's own guidance: Hindi in Devanagari, the English
 * word in English, and a danda to end each sentence. It says nothing about the speaker,
 * so the same line is right in a male voice and a female one. The other languages'
 * samples follow the same rules, in languages.ts.
 */
export const HINDI_SAMPLE_TEXT = languageInfo('hi').sarvam!.sample;

/** Only what the screen may see. The provider and its names for things stay here. */
function shown({ id, name, accent, description }: ProvidedVoice): VoiceOption {
  return { id, name, accent, description };
}

/** Who is asking, as far as which languages they may have goes. */
export interface LanguageAudience {
  platform: boolean;
  /** The customer this person belongs to, as opposed to one they are looking inside. */
  homeOrgId?: string;
}

/**
 * The languages this person may hold a session in.
 *
 * English always. A Sarvam language only where the Sarvam key is set, and an OpenAI
 * language only where the OpenAI key is, so a deployment without one has no option that
 * fails on its first sentence. And a language nobody has yet checked only for
 * Technavious's own people, who test it; everybody else sees the languages in
 * LANGUAGES_FOR_EVERYONE.
 */
export function languagesFor(person?: LanguageAudience): readonly LanguageInfo[] {
  const everyone = languagesForEveryone();
  const staff = Boolean(person && (person.platform || person.homeOrgId === HOME_ORG_ID));
  return LANGUAGES.filter((language) => {
    if (language.code === 'en') return true;
    if (language.sarvam && !hindiAvailable()) return false;
    if (language.openai && !openAiConfigured()) return false;
    return staff || everyone.has(language.code);
  });
}

function offeredVoices(person?: LanguageAudience): readonly ProvidedVoice[] {
  const offered = new Set(languagesFor(person).map((language) => language.code));
  return [...DEEPGRAM_VOICES, ...LANGUAGE_VOICES.filter((voice) => offered.has(voice.language))];
}

export function voiceCatalogue(person?: LanguageAudience): VoiceCatalogue {
  const configured = DEEPGRAM_TTS_MODEL();
  const offered = DEEPGRAM_VOICES.some((voice) => voice.id === configured);
  const everyone = languagesForEveryone();
  const languages: LanguageOption[] = languagesFor(person).map((language) => {
    if (language.code === 'en') {
      return {
        code: 'en',
        name: 'English',
        englishName: 'English',
        voices: DEEPGRAM_VOICES.map(shown),
        defaultVoiceId: offered ? configured : DEEPGRAM_VOICES[0]!.id,
      };
    }
    const voices = LANGUAGE_VOICES.filter((voice) => voice.language === language.code);
    return {
      code: language.code,
      name: language.name,
      englishName: language.englishName,
      voices: voices.map(shown),
      defaultVoiceId: voices[0]!.id,
      ...(language.note ? { note: language.note } : {}),
      ...(everyone.has(language.code) ? {} : { testing: true }),
    };
  });
  return { languages };
}

/**
 * The voice a request asked for, or null to refuse it.
 *
 * No voice at all means the deployment's default English voice, exactly as every request
 * behaved before there was a choice, so nothing already in flight changes. A voice that
 * is named but not offered to this person is refused rather than quietly replaced: a
 * request asking for something specific should hear that it cannot have it, not get
 * something else. That includes a Sarvam or OpenAI voice on a deployment without that
 * provider's key, and a language still in testing asked for by a customer's trainee.
 */
export function voiceFor(requested: unknown, person?: LanguageAudience): SpokenVoice | null {
  if (requested === undefined || requested === null) {
    return { provider: 'deepgram', model: DEEPGRAM_TTS_MODEL() };
  }
  if (typeof requested !== 'string') return null;
  const voice = offeredVoices(person).find((candidate) => candidate.id === requested);
  if (!voice) return null;
  const { provider, model, languageCode, instructions, language } = voice;
  if (provider === 'openai') return { provider, model, instructions, language };
  return languageCode ? { provider, model, languageCode } : { provider, model };
}

/** The line a voice's sample says, in the language the voice speaks. */
export function sampleTextFor(voice: SpokenVoice): string {
  if (voice.provider === 'openai') {
    return (voice.language && languageInfo(voice.language).openai?.sample) || VOICE_SAMPLE_TEXT;
  }
  const language = LANGUAGES.find((candidate) => candidate.sarvam?.code === voice.languageCode);
  return language?.sarvam?.sample ?? VOICE_SAMPLE_TEXT;
}

/**
 * Whether the trainer, speaking in this voice, is a woman or a man to the language's
 * grammar.
 *
 * Undefined for an English voice, where nothing turns on it, and for anything not
 * offered. The prompt then falls back to phrasing that avoids the question.
 */
export function speaksAsFor(requested: unknown, person?: LanguageAudience): SpeaksAs | undefined {
  if (typeof requested !== 'string') return undefined;
  return offeredVoices(person).find((voice) => voice.id === requested)?.speaksAs;
}

/** Letters only, so a vowel sign is not counted as a second letter beside its consonant. */
const LATIN_LETTER = /(?=\p{L})\p{Script=Latin}/gu;
const LETTER = /\p{L}/gu;

/**
 * Whether a voice can say this text, as opposed to producing sound from it.
 *
 * Deepgram's voices are English. Handed Hindi or Tamil they do not refuse: they return
 * audio of the script read with English phonetics, which plays, sounds like nonsense,
 * and looks from every log like a success. So text that is mostly not in Latin letters
 * is refused for them up front. Mostly, rather than any, so that a trainee who types
 * their name in their own script still gets an English session that greets them.
 */
export function canSpeak(voice: SpokenVoice, text: string): boolean {
  if (voice.provider !== 'deepgram') return true;
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters === 0) return true;
  const latin = text.match(LATIN_LETTER)?.length ?? 0;
  return (letters - latin) / letters <= 0.5;
}
