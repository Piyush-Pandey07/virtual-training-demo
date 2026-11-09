/**
 * Every language a session can be held in, and what each part of the app needs to know
 * about it.
 *
 * Importable from the browser, and free of everything but types. Hindi arrived as a
 * second language with about a dozen `=== 'hi'` checks spread across the prompt, the
 * player, the speech routes and the picker. Adding Marathi, Tamil and Telugu that way
 * would have meant finding all of them again for each. Now a language is one entry here,
 * and the rest of the app asks this file.
 *
 * Indian languages are spoken by Sarvam's Bulbul v3, with the speakers Sarvam recommends
 * for each language by measured pronunciation accuracy, and listened to by Deepgram's
 * Nova-3. English with an Indian accent is a language here too, because a trainee
 * chooses it the same way, though it is English to everything except the voice.
 *
 * Arabic for the UAE, Malay, Indonesian, Filipino and Vietnamese are spoken by OpenAI's
 * gpt-4o-mini-tts, whose voices are not tied to a language: the accent is asked for in
 * words, the same words the staff OpenAI test page suggests, so what that page plays is
 * what a session sounds like. Deepgram's Nova-3 listens to them, as it does to the rest.
 *
 * A language is offered to every trainee only once somebody who speaks it has checked
 * it. Until then it is offered to Technavious staff, for UAT. See `languagesFor`.
 *
 * Besides types, the one thing taken from elsewhere is the OpenAI test's suggested
 * instructions: plain strings, from a file that is itself safe in the browser.
 */

import { SUGGESTED_INSTRUCTIONS, type OpenAiVoice } from './openai-test/samples';
import type { SessionLanguage } from './types';

export type SarvamLanguageCode =
  'en-IN' | 'hi-IN' | 'mr-IN' | 'ta-IN' | 'te-IN' | 'kn-IN' | 'ml-IN' | 'bn-IN' | 'gu-IN';

export interface SarvamSpeaker {
  /** Sarvam's own name, lowercase, as its API requires. */
  speaker: string;
  speaksAs: 'feminine' | 'masculine';
  /** Shown under the name in the picker. */
  description: string;
}

/** One of OpenAI's built-in voices, as offered for one language. */
export interface OpenAiSpeaker {
  voice: OpenAiVoice;
  /** How the voice sounds. OpenAI does not say, so this is by ear. */
  speaksAs: 'feminine' | 'masculine';
  /** Shown under the name in the picker. */
  description: string;
}

/**
 * How a language from outside India is spoken at work and written, for the prompt.
 *
 * The Indian languages' prompt says "at work in India" and assumes each language has a
 * script of its own. Neither holds here. Malay, Indonesian, Filipino and Vietnamese are
 * written in Latin letters, as English is, so the rule there is to keep English terms
 * spelled as English and untranslated. Arabic has its own script, written right to left.
 */
export interface OutsideIndia {
  /** Where the trainee works, as the prompt says it: "the UAE", "the Philippines". */
  country: string;
  script: 'latin' | 'arabic';
  /**
   * How the trainer describes itself in each voice, where the language marks the
   * speaker's gender outside the verb. Arabic's first-person verbs do not mark it, but the
   * words a speaker uses about themselves do: سعيد is a man saying he is glad, سعيدة a
   * woman.
   */
  self?: { feminine: string; masculine: string };
  /**
   * The word for "I" that marks neither gender nor age, where the everyday ones do. A
   * Vietnamese speaker who calls themselves anh, chị or em has said both.
   */
  me?: string;
}

/**
 * How the trainer should speak a language other than English, for the prompt.
 *
 * Hindi has its own hand-tuned block in trainer-prompt.ts, kept byte for byte, so it is
 * not described here.
 */
