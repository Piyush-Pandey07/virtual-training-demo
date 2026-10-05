/**
 * EXPERIMENTAL -- OpenAI voice trial. Everything the trial offers, in one place.
 *
 * Lets the team hear OpenAI's voices and test its speech to text before anybody
 * decides whether to move the trainer off Deepgram. Nothing in the training app reads
 * this file, and deleting the experimental folders removes the trial entirely; see
 * README.md next to this file.
 *
 * Safe to import from the browser: nothing in it is secret. The server validates every
 * request against these same lists, so the page cannot ask for anything not offered.
 */

import { VOICE_SAMPLE_TEXT } from '@/lib/voice/catalogue';

/** The trial's own address, used by the page guard and the back link. */
export const TRIAL_PATH = '/experimental/openai-voice';

/** OpenAI returns `pcm` as signed 16-bit little-endian mono at this rate. */
export const OPENAI_PCM_SAMPLE_RATE = 24_000;

/** Caps that keep a signed-in tester from running up the bill by accident. */
export const MAX_TEXT_CHARS = 600;
export const MAX_STYLE_CHARS = 400;
export const MAX_RECORDING_SECONDS = 30;
/** Thirty seconds of browser audio is well under this; Vercel refuses bodies over 4.5 MB. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

// ------------------------------------------------------------------ text to speech

/** All thirteen built-in voices, the two OpenAI recommends first. */
const ALL_VOICES = [
  'marin',
  'cedar',
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
] as const;

/** The older tts-1 models predate ballad, verse, marin and cedar. */
const CLASSIC_VOICES = [
  'alloy',
  'ash',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
] as const;

/** OpenAI's own advice is that these two give the best quality. */
export const RECOMMENDED_VOICES: ReadonlySet<string> = new Set(['marin', 'cedar']);

export interface SpeechModelOption {
  id: string;
  name: string;
  note: string;
  /** Whether the model follows a speaking-style instruction. */
  takesStyle: boolean;
  voices: readonly string[];
}

export const SPEECH_MODELS: readonly SpeechModelOption[] = [
  {
    id: 'gpt-4o-mini-tts',
    name: 'GPT-4o mini TTS',
    note: 'Current model. Follows a speaking style.',
    takesStyle: true,
    voices: ALL_VOICES,
  },
  {
    id: 'gpt-4o-mini-tts-2025-12-15',
    name: 'GPT-4o mini TTS (Dec 2025)',
    note: 'The same model, pinned to its December 2025 version.',
    takesStyle: true,
    voices: ALL_VOICES,
  },
  {
    id: 'tts-1-hd',
    name: 'TTS-1 HD',
    note: 'Older. Higher quality, no style control.',
    takesStyle: false,
    voices: CLASSIC_VOICES,
  },
  {
    id: 'tts-1',
    name: 'TTS-1',
    note: 'Older. Fastest, no style control.',
    takesStyle: false,
    voices: CLASSIC_VOICES,
  },
];

export const DEFAULT_SPEECH_MODEL = SPEECH_MODELS[0]!.id;

export function speechModel(id: string): SpeechModelOption | undefined {
  return SPEECH_MODELS.find((model) => model.id === id);
}

export function voiceName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export interface SampleLine {
  id: string;
  label: string;
  text: string;
}

/**
 * What the voices say. The first is the exact line the app's current voices say, so
 * the two providers can be compared like for like. The rest are the kinds of thing the
 * trainer actually says, including the acronyms and numbers a voice is most likely to
 * get wrong.
 */
