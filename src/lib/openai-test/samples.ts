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

/**
 * The three languages the September feedback asked about, then the ones Technavious wants
 * next: Arabic for customers in the UAE, Malay, Filipino and Vietnamese, and Tamil, Telugu
 * and Marathi for the Indian-language roadmap.
 *
 * Each code is the ISO 639-1 code OpenAI's listening takes, so it is passed straight
 * through. Filipino has no code of its own there: OpenAI, Whisper and Deepgram all know it
 * as Tagalog, `tl`.
 */
export type TestLanguage = 'en' | 'hi' | 'id' | 'ar' | 'ms' | 'tl' | 'vi' | 'ta' | 'te' | 'mr';

export const TEST_LANGUAGES: ReadonlyArray<{ code: TestLanguage; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'ms', name: 'Malay' },
  { code: 'tl', name: 'Filipino' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'mr', name: 'Marathi' },
];

/** The name a language is shown under, in the results and the session's log. */
export function languageName(code: TestLanguage): string {
  return TEST_LANGUAGES.find((entry) => entry.code === code)?.name ?? code;
}

/**
 * One sentence in each language, saying the same thing with the same technical terms.
 *
 * The terms stay in English in every one, because that is how they are said in a data
 * hall, and because how a voice reads "HV/MV", "UPS" and "N+1" in the middle of Hindi or
 * Arabic is most of what this test is for. In the Indian languages and in Filipino a
 * trainer says more of the sentence in English than that, so those keep "power",
 * "substation" and "redundancy" in English as well, as the Hindi one does.
 *
 * Every sentence after Indonesian was written without a native speaker, and each needs
 * one to check it before a voice is judged on it: a voice should not lose marks for our
 * grammar.
 */
export const TEST_SENTENCES: Record<TestLanguage, string> = {
  en: 'Welcome to day one of CDFA. Today we will see how power travels from the HV/MV substation through the UPS to the data hall, and why N+1 redundancy matters when a chiller fails.',
  hi: 'CDFA के पहले दिन में आपका स्वागत है। आज हम देखेंगे कि power, HV/MV substation से UPS होते हुए data hall तक कैसे पहुँचती है, और जब कोई chiller fail हो जाए तो N+1 redundancy क्यों ज़रूरी है।',
  id: 'Selamat datang di hari pertama CDFA. Hari ini kita akan melihat bagaimana listrik mengalir dari gardu HV/MV melalui UPS hingga ke data hall, dan mengapa redundansi N+1 penting ketika sebuah chiller gagal berfungsi.',
  // Modern Standard Arabic, because that is how Arabic is written, in the Gulf as anywhere
  // else, and a trainer's script would be written. The Gulf accent is asked for in the
  // instructions instead. Needs a native speaker's check.
  ar: 'أهلًا بكم في اليوم الأول من CDFA. سنرى اليوم كيف تنتقل الكهرباء من محطة HV/MV الفرعية مرورًا بالـ UPS وصولًا إلى الـ data hall، ولماذا تُعدّ احتياطية N+1 مهمة عندما يتعطل الـ chiller.',
  // Malaysian Malay rather than Indonesian: "pencawang" and "rosak" where the Indonesian
  // says "gardu" and "gagal berfungsi", so a voice drifting into Indonesian is easier to
  // hear. Needs a native speaker's check.
  ms: 'Selamat datang ke hari pertama CDFA. Hari ini kita akan melihat bagaimana kuasa elektrik mengalir dari pencawang HV/MV melalui UPS ke data hall, dan mengapa redundancy N+1 penting apabila sebuah chiller rosak.',
  // Taglish, the way a trainer in Manila would say it. Needs a native speaker's check.
  tl: 'Maligayang pagdating sa unang araw ng CDFA. Ngayong araw, titingnan natin kung paano dumadaloy ang kuryente mula sa HV/MV substation, dadaan sa UPS, papunta sa data hall, at kung bakit mahalaga ang N+1 redundancy kapag nag-fail ang isang chiller.',
  // Needs a native speaker's check.
  vi: 'Chào mừng các bạn đến với ngày đầu tiên của CDFA. Hôm nay chúng ta sẽ tìm hiểu cách điện năng đi từ trạm biến áp HV/MV qua UPS đến data hall, và vì sao dự phòng N+1 lại quan trọng khi một chiller gặp sự cố.',
  // Needs a native speaker's check.
  ta: 'CDFA-வின் முதல் நாளுக்கு உங்களை வரவேற்கிறோம். இன்று, power எப்படி HV/MV substation-இலிருந்து UPS வழியாக data hall-க்குச் செல்கிறது என்றும், ஒரு chiller fail ஆனால் N+1 redundancy ஏன் முக்கியம் என்றும் பார்ப்போம்.',
  // Needs a native speaker's check.
  te: 'CDFA మొదటి రోజుకు మీకు స్వాగతం. ఈ రోజు power, HV/MV substation నుండి UPS ద్వారా data hall కి ఎలా వెళ్తుందో, మరియు ఒక chiller fail అయినప్పుడు N+1 redundancy ఎందుకు ముఖ్యమో చూద్దాం.',
  // Needs a native speaker's check.
  mr: 'CDFA च्या पहिल्या दिवशी तुमचे स्वागत आहे. आज आपण पाहणार आहोत की power, HV/MV substation पासून UPS मार्गे data hall पर्यंत कशी पोहोचते, आणि एखादा chiller fail झाल्यावर N+1 redundancy का महत्त्वाची आहे.',
};