export interface SpokenRegister {
  /** The everyday register: native words in their script, English terms in English. */
  good: string;
  /** What to avoid: formal vocabulary and English spelled in the native script. */
  bad: string;
  /** The polite form of "you", which does not mark gender. */
  you: string;
  /** A comprehension check that does not mark the trainee's gender. */
  check: string;
  /**
   * English words spelled in the language's own script, which the trainer must not write.
   * Naming them is what stopped Hindi doing it: on production, Marathi narration still
   * wrote "डेटा सेंटर्स" and "ट्रेनिंग सेशन" until they were named.
   *
   * For a language written in Latin letters, the English terms respelled or translated
   * the local way instead, which the trainer must not say either.
   */
  transliterated: string;
  /**
   * Whether the speaker's gender shows in what they say about themselves: in their own
   * verbs, as in Hindi and Marathi, or in the words that describe them, as in Arabic.
   */
  gendered: boolean;
  /** Ends a sentence that finishes in the language, where that is not a full stop. */
  sentenceEnd?: '।';
  /** For a language from outside India. Absent for every Indian language. */
  outsideIndia?: OutsideIndia;
}

export interface LanguageInfo {
  code: SessionLanguage;
  /** In its own script, which is what a speaker of it looks for. */
  name: string;
  /** The same in English, for everybody else. */
  englishName: string;
  /**
   * What Deepgram is told. Hindi uses Nova-3's code-switching mode. The other Indian
   * languages use their own monolingual model: tested on production with Sarvam's own
   * audio, code-switching wrote Malayalam in Telugu script and spelled English words in
   * each language's script, while the monolingual models got the script right and kept
   * "training session" in English letters.
   */
  listen: string;
  /** Spoken by Sarvam, from prepaid credit, so synthesised just ahead of playback. */
  sarvam?: { code: SarvamLanguageCode; speakers: readonly SarvamSpeaker[]; sample: string };
  /**
   * Spoken by OpenAI's gpt-4o-mini-tts, billed as it is used, so fetched ahead as English
   * is. Every request carries the instructions, which are what give it the accent.
   */
  openai?: {
    voices: readonly OpenAiSpeaker[];
    /** Shown beside each voice's name in the picker. */
    accent: string;
    instructions: string;
    sample: string;
  };
  /** Absent for English and Indian English, whose prompt is the English one. */
  register?: SpokenRegister;
  /** Under the language choice in the lobby. */
  note?: string;
}

const female = (speaker: string, description: string): SarvamSpeaker => ({
  speaker,
  speaksAs: 'feminine',
  description,
});
const male = (speaker: string, description: string): SarvamSpeaker => ({
  speaker,
  speaksAs: 'masculine',
  description,
});

const languageNote = (name: string) =>
  `The trainer will teach and answer in ${name}, keeping technical terms in English. The slides stay in English. Speak ${name}, English or a mix of the two.`;

/**
 * The OpenAI voices offered in each OpenAI language. Marin and Cedar because OpenAI's own
 * guide recommends them for the best quality, and Coral as a second woman's voice. Which
 * of them carries each accent best is for the UAT to say, language by language.
 */
const OPENAI_SPEAKERS: readonly OpenAiSpeaker[] = [
  { voice: 'marin', speaksAs: 'feminine', description: "Female. OpenAI's recommended voice" },
  { voice: 'cedar', speaksAs: 'masculine', description: "Male. OpenAI's recommended voice" },
  { voice: 'coral', speaksAs: 'feminine', description: 'Female. Warm and clear' },
];

/**
 * In the order the picker shows them. English first and always.
 *
 * The register examples say the same thing in each language, the power path sentence the
 * Hindi block uses, so a reviewer comparing languages compares like with like. Every
 * non-Hindi line here needs a native speaker's check before its language goes to
 * everyone: that check is what `LANGUAGES_FOR_EVERYONE` records.
 *
 * The samples say what the English one does, a welcome and an invitation to interrupt,
 * without saying anything about the speaker, so one line suits a man's voice and a
 * woman's alike.
 */
