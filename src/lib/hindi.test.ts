import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { getSlide } from './deck';
import { ISMS_DECK } from './decks/isms';
import { classifyUtterance, isNavigationOnly } from './intent';
import { listeningLanguage, sessionLanguage } from './language';
import { MAX_CHUNK_CHARS, MIN_CHUNK_CHARS, nextSpeechCut } from './speech';
import { closingSentence } from './trainee-read';
import { buildSystemInstruction, buildTurnPrompt } from './trainer-prompt';

/**
 * Hindi sessions, end to end, short of the voice itself.
 *
 * Asked for on 6 October: Sarvam for Hindi only, and every other language exactly as it
 * is on Deepgram. The voice and its provider are covered in voice/; this is everything
 * else a session has to do differently to be held in Hindi, and the English behaviour
 * each change must leave alone.
 */

const deck = ISMS_DECK;
const slide = getSlide(deck, 1)!;
const PLAYER = readFileSync('src/hooks/useTtsPlayer.ts', 'utf8');
const SPEECH_INPUT = readFileSync('src/hooks/useSpeechInput.ts', 'utf8');
const STT_ROUTE = readFileSync('src/app/api/stt/route.ts', 'utf8');
const CHAT_ROUTE = readFileSync('src/app/api/chat/route.ts', 'utf8');
const SCREEN = readFileSync('src/app/session/SessionScreen.tsx', 'utf8');

