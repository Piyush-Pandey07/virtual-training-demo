import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getSlide } from './deck';
import { ISMS_DECK } from './decks/isms';
import { listeningLanguage, sessionLanguage } from './language';
import { LANGUAGES, languageInfo, pacedToPlayback } from './languages';
import { buildSystemInstruction, buildTurnPrompt } from './trainer-prompt';
import type { SessionLanguage } from './types';
import { canSpeak, languagesFor, speaksAsFor, voiceCatalogue, voiceFor } from './voice/catalogue';

/**
 * The languages beyond English and Hindi: Indian English, Marathi, Tamil, Telugu,
 * Kannada, Malayalam, Bengali and Gujarati, all spoken by Sarvam (BRD, November 2026).
 * Arabic, Malay, Indonesian, Filipino and Vietnamese, spoken by OpenAI, are tested in
 * openai-languages.test.ts.
 */

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const before = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    run();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** Sarvam's languages only: the OpenAI ones have their own tests, in openai-languages. */
const withSarvam = (run: () => void, everyone?: string) =>
  withEnv(
    { SARVAM_API_KEY: 'test-key', OPENAI_API_KEY: undefined, LANGUAGES_FOR_EVERYONE: everyone },
    run,
  );

const SARVAM_LANGUAGES = LANGUAGES.filter((language) => language.sarvam);

const staff = { platform: false, homeOrgId: 'technavious' };
const customer = { platform: false, homeOrgId: 'acme' };
const codes = (list: readonly { code: string }[]) => list.map((language) => language.code);

describe('the language registry', () => {
  it('has English first, then Indian English, Hindi, seven Indian languages and five more', () => {
    assert.deepEqual(codes(LANGUAGES), [
      'en',
      'en-IN',
      'hi',
      'mr',
      'ta',
      'te',
      'kn',
      'ml',
      'bn',
      'gu',
      'ar',
      'ms',
      'id',
      'tl',
      'vi',
    ]);
  });

  it('speaks the Indian languages through Sarvam, paced to playback, and nothing else', () => {
    const openai = ['ar', 'ms', 'id', 'tl', 'vi'];
    for (const language of LANGUAGES) {
      const paced = language.code !== 'en' && !openai.includes(language.code);
      assert.equal(pacedToPlayback(language.code), paced, language.code);
      assert.equal(Boolean(language.sarvam), paced, language.code);
      assert.equal(Boolean(language.openai), openai.includes(language.code), language.code);
    }
  });

  it('gives every Indian language its register, and writes English terms in English', () => {
    for (const language of SARVAM_LANGUAGES.filter(
      (entry) => !['en', 'en-IN', 'hi'].includes(entry.code),
    )) {
      const register = language.register;
      assert.ok(register, language.code);
      for (const term of ['slide', 'data centre', 'HV/MV', 'UPS']) {
        assert.ok(register.good.includes(term), `${language.code} register lacks ${term}`);
      }
      assert.ok(language.sarvam!.sample.includes('training session'), language.code);
      assert.doesNotMatch(JSON.stringify(language), /—/, `${language.code} has an em dash`);
    }
  });

  it('listens to Hindi in code-switching mode and the others in their own model', () => {
    assert.equal(listeningLanguage('en'), 'en');
    assert.equal(listeningLanguage('en-IN'), 'en-IN');
    assert.equal(listeningLanguage('hi'), 'multi');
    // Code-switching wrote Malayalam in Telugu script on production.
    for (const code of ['mr', 'ta', 'te', 'kn', 'ml', 'bn', 'gu'] as SessionLanguage[]) {
      assert.equal(listeningLanguage(code), code, code);
    }
  });

  it("names the transliterations each language must avoid, in that language's script", () => {
    const marathi = languageInfo('mr').register!.transliterated;
    assert.ok(marathi.includes('डेटा') && marathi.includes('ट्रेनिंग'));
    assert.ok(languageInfo('ml').register!.transliterated.includes('ഡാറ്റ'));
  });

  it('treats anything unknown as English', () => {
    assert.equal(sessionLanguage('ta'), 'ta');
    assert.equal(sessionLanguage('xx'), 'en');
    assert.equal(sessionLanguage(undefined), 'en');
  });
});