export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'en', name: 'English', englishName: 'English', listen: 'en' },
  {
    code: 'en-IN',
    name: 'English (Indian accent)',
    englishName: 'English (Indian accent)',
    listen: 'en-IN',
    sarvam: {
      code: 'en-IN',
      speakers: [
        female('ishita', "Female. Sarvam's choice for Indian English"),
        male('ratan', "Male. Sarvam's choice for Indian English"),
      ],
      sample: "Hello, I'll be your trainer for this session. Stop me whenever you have a question.",
    },
  },
  {
    code: 'hi',
    name: 'हिन्दी',
    englishName: 'Hindi',
    // Code-switching, because nobody here says UPS or chiller in Hindi words, and
    // "next slide" said in the middle of Hindi has to come back as English.
    listen: 'multi',
    sarvam: {
      code: 'hi-IN',
      speakers: [
        female('priya', "Female. Sarvam's first choice for Hindi"),
        male('shubh', "Male. Sarvam's first choice for Hindi"),
        female('suhani', 'Female. Recommended for Hindi'),
        male('ashutosh', 'Male. Recommended for Hindi'),
      ],
      sample:
        'नमस्ते, इस training session में आपका स्वागत है। कोई भी सवाल हो, तो बीच में ज़रूर पूछिए।',
    },
    note: 'The trainer will teach and answer in Hindi, keeping technical terms in English. The slides stay in English. Speak Hindi, English or a mix of the two.',
  },
  {
    code: 'mr',
    name: 'मराठी',
    englishName: 'Marathi',
    listen: 'mr',
    sarvam: {
      code: 'mr-IN',
      speakers: [
        female('priya', 'Female. Recommended for Marathi'),
        male('ratan', 'Male. Recommended for Marathi'),
        female('ritu', 'Female. Recommended for Marathi'),
      ],
      sample:
        'नमस्कार, या training session मध्ये तुमचं स्वागत आहे. काही प्रश्न असेल, तर मध्येच नक्की विचारा.',
    },
    register: {
      good: 'या virtual training session मध्ये तुमचं स्वागत आहे. या slide वर आपण data centre चा power path पाहणार आहोत. Utility कडून power आधी HV/MV substation ला येते, मग UPS मधून racks पर्यंत पोहोचते.',
      bad: 'या स्लाइडवर आपण डेटा सेंटरच्या विद्युत मार्गाचे अवलोकन करू.',
      you: 'तुम्ही',
      check: 'हे स्पष्ट आहे का?',
      transliterated: 'डेटा, सेंटर, ट्रेनिंग, सेशन, व्हर्च्युअल, सर्व्हर',
      gendered: true,
    },
    note: languageNote('Marathi'),
  },
  {
    code: 'ta',
    name: 'தமிழ்',
    englishName: 'Tamil',
    listen: 'ta',
    sarvam: {
      code: 'ta-IN',
      speakers: [
        female('ishita', 'Female. Recommended for Tamil'),
        male('ratan', 'Male. Recommended for Tamil'),
        female('ritu', 'Female. Recommended for Tamil'),
        male('rohan', 'Male. Recommended for Tamil'),
      ],
      sample:
        'வணக்கம், இந்த training session-க்கு உங்களை வரவேற்கிறேன். ஏதாவது கேள்வி இருந்தால், இடையிலேயே கேளுங்கள்.',
    },
    register: {
      good: 'இந்த slide-ல data centre-ஓட power path-ஐ பார்க்கலாம். Utility-ல இருந்து power முதல்ல HV/MV substation-க்கு வரும், அப்புறம் UPS வழியா racks-க்கு போகும்.',
      bad: 'இந்த ஸ்லைடில் தரவு மையத்தின் மின் பாதையை ஆய்வு செய்வோம்.',
      you: 'நீங்கள்',
      check: 'இது தெளிவாக இருக்கிறதா?',
      transliterated: 'டேட்டா, சென்டர், ட்ரைனிங், செஷன், சர்வர்',
      gendered: false,
    },
    note: languageNote('Tamil'),
  },
  {
    code: 'te',
    name: 'తెలుగు',
    englishName: 'Telugu',
    listen: 'te',
    sarvam: {
      code: 'te-IN',
      speakers: [
        female('neha', 'Female. Recommended for Telugu'),
        male('shubh', 'Male. Recommended for Telugu'),
        female('priya', 'Female. Recommended for Telugu'),
        male('ratan', 'Male. Recommended for Telugu'),
      ],
      sample: 'నమస్కారం, ఈ training session కి మీకు స్వాగతం. ఏదైనా ప్రశ్న ఉంటే, మధ్యలోనే అడగండి.',
    },
    register: {
      good: 'ఈ slide లో data centre యొక్క power path చూద్దాం. Utility నుండి power ముందు HV/MV substation కి వస్తుంది, తర్వాత UPS ద్వారా racks కి వెళ్తుంది.',
      bad: 'ఈ స్లైడ్‌లో డేటా సెంటర్ యొక్క విద్యుత్ మార్గాన్ని పరిశీలిద్దాం.',
      you: 'మీరు',
      check: 'ఇది స్పష్టంగా ఉందా?',
      transliterated: 'డేటా, సెంటర్, ట్రైనింగ్, సెషన్, సర్వర్',
      gendered: false,
    },
    note: languageNote('Telugu'),
  },
  {
    code: 'kn',
    name: 'ಕನ್ನಡ',
    englishName: 'Kannada',
    listen: 'kn',
    sarvam: {
      code: 'kn-IN',
      speakers: [
        female('neha', 'Female. Recommended for Kannada'),
        male('shubh', 'Male. Recommended for Kannada'),
        female('ishita', 'Female. Recommended for Kannada'),
        male('ratan', 'Male. Recommended for Kannada'),
      ],
      sample: 'ನಮಸ್ಕಾರ, ಈ training session ಗೆ ನಿಮಗೆ ಸ್ವಾಗತ. ಯಾವುದೇ ಪ್ರಶ್ನೆ ಇದ್ದರೆ, ಮಧ್ಯದಲ್ಲೇ ಕೇಳಿ.',
    },
    register: {
      good: 'ಈ slide ನಲ್ಲಿ data centre ನ power path ನೋಡೋಣ. Utility ಇಂದ power ಮೊದಲು HV/MV substation ಗೆ ಬರುತ್ತೆ, ಆಮೇಲೆ UPS ಮೂಲಕ racks ಗೆ ಹೋಗುತ್ತೆ.',
      bad: 'ಈ ಸ್ಲೈಡ್‌ನಲ್ಲಿ ದತ್ತಾಂಶ ಕೇಂದ್ರದ ವಿದ್ಯುತ್ ಮಾರ್ಗವನ್ನು ಪರಿಶೀಲಿಸೋಣ.',
      you: 'ನೀವು',
      check: 'ಇದು ಸ್ಪಷ್ಟವಾಗಿದೆಯೇ?',
      transliterated: 'ಡೇಟಾ, ಸೆಂಟರ್, ಟ್ರೈನಿಂಗ್, ಸೆಷನ್, ಸರ್ವರ್',
      gendered: false,
    },
    note: languageNote('Kannada'),
  },
  {
    code: 'ml',
    name: 'മലയാളം',
    englishName: 'Malayalam',
    listen: 'ml',
    sarvam: {
      code: 'ml-IN',
      speakers: [
        female('pooja', 'Female. Recommended for Malayalam'),
        male('shubh', 'Male. Recommended for Malayalam'),
      ],
      sample:
        'നമസ്കാരം, ഈ training session-ലേക്ക് സ്വാഗതം. എന്തെങ്കിലും ചോദ്യമുണ്ടെങ്കിൽ, ഇടയ്ക്ക് തന്നെ ചോദിക്കൂ.',
    },
    register: {
      good: 'ഈ slide-ൽ നമ്മൾ data centre-ന്റെ power path നോക്കാം. Utility-ൽ നിന്ന് power ആദ്യം HV/MV substation-ൽ എത്തും, പിന്നെ UPS വഴി racks-ലേക്ക് പോകും.',
      bad: 'ഈ സ്ലൈഡിൽ ഡാറ്റാ സെന്ററിന്റെ വൈദ്യുത പാത പരിശോധിക്കാം.',
      you: 'നിങ്ങൾ',
      check: 'ഇത് വ്യക്തമാണോ?',
      transliterated: 'ഡാറ്റ, സെന്റർ, ട്രെയിനിംഗ്, സെഷൻ, സെർവർ',
      gendered: false,
    },
    note: languageNote('Malayalam'),
  },
  {
    code: 'bn',
    name: 'বাংলা',
    englishName: 'Bengali',
    listen: 'bn',
    sarvam: {
      code: 'bn-IN',
      speakers: [
        female('roopa', 'Female. Recommended for Bengali'),
        male('rehan', 'Male. Recommended for Bengali'),
        female('suhani', 'Female. Recommended for Bengali'),
      ],
      sample:
        'নমস্কার, এই training session-এ আপনাকে স্বাগত। কোনো প্রশ্ন থাকলে, মাঝখানেই জিজ্ঞেস করবেন।',
    },
    register: {
      good: 'এই slide-এ আমরা data centre-এর power path দেখব। Utility থেকে power প্রথমে HV/MV substation-এ আসে, তারপর UPS হয়ে racks পর্যন্ত পৌঁছায়।',
      bad: 'এই স্লাইডে আমরা ডেটা সেন্টারের বিদ্যুৎ পথ পর্যালোচনা করব।',
      you: 'আপনি',
      check: 'এটা কি পরিষ্কার?',
      transliterated: 'ডেটা, সেন্টার, ট্রেনিং, সেশন, সার্ভার',
      gendered: false,
      sentenceEnd: '।',
    },
    note: languageNote('Bengali'),
  },
  {
    code: 'gu',
    name: 'ગુજરાતી',
    englishName: 'Gujarati',
    listen: 'gu',
    sarvam: {
      code: 'gu-IN',
      speakers: [
        female('priya', 'Female. Recommended for Gujarati'),
        male('ratan', 'Male. Recommended for Gujarati'),
        female('ritu', 'Female. Recommended for Gujarati'),
      ],
      sample:
        'નમસ્તે, આ training session માં તમારું સ્વાગત છે. કોઈ પણ પ્રશ્ન હોય, તો વચ્ચે જ પૂછજો.',
    },
    register: {
      good: 'આ slide પર આપણે data centre નો power path જોઈશું. Utility માંથી power પહેલા HV/MV substation પર આવે છે, પછી UPS થઈને racks સુધી પહોંચે છે.',
      bad: 'આ સ્લાઇડ પર આપણે ડેટા સેન્ટરના વિદ્યુત માર્ગનું અવલોકન કરીશું.',
      you: 'તમે',
      check: 'શું આ સ્પષ્ટ છે?',
      transliterated: 'ડેટા, સેન્ટર, ટ્રેનિંગ, સેશન, સર્વર',
      gendered: true,
    },
    note: languageNote('Gujarati'),
  },
  {
    code: 'ar',
    name: 'العربية',
    englishName: 'Arabic',
    // Plain Arabic, as the OpenAI test page compares it. Nova-3 also takes ar-AE, which
    // may hear UAE trainees better and is worth a run in UAT.
    listen: 'ar',
    openai: {
      voices: OPENAI_SPEAKERS,
      accent: 'Gulf Arabic',
      instructions: SUGGESTED_INSTRUCTIONS.ar,
      // Needs a native speaker's check. "I will accompany you" rather than "I will be your
      // trainer", because مدربكم and مدربتكم would say which voice is speaking.
      sample:
        'مرحبًا، سأرافقكم في هذه الـ training session. إذا كان لديكم أي سؤال، أوقفوني في أي وقت.',
    },
    // Every line needs a native speaker's check. Modern Standard Arabic, kept simple,
    // because that is how Arabic is written in the Gulf as anywhere else; the Gulf accent
    // is the voice's, from its instructions.
    register: {
      good: 'في هذه الـ slide سنرى الـ power path في الـ data centre. تصل الـ power من الـ utility أولًا إلى الـ HV/MV substation، ثم تمر عبر الـ UPS حتى تصل إلى الـ racks.',
      bad: 'في هذه السلايد سنستعرض مسار الطاقة الكهربائية في الداتا سنتر.',
      // The plural of respect, which marks no gender. A singular second-person verb would
      // say whether the trainee is a man or a woman.
      you: 'أنتم',
      check: 'هل هذا واضح؟',
      transliterated: 'سلايد، داتا سنتر، سيرفر، ترينينغ، سيشن',
      gendered: true,
      outsideIndia: {
        country: 'the UAE',
        script: 'arabic',
        self: { feminine: 'أنا سعيدة، أنا متأكدة', masculine: 'أنا سعيد، أنا متأكد' },
      },
    },
    note: languageNote('Arabic'),
  },
  {
    code: 'ms',
    name: 'Bahasa Melayu',
    englishName: 'Malay',
    listen: 'ms',
    openai: {
      voices: OPENAI_SPEAKERS,
      accent: 'Malaysian',
      instructions: SUGGESTED_INSTRUCTIONS.ms,
      // Needs a native speaker's check.
      sample:
        'Helo, saya jurulatih anda untuk training session ini. Kalau ada soalan, jangan segan untuk hentikan saya pada bila-bila masa.',
    },
    // Every line needs a native speaker's check. Malaysian words where Indonesian differs,
    // such as "tengok", so a voice drifting into Indonesian is easier to hear.
    register: {
      good: 'Dalam slide ini kita akan tengok power path sebuah data centre. Power dari utility masuk dulu ke HV/MV substation, kemudian melalui UPS sampai ke racks.',
      bad: 'Dalam slaid ini kita akan meneliti laluan kuasa elektrik di pusat data.',
      you: 'anda',
      check: 'Adakah ini jelas?',
      transliterated: 'slaid, pusat data, pelayan, sesi latihan',
      gendered: false,
      outsideIndia: { country: 'Malaysia', script: 'latin' },
    },
    note: languageNote('Malay'),
  },
  {
    code: 'id',
    name: 'Bahasa Indonesia',
    englishName: 'Indonesian',
    listen: 'id',
    openai: {
      voices: OPENAI_SPEAKERS,
      accent: 'Indonesian',
      instructions: SUGGESTED_INSTRUCTIONS.id,
      // Needs a native speaker's check.
      sample:
        'Halo, saya akan menjadi trainer Anda untuk training session ini. Kalau ada pertanyaan, silakan hentikan saya kapan saja.',
    },
    // Every line needs a native speaker's check.
    register: {
      good: 'Di slide ini kita akan melihat power path sebuah data centre. Power dari utility masuk dulu ke HV/MV substation, lalu lewat UPS sampai ke racks.',
      bad: 'Pada salindia ini kita akan menelaah jalur daya listrik pada pusat data.',
      // Not Bapak or Ibu, which a trainer says to somebody whose gender they know.
      you: 'Anda',
      check: 'Apakah ini sudah jelas?',
      transliterated: 'salindia, pusat data, peladen, sesi pelatihan',
      gendered: false,
      outsideIndia: { country: 'Indonesia', script: 'latin' },
    },
    note: languageNote('Indonesian'),
  },
  {
    // `tl`, as the OpenAI test page has it: OpenAI, Whisper and Deepgram all know
    // Filipino as Tagalog.
    code: 'tl',
    name: 'Filipino',
    englishName: 'Filipino',
    listen: 'tl',
    openai: {
      voices: OPENAI_SPEAKERS,
      accent: 'Filipino',
      instructions: SUGGESTED_INSTRUCTIONS.tl,
      // Needs a native speaker's check. Taglish, as a trainer in Manila would say it.
      sample:
        'Hello, ako ang magiging trainer ninyo para sa training session na ito. Kung may tanong kayo, huwag po kayong mahiyang pigilan ako anumang oras.',
    },
    // Every line needs a native speaker's check.
    register: {
      good: 'Sa slide na ito, titingnan natin ang power path ng isang data centre. Galing sa utility, dumadaan muna ang power sa HV/MV substation, tapos sa UPS, bago umabot sa racks.',
      bad: 'Sa islayd na ito, susuriin natin ang daanan ng kuryente sa sentro ng datos.',
      // With po, the respect a trainer shows anybody, which marks no gender.
      you: 'kayo',
      check: 'Malinaw po ba ito?',
      transliterated: 'islayd, sentro ng datos, serbidor, sesyon ng pagsasanay',
      gendered: false,
      outsideIndia: { country: 'the Philippines', script: 'latin' },
    },
    note: languageNote('Filipino'),
  },
  {
    code: 'vi',
    name: 'Tiếng Việt',
    englishName: 'Vietnamese',
    listen: 'vi',
    openai: {
      voices: OPENAI_SPEAKERS,
      // Northern, the accent of Hanoi and of national broadcasting, as the test page asks
      // for. A customer in Ho Chi Minh City may prefer the Southern one.
      accent: 'Northern Vietnamese',
      instructions: SUGGESTED_INSTRUCTIONS.vi,
      // Needs a native speaker's check.
      sample:
        'Xin chào, tôi là giảng viên của bạn trong training session này. Nếu có câu hỏi, bạn cứ ngắt lời tôi bất cứ lúc nào nhé.',
    },
    // Every line needs a native speaker's check. "Điện" in the second sentence, because it
    // is the everyday word for power; "power path" is the term.
    register: {
      good: 'Trong slide này, chúng ta sẽ xem power path của một data centre. Điện từ utility vào HV/MV substation trước, sau đó qua UPS rồi mới đến các racks.',
      bad: 'Trong trang trình chiếu này, chúng ta sẽ phân tích đường dẫn năng lượng điện của trung tâm dữ liệu.',
      // Not anh or chị, which say whether the trainee is a man or a woman, and how old.
      you: 'bạn',
      check: 'Phần này đã rõ chưa?',
      transliterated: 'trang trình chiếu, trung tâm dữ liệu, máy chủ, buổi đào tạo',
      gendered: false,
      outsideIndia: { country: 'Vietnam', script: 'latin', me: 'tôi' },
    },
    note: languageNote('Vietnamese'),
  },
];