export const SAMPLE_LINES: readonly SampleLine[] = [
  { id: 'same-line', label: 'Same line as the app today', text: VOICE_SAMPLE_TEXT },
  {
    id: 'opening',
    label: 'Opening a session',
    text: "Welcome to this virtual training session on information security awareness. I'm your trainer, and over the next few minutes we'll look at how we keep client information safe. Stop me whenever you have a question.",
  },
  {
    id: 'terms',
    label: 'Tricky terms and numbers',
    text: 'Under ISO/IEC 27001, Annex A control 5.12 covers how information is classified. A TVRA report is confidential, so it is never sent to a personal email account, even to work on it at home.',
  },
  {
    id: 'explaining',
    label: 'Explaining a threat',
    text: "Spear phishing is aimed at one person. The attacker reads your profile, learns who your project manager is, and writes an email that sounds exactly like them. The give-away is rarely the spelling. It's the request: urgent, unusual, and asking you to skip a step.",
  },
  {
    id: 'correcting',
    label: 'Correcting a belief, kindly',
    text: "That's a really common belief, and it makes sense, because the phishing emails we notice are the clumsy ones. But the ones that work are the ones we don't notice. So the safer habit isn't trusting your eye. It's checking any unusual request another way.",
  },
];

export interface StylePreset {
  id: string;
  label: string;
  text: string;
}

/** Speaking styles for the models that take one. Editable on the page. */
export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: 'trainer',
    label: 'Warm trainer',
    text: 'Speak as a warm, patient corporate trainer in a one-to-one security awareness session. Encouraging and calm, never patronising. Unhurried, with a short pause after each key point.',
  },
  {
    id: 'trainer-indian',
    label: 'Warm trainer, Indian English',
    text: 'Speak with a natural Indian English accent, as a warm, patient corporate trainer in a one-to-one security awareness session. Encouraging and calm, never patronising. Unhurried, with a short pause after each key point.',
  },
  {
    id: 'brisk',
    label: 'Brisk and professional',
    text: 'Speak as a confident, professional trainer. Clear and efficient, at a slightly quicker pace, without sounding rushed.',
  },
];

// ------------------------------------------------------------------ speech to text

export interface TranscribeModelOption {
  id: string;
  name: string;
  note: string;
  /** How the model takes the training vocabulary: a word list, or a prompt. */
  hint: 'keywords' | 'prompt';
  /** Ticked when the page opens. */
  preselected: boolean;
}

export const TRANSCRIBE_MODELS: readonly TranscribeModelOption[] = [
  {
    id: 'gpt-transcribe',
    name: 'GPT Transcribe',
    note: 'Newest. Takes a word list.',
    hint: 'keywords',
    preselected: true,
  },
  {
    id: 'gpt-4o-transcribe',
    name: 'GPT-4o Transcribe',
    note: 'Accurate, well established.',
    hint: 'prompt',
    preselected: true,
  },
  {
    id: 'gpt-4o-mini-transcribe',
    name: 'GPT-4o mini Transcribe',
    note: 'Faster and cheaper.',
    hint: 'prompt',
    preselected: true,
  },
  {
    id: 'whisper-1',
    name: 'Whisper',
    note: 'Oldest. The open-source model.',
    hint: 'prompt',
    preselected: false,
  },
];

export function transcribeModel(id: string): TranscribeModelOption | undefined {
  return TRANSCRIBE_MODELS.find((model) => model.id === id);
}

/** The words a security awareness session is full of, and a general model is not. */
export const TRAINING_VOCABULARY: readonly string[] = [
  'ISMS',
  'ISO/IEC 27001',
  'Annex A',
  'TVRA',
  'phishing',
  'spear phishing',
  'tailgating',
  'Technavious',
  'classification',
  'confidential',
  'data centre',
];

export const TRAINING_PROMPT = `A trainee asking a question in an information security awareness session. Terms that may come up: ${TRAINING_VOCABULARY.join(', ')}.`;

export interface TestSentence {
  id: string;
  text: string;
}

/** Read one aloud and the page scores each model against it. */
export const TEST_SENTENCES: readonly TestSentence[] = [
  {
    id: 'tvra',
    text: "Is a TVRA report confidential, or can I share it with the client's facilities team?",
  },
  { id: 'annex', text: 'Which Annex A control in ISO 27001 covers classifying information?' },
  {
    id: 'tailgating',
    text: 'Someone tailgated me into the data centre this morning. Who do I report that to?',
  },
  { id: 'phishing', text: 'I think I clicked a phishing link on my phone. What should I do now?' },
];
