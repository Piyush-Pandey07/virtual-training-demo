import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { DeckRecord, DeckSlide } from '../deck-types';
import { ISMS_DECK } from '../decks/isms';
import { buildFacilitatedTurnPrompt, buildTurnPrompt } from '../trainer-prompt';
import { GLOSSARY } from './entries';
import {
  MAX_TERMS_PER_TURN,
  definitionsAsked,
  keytermsFor,
  renderGlossary,
  termsForTurn,
  termsIn,
  usesGlossary,
} from './index';

/**
 * The Benchmark team's data centre glossary, and when the trainer is given it (AI-21).
 */

const byId = (id: string) => {
  const entry = GLOSSARY.find((candidate) => candidate.id === id);
  assert.ok(entry, `no entry ${id}`);
  return entry;
};

/** A small data centre deck, built from the ISMS deck's shape with data centre words. */
function dcDeck(slides: Array<Partial<DeckSlide>>): DeckRecord {
  const base = ISMS_DECK.slides[1]!;
  return {
    meta: { ...ISMS_DECK.meta, id: `dc-${slides.length}`, title: 'Power and Cooling Basics' },
    topics: [],
    slides: slides.map((slide, index) => ({
      ...base,
      id: index + 1,
      bullets: [],
      speakerNotes: [],
      internalNotes: [],
      keyPoints: [],
      discussionPrompts: [],
      narrationBrief: '',
      summary: '',
      ...slide,
    })),
  };
}

const POWER = dcDeck([
  {
    title: 'Keeping the load up',
    bullets: ['UPS and generator', 'Automatic Transfer Switch', 'N+1 and 2N redundancy'],
    speakerNotes: ['Walk through the PDU and the RPP, then LOTO before any work.'],
  },
  {
    title: 'Cooling',
    bullets: ['CRAH units fed by the chiller', 'Hot aisle containment', 'Fiber to the MMR'],
  },
]);

describe('the imported glossary', () => {
  it('has every term once', () => {
    assert.ok(GLOSSARY.length > 250, `only ${GLOSSARY.length} entries`);
    assert.equal(new Set(GLOSSARY.map((entry) => entry.id)).size, GLOSSARY.length);
  });

  it('merges a term that appears in more than one section, keeping the specialist wording', () => {
    const ups = byId('uninterruptible-power-supply');
    assert.equal(ups.section, 'electrical');
    assert.match(ups.definition, /conditioned power/);
    assert.equal(GLOSSARY.filter((entry) => entry.acronym === 'UPS').length, 1);
    assert.equal(GLOSSARY.filter((entry) => /^Commissioning$/.test(entry.term)).length, 1);
  });

  it('keeps the two kinds of thermal runaway apart', () => {
    assert.equal(byId('thermal-runaway').section, 'electrical');
    assert.equal(byId('thermal-runaway-cooling').section, 'mechanical');
  });

  it('corrects HAD to the Horizontal Distribution Area, HDA', () => {
    assert.equal(byId('horizontal-distribution-area').acronym, 'HDA');
    assert.ok(!GLOSSARY.some((entry) => entry.acronym === 'HAD'));
  });

  it('holds back definitions that need their owners to confirm them', () => {
    const held = GLOSSARY.filter((entry) => entry.held).map((entry) => entry.term);
    for (const term of ['Thermal Energy Storage', 'DC Shock', 'Tier I', 'Tier IV']) {
      assert.ok(held.includes(term), `${term} is not held`);
    }
    const text = 'Thermal Energy Storage keeps the load cool. Tier IV is the top tier.';
    assert.deepEqual(
      termsIn(text, { includeWeak: true }).map((entry) => entry.id),
      [],
      'a held definition reached the trainer',
    );
  });

  it('is written in British English, with no em dashes', () => {
    const all = JSON.stringify(GLOSSARY);
    assert.doesNotMatch(all, /—/);
    assert.doesNotMatch(all, /\b(center|fiber|standardized|localized)\b/i);
  });

  it('never records an acronym that means something else here', () => {
    for (const ambiguous of ['DC', 'IT', 'N', 'AC']) {
      assert.ok(!GLOSSARY.some((entry) => entry.acronym === ambiguous), ambiguous);
    }
  });
});