/** One hook-level function, from its declaration to the next. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `could not find ${name}`);
  const end = source.indexOf('\n  const ', start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

describe('the session language', () => {
  it('is Hindi only when asked for exactly, and English otherwise', () => {
    assert.equal(sessionLanguage('hi'), 'hi');
    for (const other of ['en', 'HI', 'hindi', 'hi-IN', '', undefined, null, 1, {}]) {
      assert.equal(sessionLanguage(other), 'en', JSON.stringify(other));
    }
  });

  it('listens for Hindi mixed with English, and for English exactly as before', () => {
    assert.equal(listeningLanguage('en'), 'en');
    assert.equal(listeningLanguage('hi'), 'multi');
  });

  it('is chosen on the lobby and handed to the session as it starts', () => {
    assert.match(SCREEN, /onStart\(name, voice \?\? undefined, language\)/);
    assert.match(SCREEN, /session\.startSession\(name, voice, language\)/);
  });
});

describe('what the trainer is told', () => {
  it('leaves an English session exactly as it was', () => {
    const before = buildSystemInstruction(deck, 'Asha');
    assert.equal(buildSystemInstruction(deck, 'Asha', { language: 'en' }), before);
    assert.doesNotMatch(before, /SPEAK HINDI|Devanagari/);

    const args = { deck, kind: 'narrate' as const, slide, history: [], coveredSlideIds: [] };
    assert.equal(buildTurnPrompt({ ...args, language: 'en' }), buildTurnPrompt(args));
    assert.doesNotMatch(buildTurnPrompt(args), /IN HINDI/);
  });

  it('tells a Hindi session to speak Hindi, early, before everything else about manner', () => {
    const instruction = buildSystemInstruction(deck, undefined, { language: 'hi' });
    const hindi = instruction.indexOf('SPEAK HINDI');
    assert.ok(hindi > 0, 'no Hindi instruction');
    assert.ok(hindi < instruction.indexOf('WHO YOU ARE IN THE ROOM'), 'Hindi comes too late');
  });

  it('writes for the voice: Devanagari for Hindi, English letters for English terms', () => {
    const instruction = buildSystemInstruction(deck, undefined, { language: 'hi' });
    assert.match(
      instruction,
      /Write Hindi words in Devanagari and English words in English letters/,
    );
    assert.match(instruction, /Keep technical terms, acronyms/);
    assert.match(instruction, /with ।/);
  });

  it('agrees with the voice: a woman speaks as a woman, a man as a man', () => {
    const woman = buildSystemInstruction(deck, undefined, { language: 'hi', speaksAs: 'feminine' });
    assert.match(woman, /मैं बताती हूँ/);
    assert.doesNotMatch(woman, /मैं बताता हूँ/);

    const man = buildSystemInstruction(deck, undefined, { language: 'hi', speaksAs: 'masculine' });
    assert.match(man, /मैं बताता हूँ/);
    assert.doesNotMatch(man, /मैं बताती हूँ/);

    // Not knowing, it avoids the question rather than guessing.
    const unknown = buildSystemInstruction(deck, undefined, { language: 'hi' });
    assert.doesNotMatch(unknown, /मैं बताती हूँ|मैं बताता हूँ/);
    assert.match(unknown, /हम देखते हैं/);
  });

  it("never assumes the trainee's gender", () => {
    const instruction = buildSystemInstruction(deck, undefined, {
      language: 'hi',
      speaksAs: 'masculine',
    });
    assert.match(instruction, /You do not know the trainee's gender/);
  });

  it('closes every Hindi turn with the reminder, where the reply is written', () => {
    for (const kind of ['narrate', 'answer', 'quiz', 'recap'] as const) {
      const prompt = buildTurnPrompt({
        deck,
        kind,
        slide,
        history: [],
        coveredSlideIds: [1],
        question: kind === 'answer' ? 'UPS क्या होता है?' : undefined,
        language: 'hi',
      });
      assert.ok(
        prompt.trimEnd().endsWith('Any example above is in English only to show its shape.'),
        kind,
      );
    }
  });

  it('is told by the chat route, with the voice it is speaking in', () => {
    assert.match(CHAT_ROUTE, /const language = sessionLanguage\(body\.language\);/);
    assert.match(
      CHAT_ROUTE,
      /const speaksAs = language === 'hi' \? speaksAsFor\(body\.voice\) : undefined;/,
    );
    assert.match(
      CHAT_ROUTE,
      /buildSystemInstruction\(deck, traineeName, \{ language, speaksAs \}\)/,
    );
    assert.match(CHAT_ROUTE, /coveredSlideIds,\s*learner,\s*language,\s*\}\)/);
  });

  it('counts Hindi on its own line, for the Sarvam credit', () => {
    assert.match(CHAT_ROUTE, /hindiCharacters: language === 'hi' \? finalText\.length : 0,/);
  });
});

describe('cutting Hindi into sentences to speak', () => {
  const first = 'आज हम data centre की power के बारे में बात करेंगे, जो हर site की नींव होती है।';
  const second = ' फिर हम UPS को देखेंगे।';

  it('ends a sentence at a danda', () => {
    assert.ok(first.length >= MIN_CHUNK_CHARS, 'the fixture is too short to test anything');
    assert.equal(nextSpeechCut(first + second), first.length);
  });

  it('waits at a danda the stream may not have finished with yet', () => {
    // Exactly as at a full stop: without the space after it, the next words may still
    // belong to the same sentence.
    assert.equal(nextSpeechCut(first), -1);
  });

  it('cuts English exactly where it always did', () => {
    const english = 'This is an English sentence that is comfortably long enough to cut. And more.';
    assert.equal(nextSpeechCut(english), english.indexOf('.') + 1);
    assert.equal(nextSpeechCut('Too short. To cut.'), -1);
  });

  it('never cuts inside a word, even with nothing else to cut at', () => {
    // A cut inside a Devanagari word can part a consonant from its vowel sign, which
    // the voice then reads as two different sounds.
    const run = 'नमस्ते '.repeat(60);
    const cut = nextSpeechCut(run);
    assert.ok(cut > MIN_CHUNK_CHARS && cut <= MAX_CHUNK_CHARS, `cut at ${cut}`);
    assert.equal(run[cut], ' ', 'cut inside a word');
  });

  it('still prefers a comma to a space when a clause runs long', () => {
    const clause = `${'शब्द '.repeat(30)}, ${'शब्द '.repeat(40)}`;
    assert.equal(nextSpeechCut(clause), clause.indexOf(', ') + 1);
  });

  it('is the cut the player uses', () => {
    assert.match(bodyOf(PLAYER, 'drain'), /const cut = nextSpeechCut\(buffer\);/);
  });
});

describe('asking Sarvam only for what is about to be heard', () => {
  it('waits for room before synthesising Hindi, and only Hindi', () => {
    const speak = bodyOf(PLAYER, 'speakChunk');
    const wait = speak.indexOf("if (languageRef.current === 'hi') {");
    assert.ok(wait > 0, 'Hindi is synthesised without waiting');
    assert.match(
      speak.slice(wait),
      /^if \(languageRef\.current === 'hi'\) \{\s*await waitForRoom\(generation\);/,
    );
    assert.ok(wait < speak.indexOf("fetch('/api/tts'"), 'the wait comes after the request');
  });

  it('stops waiting the moment the trainee interrupts', () => {
    const wait = bodyOf(PLAYER, 'waitForRoom');
    assert.match(wait, /if \(generation !== generationRef\.current\) return;/);
    // And the chunk is dropped rather than synthesised after the wait.
    assert.match(
      bodyOf(PLAYER, 'speakChunk'),
      /await waitForRoom\(generation\);\s*if \(generation !== generationRef\.current\) return;/,
    );
  });
});

describe('a closing line in Hindi', () => {
  it('is the last sentence, not the whole turn', () => {
    // Otherwise the whole of a Hindi turn is quoted back to the trainer as the closing
    // it must not reuse.
    assert.equal(
      closingSentence(
        'पहले हम UPS देखेंगे। फिर batteries की बात करेंगे। आपको इनमें से कौन-सा ज़्यादा ज़रूरी लगता है?',
      ),
      'आपको इनमें से कौन-सा ज़्यादा ज़रूरी लगता है?',
    );
    assert.equal(closingSentence('That is the first part. Shall we go on?'), 'Shall we go on?');
  });
});

describe('listening in a Hindi session', () => {
  it('tells the live socket the language, from the session', () => {
    assert.match(
      SPEECH_INPUT,
      /url\.searchParams\.set\('language', listeningLanguage\(languageRef\.current\)\);/,
    );
  });

  it('tells the fallback route too, which narrows it', () => {
    assert.match(SPEECH_INPUT, /fetch\(`\/api\/stt\?language=\$\{languageRef\.current\}`/);
    assert.match(
      STT_ROUTE,
      /sessionLanguage\(new URL\(request\.url\)\.searchParams\.get\('language'\)\)/,
    );
    assert.match(STT_ROUTE, /url\.searchParams\.set\('language', listeningLanguage\(language\)\);/);
  });
});

describe('moving through the deck by saying so in Hindi', () => {
  const cases: Array<[string, ReturnType<typeof classifyUtterance>]> = [
    ['अगली स्लाइड', 'advance'],
    ['अगली स्लाइड पर चलिए', 'advance'],
    ['अगले slide पर चलते हैं', 'advance'],
    ['आगे बढ़िए', 'advance'],
    ['ठीक है, आगे बढ़ते हैं', 'advance'],
    ['हाँ जी, आगे चलिए', 'advance'],
    ['जारी रखिए', 'advance'],
    ['कोई सवाल नहीं', 'advance'],
    ['कोई doubt नहीं है', 'advance'],
    ['समझ गया', 'advance'],
    ['समझ आ गया', 'advance'],
    // English inside Hindi, as the code-switching transcript writes it.
    ['next slide पर चलिए', 'advance'],

    ['पिछली स्लाइड', 'back'],
    ['पीछे जाइए', 'back'],
    ['पिछली स्लाइड पर चलिए', 'back'],

    ['फिर से बताइए', 'repeat'],
    ['दोबारा समझाइए', 'repeat'],
    ['इसे फिर से बताइए', 'repeat'],
    ['एक बार और बताइए', 'repeat'],
    ['फिर से बोल दीजिए', 'repeat'],

    // Questions stay questions.
    ['UPS क्या होता है', 'question'],
    ['UPS को फिर से समझाइए', 'question'],
    ['इसके पीछे क्या logic है', 'question'],
    ['समझ नहीं आया', 'question'],
    ['क्या आप दोबारा बता सकते हैं?', 'question'],
    // And so does asking not to move.
    ['आगे मत बढ़िए', 'question'],
    ['आगे बढ़ने से पहले एक सवाल', 'question'],
    ['रुकिए', 'question'],
    ['अभी नहीं', 'question'],
  ];

  for (const [said, expected] of cases) {
    it(`reads "${said}" as ${expected}`, () => {
      assert.equal(classifyUtterance(said), expected);
    });
  }

  it('reads a letter with a nukta the same whichever way it was encoded', () => {
    const precomposed = 'आगे बढ़िए';
    const decomposed = 'आगे बढ़िए';
    assert.notEqual(precomposed, decomposed);
    assert.equal(classifyUtterance(precomposed), 'advance');
    assert.equal(classifyUtterance(decomposed), 'advance');
  });

  it('lets the server move the deck for a Hindi request that reached the answer path', () => {
    assert.equal(isNavigationOnly('अगली स्लाइड पर चलिए'), true);
    assert.equal(isNavigationOnly('UPS क्या होता है'), false);
  });

  it('leaves English exactly as it was', () => {
    assert.equal(classifyUtterance('next slide'), 'advance');
    assert.equal(classifyUtterance("I'm not ready"), 'question');
    assert.equal(classifyUtterance('go back'), 'back');
    assert.equal(classifyUtterance('say that again'), 'repeat');
    assert.equal(classifyUtterance('what is phishing'), 'question');
  });
});