export const LANGUAGE_CODES = LANGUAGES.map((language) => language.code);

export function languageInfo(code: SessionLanguage): LanguageInfo {
  return LANGUAGES.find((language) => language.code === code) ?? LANGUAGES[0]!;
}

export function isSessionLanguage(raw: unknown): raw is SessionLanguage {
  return typeof raw === 'string' && (LANGUAGE_CODES as readonly string[]).includes(raw);
}

/** English, as opposed to English with an Indian voice or another language. */
export function isPlainEnglish(code: SessionLanguage): boolean {
  return code === 'en';
}

/** Whether Sarvam speaks this language, and so whether it draws on the Sarvam credit. */
export function spokenBySarvam(code: SessionLanguage): boolean {
  return languageInfo(code).sarvam !== undefined;
}

/**
 * Whether speech in this language is synthesised just ahead of playback rather than as
 * fast as the text arrives.
 *
 * Every Sarvam language, because Sarvam bills every character from a small prepaid
 * credit, heard or not, and its starter plan allows thirty requests a minute. Nothing
 * else: Deepgram's English and OpenAI's languages are billed as they are used, with
 * limits a session comes nowhere near, so they fetch ahead and a slow sentence is not
 * heard as a gap. An interruption there wastes at most the sentences fetched ahead.
 */
export function pacedToPlayback(code: SessionLanguage): boolean {
  return spokenBySarvam(code);
}