describe('finding terms in text', () => {
  const ids = (text: string, includeWeak = false) =>
    termsIn(text, { includeWeak }).map((entry) => entry.id);

  it('matches acronyms only as written, in capitals', () => {
    assert.ok(ids('The UPS carries the load.').includes('uninterruptible-power-supply'));
    assert.ok(!ids('Things went ups and downs.').includes('uninterruptible-power-supply'));
    assert.ok(!ids('Too much fat in the diet.').includes('factory-acceptance-test'));
  });

  it('takes a plural acronym', () => {
    assert.ok(ids('Two CRAHs failed.').includes('computer-room-air-handler'));
  });

  it('treats N+1 and 2N as whole codes', () => {
    assert.ok(ids('Designed to N+1.').includes('n-plus-1'));
    assert.ok(!ids('Designed to N+10.').includes('n-plus-1'));
    assert.ok(ids('A 2N design.').includes('2n'));
  });

  it('accepts American and British spellings alike', () => {
    assert.ok(ids('single mode fiber').includes('single-mode-fibre'));
    assert.ok(ids('Single Mode Fibre').includes('single-mode-fibre'));
    assert.ok(ids('an edge data center').includes('edge-data-centre'));
  });

  it('counts an ordinary single word only when asked to', () => {
    assert.ok(!ids('the server room').includes('server'));
    assert.ok(ids('the server room', true).includes('server'));
  });
});

describe('which decks get the glossary', () => {
  it('a data centre deck does, by its title or by the terms its slides use', () => {
    const few = dcDeck([{ title: 'Keeping the load up', bullets: ['UPS and generator'] }]);
    assert.equal(usesGlossary(few), false, 'one acronym is not enough without the title');
    const named = {
      ...few,
      meta: { ...few.meta, id: 'few-named', title: 'Introduction to Data Centers' },
    };
    assert.equal(usesGlossary(named), true);
    assert.equal(usesGlossary(POWER), true, 'a deck full of data centre terms is one');
  });

  it('the ISMS deck does not, though it uses words the glossary defines', () => {
    // Access control, monitoring, incident management: all mean something else there.
    assert.equal(usesGlossary(ISMS_DECK), false);
    for (const slide of ISMS_DECK.slides) {
      assert.deepEqual(termsForTurn(ISMS_DECK, slide, 'What is incident management?'), []);
    }
  });
});

describe('the terms for one turn', () => {
  const named = { ...POWER, meta: { ...POWER.meta, id: 'named-2', title: 'Data Centre Power' } };

  it('puts what the trainee asked about first', () => {
    const terms = termsForTurn(named, named.slides[0]!, 'What does a busbar do?');
    assert.equal(terms[0]!.id, 'busbar');
  });

  it('takes the screen before the notes, and stops at the cap', () => {
    const terms = termsForTurn(named, named.slides[0]!).map((entry) => entry.id);
    assert.ok(terms.length <= MAX_TERMS_PER_TURN);
    assert.ok(
      terms.indexOf('uninterruptible-power-supply') < terms.indexOf('power-distribution-unit') ||
        !terms.includes('power-distribution-unit'),
    );
  });

  it('renders as a short block, or nothing', () => {
    assert.equal(renderGlossary([]), '');
    const block = renderGlossary(termsForTurn(named, named.slides[0]!));
    assert.match(block, /^TECHNAVIOUS GLOSSARY\n/);
    assert.match(block, /- UPS \(Uninterruptible Power Supply\): /);
    assert.ok(block.length < 2000, `${block.length} characters`);
  });
});

describe('in the trainer prompt', () => {
  const named = { ...POWER, meta: { ...POWER.meta, id: 'named-3', title: 'Data Centre Power' } };
  const turn = (deck: DeckRecord, kind: 'narrate' | 'answer' | 'recap', question?: string) =>
    buildTurnPrompt({
      deck,
      kind,
      slide: deck.slides[0]!,
      history: [],
      question,
      coveredSlideIds: [],
    });

  it('narration and answers on a data centre deck carry the definitions', () => {
    assert.match(turn(named, 'narrate'), /TECHNAVIOUS GLOSSARY/);
    assert.match(turn(named, 'answer', 'What is an ATS?'), /Automatic Transfer Switch \(ATS\)/);
  });

  it('a recap does not, and the ISMS deck never does', () => {
    assert.doesNotMatch(turn(named, 'recap'), /TECHNAVIOUS GLOSSARY/);
    for (const kind of ['narrate', 'answer', 'recap'] as const) {
      assert.doesNotMatch(turn(ISMS_DECK, kind, 'What is access control?'), /GLOSSARY/);
    }
  });
});

