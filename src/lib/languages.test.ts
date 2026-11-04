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

const withSarvam = (run: () => void, everyone?: string) =>
  withEnv({ SARVAM_API_KEY: 'test-key', LANGUAGES_FOR_EVERYONE: everyone }, run);

const staff = { platform: false, homeOrgId: 'technavious' };
const customer = { platform: false, homeOrgId: 'acme' };
const codes = (list: readonly { code: string }[]) => list.map((language) => language.code);

describe('the language registry', () => {
  it('has English first, then Indian English, Hindi and seven Indian languages', () => {
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
    ]);
  });

  it('speaks every language but English through Sarvam, paced to playback', () => {
    for (const language of LANGUAGES) {
      assert.equal(pacedToPlayback(language.code), language.code !== 'en', language.code);
    }
  });

  it('gives every Indian language its register, and writes English terms in English', () => {
    for (const language of LANGUAGES.filter(
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

  it('listens in code-switching mode for every Indian language, as for Hindi', () => {
    assert.equal(listeningLanguage('en'), 'en');
    assert.equal(listeningLanguage('en-IN'), 'en-IN');
    for (const code of ['hi', 'mr', 'ta', 'te', 'kn', 'ml', 'bn', 'gu'] as SessionLanguage[]) {
      assert.equal(listeningLanguage(code), 'multi', code);
    }
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
      assert.equal(languagesFor(staff).length, LANGUAGES.length);
      assert.equal(languagesFor({ platform: true, homeOrgId: 'acme' }).length, LANGUAGES.length);
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
