/**
 * What the OpenAI test offers, and what it accepts.
 *
 * Safe to import from the browser: voices, test sentences and limits only, and the
 * checks the routes apply to whatever the page sends, kept here so they can be tested
 * without a server.
 */

/**
 * The built-in voices of gpt-4o-mini-tts, as OpenAI lists them. Marin and Cedar first,
 * because OpenAI's own guide recommends them for the best quality.
 */
export const OPENAI_VOICES = [
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

export type OpenAiVoice = (typeof OPENAI_VOICES)[number];

/** The three languages the September feedback asked about. */
export type TestLanguage = 'en' | 'hi' | 'id';

export const TEST_LANGUAGES: ReadonlyArray<{ code: TestLanguage; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'id', name: 'Indonesian' },
];

/**
 * One sentence in each language, saying the same thing with the same technical terms.
 *
 * The terms stay in English in all three, because that is how they are said in a data
 * hall, and because how a voice reads "HV/MV", "UPS" and "N+1" in the middle of Hindi or
 * Indonesian is most of what this test is for.
 */
export const TEST_SENTENCES: Record<TestLanguage, string> = {
  en: 'Welcome to day one of CDFA. Today we will see how power travels from the HV/MV substation through the UPS to the data hall, and why N+1 redundancy matters when a chiller fails.',
  hi: 'CDFA के पहले दिन में आपका स्वागत है। आज हम देखेंगे कि power, HV/MV substation से UPS होते हुए data hall तक कैसे पहुँचती है, और जब कोई chiller fail हो जाए तो N+1 redundancy क्यों ज़रूरी है।',
  id: 'Selamat datang di hari pertama CDFA. Hari ini kita akan melihat bagaimana listrik mengalir dari gardu HV/MV melalui UPS hingga ke data hall, dan mengapa redundansi N+1 penting ketika sebuah chiller gagal berfungsi.',
};

/** A starting point for the "how it should sound" box, which only OpenAI's model takes. */
export const SUGGESTED_INSTRUCTIONS: Record<TestLanguage, string> = {
  en: 'Speak with a neutral Indian English accent, like a calm, friendly trainer.',
  hi: 'Speak natural, conversational Hindi, like a trainer in an Indian office, and say the English technical terms in English.',
  id: 'Speak natural Indonesian, like a calm, friendly trainer, and say the English technical terms in English.',
};

/** Long enough for a paragraph of narration, short enough that one click costs little. */
export const MAX_TEST_CHARS = 1000;
export const MAX_INSTRUCTION_CHARS = 400;

/**
 * A spoken question is seconds long; this is generous, and caps what one upload costs.
 * Thirty seconds of a browser recording is a few hundred kilobytes. The byte cap sits
 * under the 4.5 MB a Vercel function will accept, so a refusal is ours and says why.
 */
export const MAX_RECORDING_SECONDS = 30;
export const MAX_RECORDING_BYTES = 4 * 1024 * 1024;

export interface SpeakRequest {
  text: string;
  voice: OpenAiVoice;
  instructions?: string;
}

/** The speak route's body, checked. A string is a reason to refuse it. */
export function parseSpeakRequest(body: unknown): SpeakRequest | string {
  if (!body || typeof body !== 'object') return 'The request must be JSON.';
  const { text, voice, instructions } = body as Record<string, unknown>;

  const spoken = typeof text === 'string' ? text.trim() : '';
  if (!spoken) return 'Type something to hear.';
  if (spoken.length > MAX_TEST_CHARS) {
    return `Keep it under ${MAX_TEST_CHARS} characters, so one test stays cheap.`;
  }

  if (typeof voice !== 'string' || !OPENAI_VOICES.includes(voice as OpenAiVoice)) {
    return 'Choose one of the listed voices.';
  }

  const how = typeof instructions === 'string' ? instructions.trim() : '';
  if (how.length > MAX_INSTRUCTION_CHARS) {
    return `Keep the description under ${MAX_INSTRUCTION_CHARS} characters.`;
  }

  return how
    ? { text: spoken, voice: voice as OpenAiVoice, instructions: how }
    : { text: spoken, voice: voice as OpenAiVoice };
}

/** What the listening test was told the speaker would say, or `auto`. */
export type ListeningChoice = 'auto' | TestLanguage;

export function listeningChoice(raw: unknown): ListeningChoice {
  return raw === 'en' || raw === 'hi' || raw === 'id' ? raw : 'auto';
}

/** OpenAI takes an ISO 639-1 code, or nothing to detect the language itself. */
export function openAiLanguageFor(choice: ListeningChoice): TestLanguage | undefined {
  return choice === 'auto' ? undefined : choice;
}

/**
 * What Deepgram is told, matching how a real session listens.
 *
 * Hindi, and not knowing, both use Nova-3's code-switching mode, as a Hindi session does.
 * Indonesian has to be named: that mode covers English, Hindi and eight European and
 * Asian languages, and Indonesian is not among them.
 */
export function deepgramLanguageFor(choice: ListeningChoice): 'en' | 'multi' | 'id' {
  if (choice === 'en') return 'en';
  if (choice === 'id') return 'id';
  return 'multi';
}