describe("listening for the deck's acronyms", () => {
  it('gives live transcription the acronyms a data centre deck uses', () => {
    const named = { ...POWER, meta: { ...POWER.meta, id: 'named-4', title: 'Data Centre Power' } };
    const terms = keytermsFor(named);
    for (const code of ['UPS', 'PDU', 'LOTO', 'CRAH', 'N+1']) assert.ok(terms.includes(code), code);
    assert.deepEqual(keytermsFor(ISMS_DECK), []);
  });

  it('checks what the browser sends before passing it on', () => {
    const route = readFileSync('src/app/api/stt/route.ts', 'utf8');
    assert.match(route, /getAll\('keyterm'\)\.slice\(0, 40\)/);
    assert.match(route, /\/\^\[A-Za-z0-9&\+-\]\{2,12\}\$\/\.test\(term\)/);
  });
});

/**
 * A question that asks what a term means gets the glossary's meaning (D-14).
 *
 * The UAT dry run asked "What does X mean?" on a trainer-led run screen and heard the
 * slide's broader meaning, though the trainer had the entry: it sat at the end of the
 * material. The definition is now said again beside the question, in the task.
 */
describe('a question that names a glossary term', () => {
  const named = {
    ...POWER,
    meta: { ...POWER.meta, id: 'named-asked', title: 'Data Centre Power' },
  };

  it('puts the definition beside the question, in both kinds of session', () => {
    const asked = definitionsAsked(named, 'What does ATS mean?');
    assert.match(asked, /^The question names a term the Technavious glossary defines/);
    assert.match(asked, /Automatic Transfer Switch \(ATS\)/);

    const oneToOne = buildTurnPrompt({
      deck: named,
      kind: 'answer',
      slide: named.slides[0]!,
      history: [],
      question: 'What does ATS mean?',
      coveredSlideIds: [],
    });
    const question = oneToOne.indexOf('THE TRAINEE JUST ASKED');
    const definition = oneToOne.indexOf('The question names a term');
    assert.ok(question >= 0 && definition > question, 'the definition follows the question');
    assert.ok(definition < oneToOne.indexOf('YOUR TASK'), 'and comes before the task');

    const room = buildFacilitatedTurnPrompt({
      deck: named,
      slide: named.slides[0]!,
      history: [],
      turn: 'answer',
      question: 'What does ATS mean?',
      attendees: ['Asha'],
    });
    assert.ok(
      room.indexOf('The question names a term') >
        room.indexOf('THE FACILITATOR RELAYED A QUESTION'),
    );
  });

  it('says nothing for a question that names no term, for another kind of turn, or on a deck without the glossary', () => {
    assert.equal(definitionsAsked(named, 'How long does this take?'), '');
    assert.equal(definitionsAsked(named, undefined), '');
    assert.equal(definitionsAsked(ISMS_DECK, 'What does ATS mean?'), '');
    const explain = buildFacilitatedTurnPrompt({
      deck: named,
      slide: named.slides[0]!,
      history: [],
      turn: 'explain',
      question: 'What does ATS mean?',
      attendees: [],
    });
    assert.doesNotMatch(explain, /The question names a term/);
  });

  it('never gives a term that is held back from the trainer', () => {
    const held = GLOSSARY.map((entry) =>
      entry.acronym === 'ATS' ? { ...entry, held: 'Being checked' } : entry,
    );
    assert.equal(definitionsAsked(named, 'What does ATS mean?', held), '');
  });
});

/**
 * Who a trainer-led answer is addressed to (D-12), and that a relayed question is
 * answered rather than thanked for (UAT dry run).
 */
describe('a question relayed in a trainer-led session', () => {
  const relay = (askedBy?: string) =>
    buildFacilitatedTurnPrompt({
      deck: ISMS_DECK,
      slide: ISMS_DECK.slides[1]!,
      history: [],
      turn: 'answer',
      question: 'What is a phishing email?',
      askedBy,
      attendees: ['UAT'],
    });

  it('from the group, addresses nobody by name, however few are in the room', () => {
    const prompt = relay();
    assert.match(prompt, /RELAYED A QUESTION FROM THE GROUP/);
    assert.match(prompt, /address nobody by name/);
    assert.doesNotMatch(prompt, /addressing UAT by name/);
  });

  it('from one person, addresses them by name', () => {
    const prompt = relay('UAT');
    assert.match(prompt, /RELAYED A QUESTION FROM UAT/);
    assert.match(prompt, /addressing UAT by name as you begin/);
  });

  it('is answered as a question, never thanked for as a reply', () => {
    assert.match(relay(), /Do not treat it as their reply to you, and do not thank anybody for it/);
  });
});
