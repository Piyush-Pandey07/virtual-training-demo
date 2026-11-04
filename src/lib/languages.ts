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
 * A language is offered to every trainee only once somebody who speaks it has checked
 * it. Until then it is offered to Technavious staff, for UAT. See `languagesFor`.
 */

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
  /** Whether a speaker's own verbs mark their gender, as in Hindi and Marathi. */
  gendered: boolean;
  /** Ends a sentence that finishes in the language, where that is not a full stop. */
  sentenceEnd?: '।';
}

export interface LanguageInfo {
  code: SessionLanguage;
  /** In its own script, which is what a speaker of it looks for. */
  name: string;
  /** The same in English, for everybody else. */
  englishName: string;
  /** What Deepgram is told: code-switching where people mix English in. */
  listen: string;
  /** Spoken by Sarvam, from prepaid credit, so synthesised just ahead of playback. */
  sarvam?: { code: SarvamLanguageCode; speakers: readonly SarvamSpeaker[]; sample: string };
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

const indianNote = (name: string) =>
  `The trainer will teach and answer in ${name}, keeping technical terms in English. The slides stay in English. Speak ${name}, English or a mix of the two.`;

/**
 * In the order the picker shows them. English first and always.
 *
 * The register examples say the same thing in each language, the power path sentence the
 * Hindi block uses, so a reviewer comparing languages compares like with like. Every
 * non-Hindi line here needs a native speaker's check before its language goes to
 * everyone: that check is what `LANGUAGES_FOR_EVERYONE` records.
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
    listen: 'multi',
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
      good: 'या slide वर आपण data centre चा power path पाहणार आहोत. Utility कडून power आधी HV/MV substation ला येते, मग UPS मधून racks पर्यंत पोहोचते.',
      bad: 'या स्लाइडवर आपण डेटा सेंटरच्या विद्युत मार्गाचे अवलोकन करू.',
      you: 'तुम्ही',
      check: 'हे स्पष्ट आहे का?',
      gendered: true,
    },
    note: indianNote('Marathi'),
  },
  {
    code: 'ta',
    name: 'தமிழ்',
    englishName: 'Tamil',
    listen: 'multi',
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
      gendered: false,
    },
    note: indianNote('Tamil'),
  },
  {
    code: 'te',
    name: 'తెలుగు',
    englishName: 'Telugu',
    listen: 'multi',
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
      gendered: false,
    },
    note: indianNote('Telugu'),
  },
  {
    code: 'kn',
    name: 'ಕನ್ನಡ',
    englishName: 'Kannada',
    listen: 'multi',
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
      gendered: false,
    },
    note: indianNote('Kannada'),
  },
  {
    code: 'ml',
    name: 'മലയാളം',
    englishName: 'Malayalam',
    listen: 'multi',
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
      gendered: false,
    },
    note: indianNote('Malayalam'),
  },
  {
    code: 'bn',
    name: 'বাংলা',
    englishName: 'Bengali',
    listen: 'multi',
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
      gendered: false,
      sentenceEnd: '।',
    },
    note: indianNote('Bengali'),
  },
  {
    code: 'gu',
    name: 'ગુજરાતી',
    englishName: 'Gujarati',
    listen: 'multi',
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
      gendered: true,
    },
    note: indianNote('Gujarati'),
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

/**
 * Whether speech in this language comes from prepaid credit, and so is synthesised just
 * ahead of playback rather than as fast as the text arrives. Every Sarvam language.
 */
export function pacedToPlayback(code: SessionLanguage): boolean {
  return languageInfo(code).sarvam !== undefined;
}