/**
 * A starting point for the "how it should sound" box, which only OpenAI's model takes.
 *
 * Each pushes towards the accent a customer there would expect, because a voice that is
 * understandable but plainly foreign is the likeliest way for a language to fail this
 * test. For Vietnamese that is the Northern accent of Hanoi, the one national broadcasting
 * uses. A customer in Ho Chi Minh City may prefer the Southern one, which is a change of
 * one word here.
 */
export const SUGGESTED_INSTRUCTIONS: Record<TestLanguage, string> = {
  en: 'Speak with a neutral Indian English accent, like a calm, friendly trainer.',
  hi: 'Speak natural, conversational Hindi, like a trainer in an Indian office, and say the English technical terms in English.',
  id: 'Speak natural Indonesian, like a calm, friendly trainer, and say the English technical terms in English.',
  ar: 'Speak Arabic with a Gulf accent, as spoken in the UAE, like a calm, friendly trainer in Dubai, and say the English technical terms in English.',
  ms: 'Speak Malaysian Malay with a Malaysian accent, not Indonesian, like a calm, friendly trainer in Kuala Lumpur, and say the English technical terms in English.',
  tl: 'Speak Filipino the way a trainer in Manila would, in natural Taglish, and say the English technical terms in English with a Filipino accent.',
  vi: 'Speak Vietnamese with a Northern accent, as spoken in Hanoi, like a calm, friendly trainer, and say the English technical terms in English.',
  ta: 'Speak natural, conversational Tamil, like a trainer in a Chennai office, and say the English technical terms in English.',
  te: 'Speak natural, conversational Telugu, like a trainer in a Hyderabad office, and say the English technical terms in English.',
  mr: 'Speak natural, conversational Marathi, like a trainer in a Pune office, and say the English technical terms in English.',
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
  const offered = TEST_LANGUAGES.find((entry) => entry.code === raw);
  return offered ? offered.code : 'auto';
}

/**
 * OpenAI takes an ISO 639-1 code, or nothing to detect the language itself. The test's
 * codes already are that, `tl` for Filipino included.
 *
 * Telugu is sent as `te` although OpenAI does not list it among the languages it
 * transcribes well. Whisper, which the model grew from, knows the code, and whether what
 * comes back is usable is exactly what the test is for.
 */
export function openAiLanguageFor(choice: ListeningChoice): TestLanguage | undefined {
  return choice === 'auto' ? undefined : choice;
}

/** What Nova-3 is told: its code-switching mode, or one language by its own code. */
export type DeepgramLanguage =
  'multi' | 'en' | 'id' | 'ar' | 'ms' | 'tl' | 'vi' | 'ta' | 'te' | 'mr';

/**
 * Nova-3's monolingual code for each language that has to be named. Deepgram also has
 * regional Arabic codes, `ar-AE` among them, which may be worth a second run for UAE
 * customers; plain `ar` is the fair first comparison with OpenAI, which takes no region.
 */
const DEEPGRAM_LANGUAGES: Record<Exclude<TestLanguage, 'hi'>, DeepgramLanguage> = {
  en: 'en',
  id: 'id',
  ar: 'ar',
  ms: 'ms',
  tl: 'tl',
  vi: 'vi',
  ta: 'ta',
  te: 'te',
  mr: 'mr',
};

/**
 * What Deepgram is told, matching how a real session listens.
 *
 * Hindi, and not knowing, both use Nova-3's code-switching mode, as a Hindi session does.
 * Every other language has to be named: that mode covers English, Hindi and eight
 * European and Asian languages, and none of the others offered here is among them.
 */