describe('who is offered which language', () => {
  it('offers only English without a Sarvam key', () => {
    withEnv({ SARVAM_API_KEY: undefined }, () => {
      assert.deepEqual(codes(languagesFor(staff)), ['en']);
    });
  });

  it('offers a customer English and Hindi by default, and Technavious everything', () => {
    withSarvam(() => {
      assert.deepEqual(codes(languagesFor(customer)), ['en', 'hi']);
      // Everything Sarvam speaks, and English. The OpenAI languages need OpenAI's key.
      assert.equal(languagesFor(staff).length, SARVAM_LANGUAGES.length + 1);
      assert.equal(
        languagesFor({ platform: true, homeOrgId: 'acme' }).length,
        SARVAM_LANGUAGES.length + 1,
      );
    });
  });

  it('offers a language to everyone once it is listed', () => {
    withSarvam(() => {
      assert.deepEqual(codes(languagesFor(customer)), ['en', 'hi', 'mr', 'ta', 'te']);
    }, 'en,hi,mr,ta,te');
  });

  it('marks a language still in testing in the catalogue', () => {
    withSarvam(() => {
      const listed = voiceCatalogue(staff).languages;
      assert.equal(listed.find((language) => language.code === 'hi')!.testing, undefined);
      assert.equal(listed.find((language) => language.code === 'ta')!.testing, true);
    });
  });

  it("refuses a testing language's voice to a customer, on the server", () => {
    withSarvam(() => {
      assert.equal(voiceFor('sarvam-ta-ishita', customer), null);
      assert.deepEqual(voiceFor('sarvam-ta-ishita', staff), {
        provider: 'sarvam',
        model: 'ishita',
        languageCode: 'ta-IN',
      });
    });
  });

  it('keeps every Hindi voice id it had', () => {
    withSarvam(() => {
      for (const id of [
        'sarvam-hi-priya',
        'sarvam-hi-shubh',
        'sarvam-hi-suhani',
        'sarvam-hi-ashutosh',
      ]) {
        assert.ok(voiceFor(id, customer), id);
      }
    });
  });

  it('uses the speakers Sarvam recommends for each language', () => {
    withSarvam(() => {
      const tamil = voiceCatalogue(staff).languages.find((language) => language.code === 'ta')!;
      assert.deepEqual(
        tamil.voices.map((voice) => voice.name),
        ['Ishita', 'Ratan', 'Ritu', 'Rohan'],
      );
      assert.equal(speaksAsFor('sarvam-mr-ratan', staff), 'masculine');
    });
  });
});

describe('the trainer speaking each language', () => {
  const deck = ISMS_DECK;
  const instruction = (language: SessionLanguage, voice?: string) =>
    withValue(() =>
      buildSystemInstruction(deck, 'Asha', {
        language,
        speaksAs: voice ? speaksAsFor(voice, staff) : undefined,
      }),
    );
  let captured = '';
  function withValue(run: () => string): string {
    withSarvam(() => {
      captured = run();
    });
    return captured;
  }

  it('teaches Tamil in Tamil, with the register and English terms kept', () => {
    const text = instruction('ta');
    assert.match(text, /SPEAK TAMIL/);
    assert.ok(text.includes(languageInfo('ta').register!.good));
    assert.match(text, /Address them as நீங்கள்/);
    assert.doesNotMatch(text, /woman's|man's/, 'Tamil verbs do not mark the speaker');
  });

  it('agrees Marathi verbs with the voice', () => {
    assert.match(instruction('mr', 'sarvam-mr-priya'), /Your voice in this session is a woman's/);
    assert.match(instruction('mr', 'sarvam-mr-ratan'), /Your voice in this session is a man's/);
  });

  it('teaches Indian English exactly as English', () => {
    assert.equal(instruction('en-IN'), buildSystemInstruction(deck, 'Asha'));
  });

  it('closes every Telugu turn with the reminder', () => {
    const turn = buildTurnPrompt({
      deck,
      kind: 'narrate',
      slide: getSlide(deck, 2)!,
      history: [],
      coveredSlideIds: [],
      language: 'te',
    });
    assert.match(turn, /IN TELUGU\nSay all of this in everyday spoken Telugu/);
  });
});

describe('an English voice handed another script', () => {
  const english = { provider: 'deepgram' as const, model: 'aura-2-thalia-en' };

  it('refuses mostly Tamil, Telugu or Bengali text, as it did Hindi', () => {
    assert.equal(
      canSpeak(english, languageInfo('ta').sarvam!.sample.replace('training session', '')),
      false,
    );
    assert.equal(canSpeak(english, languageInfo('te').sarvam!.sample), false);
    assert.equal(canSpeak(english, languageInfo('bn').sarvam!.sample), false);
  });

  it('still says English with a name in another script', () => {
    assert.equal(canSpeak(english, 'Welcome to the session, ராஜா.'), true);
  });
});