export function deepgramLanguageFor(choice: ListeningChoice): DeepgramLanguage {
  if (choice === 'auto' || choice === 'hi') return 'multi';
  return DEEPGRAM_LANGUAGES[choice];
}

/**
 * The voice the trainer would use today for a language, so the page can play it beside
 * OpenAI's, or the plain reason there is none.
 *
 * Deepgram's Aura-2 voices speak English and a handful of European languages and
 * Japanese, and this app uses them for English only. Sarvam speaks Indian languages, but
 * the app is wired for its Hindi alone. So everything else has nothing to compare with,
 * and says so rather than sending text to a voice that would read it as nonsense.
 */
export type TodaysVoice =
  { ok: true; voice: string; label: string } | { ok: false; reason: string };

export function todaysVoiceFor(language: TestLanguage, hindi: boolean): TodaysVoice {
  switch (language) {
    case 'en':
      return { ok: true, voice: 'aura-2-thalia-en', label: 'Deepgram Thalia' };
    case 'hi':
      return hindi
        ? { ok: true, voice: 'sarvam-hi-priya', label: 'Sarvam Priya' }
        : {
            ok: false,
            reason:
              "Today's Hindi voice is not switched on in this deployment, so there is nothing to compare against.",
          };
    // Sarvam speaks these for the trainer too, for Technavious while they are in testing.
    // The voice is Sarvam's recommended female voice for each.
    case 'ta':
    case 'te':
    case 'mr': {
      const speaker = { ta: 'ishita', te: 'neha', mr: 'priya' }[language];
      return hindi
        ? {
            ok: true,
            voice: `sarvam-${language}-${speaker}`,
            label: `Sarvam ${speaker.charAt(0).toUpperCase()}${speaker.slice(1)}`,
          }
        : {
            ok: false,
            reason: `Today's ${languageName(language)} voice is not switched on in this deployment, so there is nothing to compare against.`,
          };
    }
    default:
      return {
        ok: false,
        reason: `Nothing the trainer uses today can speak ${languageName(language)}: Deepgram's voices are English and Sarvam's are Indian languages.`,
      };
  }
}

/** What one service made of a recording, as the transcribe route returns it. */
type Transcript = { text: string; ms: number } | { error: string; ms: number };

/** One line of the session's log: something heard spoken, or one recording transcribed. */
export type LoggedResult =
  | {
      kind: 'speech';
      at: Date;
      language: TestLanguage;
      voice: string;
      instructions?: string;
      firstSoundMs?: number;
      seconds?: number;
      error?: string;
    }
  | {
      kind: 'listening';
      at: Date;
      language: ListeningChoice;
      openai: Transcript;
      deepgram: Transcript;
    };

const LOG_COLUMNS = [
  'Time',
  'Test',
  'Language',
  'Voice',
  'Instructions',
  'First sound (ms)',
  'Speech (s)',
  'OpenAI heard',
  'OpenAI (ms)',
  'Deepgram heard',
  'Deepgram (ms)',
  'Error',
];

/** A tab or a line break inside a cell would start a new one when pasted. */
const cell = (value: string | number | undefined) =>
  value === undefined
    ? ''
    : String(value)
        .replace(/[\t\r\n]+/g, ' ')
        .trim();

const transcriptOf = (heard: Transcript) =>
  'error' in heard ? `(failed: ${heard.error})` : heard.text || '(heard nothing)';

/**
 * The session's log as tab-separated rows under a header, oldest first, which pastes into
 * a spreadsheet as one row per test, ready to score beside.
 */
export function resultsAsTable(log: ReadonlyArray<LoggedResult>): string {
  const rows = log.map((entry) => {
    const time = entry.at.toTimeString().slice(0, 8);
    if (entry.kind === 'speech') {
      return [
        time,
        'Speaking',
        languageName(entry.language),
        entry.voice,
        entry.instructions,
        entry.firstSoundMs,
        entry.seconds?.toFixed(1),
        '',
        '',
        '',
        '',
        entry.error,
      ];
    }
    return [
      time,
      'Listening',
      entry.language === 'auto' ? 'Not said' : languageName(entry.language),
      '',
      '',
      '',
      '',
      transcriptOf(entry.openai),
      entry.openai.ms,
      transcriptOf(entry.deepgram),
      entry.deepgram.ms,
      '',
    ];
  });
  return [LOG_COLUMNS, ...rows].map((row) => row.map(cell).join('\t')).join('\n');
}
