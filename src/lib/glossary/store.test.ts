import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { platformAuditHistory } from '../audit/log';
import type { DeckRecord, DeckSlide } from '../deck-types';
import { ISMS_DECK } from '../decks/isms';
import { InMemoryDocumentStore } from '../roster/documents';
import type { Role, SignedInPerson } from '../roster/types';
import { buildFacilitatedTurnPrompt, buildTurnPrompt } from '../trainer-prompt';
import { GLOSSARY } from './entries';
import { keytermsFor, renderGlossary, termsForTurn, termsIn } from './index';
import {
  addGlossaryEntry,
  deleteGlossaryEntry,
  editGlossaryEntry,
  GLOSSARY_CACHE_MS,
  GLOSSARY_COLLECTION,
  glossaryForAdministrator,
  GlossaryRefused,
  holdGlossaryEntry,
  liveGlossary,
  releaseGlossaryEntry,
  resetGlossary,
} from './store';
import type { GlossaryRecord } from './types';
import { checkEntry, idFor, MAX_DEFINITION } from './validate';

/**
 * The live glossary the administrator manages (AI-21): seeded from the imported file,
 * cached per server, emptied by an edit, and matched by the same pure functions.
 *
 * The definitions given to CDFA and HV/MV here are placeholders for the test. The real
 * ones are the administrator's to write; they are not in the imported file.
 */

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

function person(id: string, role: Role, extra: Partial<SignedInPerson> = {}): SignedInPerson {
  return {
    id,
    orgId: 'acme',
    homeOrgId: 'acme',
    platform: false,
    email: `${id}@acme.example`,
    emailKey: `${id}@acme.example`,
    name: id,
    role,
    createdAt: '2026-11-01T00:00:00.000Z',
    lastSeenAt: null,
    ...extra,
  };
}

const administrator = person('tech', 'admin', { platform: true, homeOrgId: 'technavious' });
const technaviousAdmin = person('tech-hr', 'admin', { homeOrgId: 'technavious' });
const companyAdmin = person('hr', 'admin');
const facilitator = person('fran', 'facilitator');
const participant = person('asha', 'trainee');

const CDFA = {
  term: 'CDFA',
  acronym: 'CDFA',
  expansion: 'Placeholder expansion for the test',
  definition: 'Placeholder definition of CDFA, written by the test',
  section: 'foundation',
};

const HV_MV = {
  term: 'HV/MV Switchgear',
  acronym: 'HV/MV',
  expansion: 'High Voltage and Medium Voltage',
  definition: 'Placeholder definition of HV/MV switchgear, written by the test',
  section: 'electrical',
};

/** A store that counts reads of the glossary, and can be told to fail. */
class CountingStore extends InMemoryDocumentStore {
  reads = 0;
  failing = false;
  override async all<T>(collection: string): Promise<T[]> {
    if (collection === GLOSSARY_COLLECTION) {
      this.reads += 1;
      if (this.failing) throw new Error('Firestore is down');
    }
    return super.all<T>(collection);
  }
}

function clock(start = Date.parse('2026-11-10T09:00:00.000Z')) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

/** A small data centre deck, built from the ISMS deck's shape. */
function dcDeck(id: string, slides: Array<Partial<DeckSlide>>): DeckRecord {
  const base = ISMS_DECK.slides[1]!;
  return {
    meta: { ...ISMS_DECK.meta, id, title: 'Data Centre Power' },
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

const POWER = dcDeck('dc-store-1', [
  {
    title: 'Switching the supply',
    bullets: ['UPS and busbar', 'HV/MV switchgear feeds the transformers', 'The CDFA view'],
  },
]);

describe('the live glossary', () => {
  it('is seeded from the imported file on first use, in its order', async () => {
    const store = new InMemoryDocumentStore();
    const entries = await liveGlossary({ store });
    assert.equal(entries.length, GLOSSARY.length);
    assert.deepEqual(
      entries.map((entry) => entry.id),
      GLOSSARY.map((entry) => entry.id),
    );
    assert.equal((await store.all(GLOSSARY_COLLECTION)).length, GLOSSARY.length);
  });

  it('matches exactly as the imported file does until somebody changes it', async () => {
    const entries = await liveGlossary({ store: new InMemoryDocumentStore() });
    const slide = POWER.slides[0]!;
    assert.equal(
      renderGlossary(termsForTurn(POWER, slide, 'What is a busbar?', entries)),
      renderGlossary(termsForTurn(POWER, slide, 'What is a busbar?')),
    );
  });

  it('is read once per server, and again only when five minutes old', async () => {
    const store = new CountingStore();
    const time = clock();
    const first = await liveGlossary({ store, now: time.now });
    assert.equal(store.reads, 1);
    time.advance(GLOSSARY_CACHE_MS - 1000);
    assert.equal(await liveGlossary({ store, now: time.now }), first, 'not the cached list');
    assert.equal(store.reads, 1, 'read again inside five minutes');
    time.advance(2000);
    await liveGlossary({ store, now: time.now });
    assert.equal(store.reads, 2);
  });

  it('reads once for many turns arriving together', async () => {
    const store = new CountingStore();
    await Promise.all(Array.from({ length: 10 }, () => liveGlossary({ store })));
    assert.equal(store.reads, 1);
  });

  it('does not keep a read that was under way when an edit was made', async () => {
    const store = new CountingStore();
    const time = clock();
    await liveGlossary({ store, now: time.now });
    time.advance(GLOSSARY_CACHE_MS);
    const before = liveGlossary({ store, now: time.now });
    await addGlossaryEntry(administrator, CDFA, { store, now: time.now });
    await before;
    const after = await liveGlossary({ store, now: time.now });
    assert.ok(
      after.some((entry) => entry.term === 'CDFA'),
      'the edit waited five minutes',
    );
  });

  it('is read again straight after an edit on this server', async () => {
    const store = new CountingStore();
    const time = clock();
    await liveGlossary({ store, now: time.now });
    await addGlossaryEntry(administrator, CDFA, { store, now: time.now });
    const after = await liveGlossary({ store, now: time.now });
    assert.ok(after.some((entry) => entry.term === 'CDFA'));
  });

  it('reaches another server within five minutes', async () => {
    // An edit made elsewhere empties that server's copy, not this one: this one sees it
    // when its own copy expires.
    const store = new CountingStore();
    const time = clock();
    await liveGlossary({ store, now: time.now });
    await store.update<GlossaryRecord>(GLOSSARY_COLLECTION, 'busbar', (current) => ({
      ...current!,
      definition: 'Changed on another server',
    }));
    const stale = await liveGlossary({ store, now: time.now });
    assert.notEqual(
      stale.find((entry) => entry.id === 'busbar')?.definition,
      'Changed on another server',
    );
    time.advance(GLOSSARY_CACHE_MS);
    const fresh = await liveGlossary({ store, now: time.now });
    assert.equal(
      fresh.find((entry) => entry.id === 'busbar')?.definition,
      'Changed on another server',
    );
  });

  it('keeps teaching from the last list, or the imported file, when Firestore fails', async () => {
    const store = new CountingStore();
    store.failing = true;
    const entries = await liveGlossary({ store });
    assert.equal(entries, GLOSSARY);

    const recovering = new CountingStore();
    const time = clock();
    await addGlossaryEntry(administrator, CDFA, { store: recovering, now: time.now });
    const loaded = await liveGlossary({ store: recovering, now: time.now });
    recovering.failing = true;
    time.advance(GLOSSARY_CACHE_MS);
    assert.equal(await liveGlossary({ store: recovering, now: time.now }), loaded);
  });
});

describe('what the trainer is given', () => {
  it('uses an edited definition', async () => {
    const store = new InMemoryDocumentStore();
    await editGlossaryEntry(
      administrator,
      'uninterruptible-power-supply',
      {
        term: 'UPS',
        acronym: 'UPS',
        expansion: 'Uninterruptible Power Supply',
        definition: 'The edited Technavious definition of a UPS',
        section: 'electrical',
      },
      { store },
    );
    const entries = await liveGlossary({ store });
    const block = renderGlossary(termsForTurn(POWER, POWER.slides[0]!, undefined, entries));
    assert.match(block, /UPS \(Uninterruptible Power Supply\): The edited Technavious definition/);

    const prompt = buildTurnPrompt({
      deck: POWER,
      kind: 'answer',
      slide: POWER.slides[0]!,
      history: [],
      question: 'What does the UPS do?',
      coveredSlideIds: [],
      glossary: entries,
    });
    assert.match(prompt, /The edited Technavious definition of a UPS/);
  });

  it('leaves out a held term, and gives it again once released', async () => {
    const store = new InMemoryDocumentStore();
    await holdGlossaryEntry(administrator, 'busbar', 'Wording under review', { store });
    const held = await liveGlossary({ store });
    assert.ok(
      !termsIn('What is a busbar?', { includeWeak: true, entries: held }).some(
        (e) => e.id === 'busbar',
      ),
    );
    assert.equal(held.find((entry) => entry.id === 'busbar')?.held, 'Wording under review');

    await releaseGlossaryEntry(administrator, 'busbar', 'Wording agreed', { store });
    const released = await liveGlossary({ store });
    assert.ok(
      termsIn('What is a busbar?', { includeWeak: true, entries: released }).some(
        (e) => e.id === 'busbar',
      ),
    );
    const record = (await glossaryForAdministrator(administrator, { store })).find(
      (entry) => entry.id === 'busbar',
    );
    assert.equal(record?.held, undefined);
    assert.equal(record?.released?.reason, 'Wording agreed');
  });

  it('matches CDFA and HV/MV once the administrator adds them, HV/MV as a code', async () => {
    const store = new InMemoryDocumentStore();
    // Not in the imported file: the brief has the administrator add them.
    assert.deepEqual(termsIn('CDFA and HV/MV switchgear'), []);

    const cdfa = await addGlossaryEntry(administrator, CDFA, { store });
    const hvmv = await addGlossaryEntry(administrator, HV_MV, { store });
    assert.equal(cdfa.id, 'cdfa');
    assert.equal(hvmv.id, 'hv-mv-switchgear');
    const entries = await liveGlossary({ store });

    const ids = (text: string) => termsIn(text, { entries }).map((entry) => entry.id);
    assert.ok(ids('Ask the CDFA.').includes('cdfa'));
    assert.ok(ids('The HV/MV side of the substation').includes('hv-mv-switchgear'));
    // As a code: as written, in capitals, as a whole token.
    assert.ok(!ids('the hv/mv side').includes('hv-mv-switchgear'));
    assert.ok(!ids('cdfa in lower case').includes('cdfa'));

    const turn = termsForTurn(POWER, POWER.slides[0]!, 'What is HV/MV switchgear?', entries);
    assert.ok(turn.some((entry) => entry.id === 'hv-mv-switchgear'));
    assert.match(
      renderGlossary(turn),
      /- HV\/MV Switchgear \(HV\/MV\): Placeholder definition of HV\/MV switchgear/,
    );
    assert.match(renderGlossary(turn), /- CDFA \(Placeholder expansion for the test\): /);

    // Live transcription listens for the halves, which is what is said aloud.
    const keyterms = keytermsFor(POWER, entries);
    for (const code of ['CDFA', 'HV', 'MV', 'UPS']) assert.ok(keyterms.includes(code), code);
    assert.ok(keyterms.every((term) => /^[A-Za-z0-9&+-]{2,12}$/.test(term)));
  });

  it('leaves every prompt for a deck that is not about data centres byte for byte as it was', async () => {
    const store = new InMemoryDocumentStore();
    await addGlossaryEntry(administrator, CDFA, { store });
    await addGlossaryEntry(administrator, HV_MV, { store });
    await addGlossaryEntry(
      administrator,
      {
        term: 'Access Control Matrix',
        definition: 'A term that the ISMS deck would match if the glossary applied to it',
        section: 'elv-fire-security',
      },
      { store },
    );
    const entries = await liveGlossary({ store });
    for (const slide of ISMS_DECK.slides) {
      for (const kind of ['narrate', 'answer', 'recap', 'quiz'] as const) {
        const args = {
          deck: ISMS_DECK,
          kind,
          slide,
          history: [],
          question: kind === 'answer' ? 'What is access control?' : undefined,
          coveredSlideIds: [],
        };
        assert.equal(buildTurnPrompt({ ...args, glossary: entries }), buildTurnPrompt(args));
      }
      const facilitated = {
        deck: ISMS_DECK,
        slide,
        history: [],
        turn: 'answer' as const,
        question: 'What is incident management?',
        attendees: ['Asha'],
      };
      assert.equal(
        buildFacilitatedTurnPrompt({ ...facilitated, glossary: entries }),
        buildFacilitatedTurnPrompt(facilitated),
      );
    }
    assert.deepEqual(keytermsFor(ISMS_DECK, entries), []);
  });
});

describe('changes to the glossary', () => {
  it('are refused to everybody but the administrator', async () => {
    const store = new InMemoryDocumentStore();
    for (const actor of [companyAdmin, facilitator, participant]) {
      const attempts = [
        glossaryForAdministrator(actor, { store }),
        addGlossaryEntry(actor, CDFA, { store }),
        editGlossaryEntry(actor, 'busbar', CDFA, { store }),
        holdGlossaryEntry(actor, 'busbar', 'No', { store }),
        releaseGlossaryEntry(actor, 'busbar', 'No', { store }),
        deleteGlossaryEntry(actor, 'busbar', { store }),
        resetGlossary(actor, { store }),
      ];
      for (const attempt of attempts) {
        await assert.rejects(
          attempt,
          (error) => error instanceof GlossaryRefused && error.status === 404,
        );
      }
    }
    // Technavious's own administrators are administrators too.
    assert.ok((await glossaryForAdministrator(technaviousAdmin, { store })).length > 0);
  });

  it('refuse a second entry for a term or an acronym the glossary already has', async () => {
    const store = new InMemoryDocumentStore();
    await assert.rejects(
      addGlossaryEntry(
        administrator,
        {
          term: 'Uninterruptible supply',
          acronym: 'UPS',
          definition: 'Another',
          section: 'electrical',
        },
        { store },
      ),
      (error) => error instanceof GlossaryRefused && error.status === 409,
    );
    await assert.rejects(
      addGlossaryEntry(
        administrator,
        { term: 'busbar', definition: 'Again', section: 'electrical' },
        { store },
      ),
      (error) => error instanceof GlossaryRefused && error.status === 409,
    );
  });

  it('need a reason to hold or release', async () => {
    const store = new InMemoryDocumentStore();
    await assert.rejects(
      holdGlossaryEntry(administrator, 'busbar', '   ', { store }),
      (error) => error instanceof GlossaryRefused && error.status === 400,
    );
    await assert.rejects(
      releaseGlossaryEntry(administrator, 'busbar', 'Not held', { store }),
      (error) => error instanceof GlossaryRefused && error.status === 409,
    );
  });

  it('delete an entry, and the trainer stops being given it', async () => {
    const store = new InMemoryDocumentStore();
    await deleteGlossaryEntry(administrator, 'busbar', { store });
    const entries = await liveGlossary({ store });
    assert.ok(!entries.some((entry) => entry.id === 'busbar'));
    await assert.rejects(
      deleteGlossaryEntry(administrator, 'busbar', { store }),
      (error) => error instanceof GlossaryRefused && error.status === 404,
    );
  });

  it('can all be undone by resetting to the imported file', async () => {
    const store = new InMemoryDocumentStore();
    await addGlossaryEntry(administrator, CDFA, { store });
    await deleteGlossaryEntry(administrator, 'busbar', { store });
    await releaseGlossaryEntry(administrator, 'tier-iv', 'Confirmed', { store });
    assert.equal(await resetGlossary(administrator, { store }), GLOSSARY.length);

    const entries = await liveGlossary({ store });
    assert.deepEqual(
      entries.map((entry) => entry.id),
      GLOSSARY.map((entry) => entry.id),
    );
    assert.ok(entries.find((entry) => entry.id === 'tier-iv')?.held, 'the file holds Tier IV');
  });
});

describe('what an administrator may write', () => {
  it('needs a term, a definition and a section', () => {
    assert.equal(checkEntry({ definition: 'x', section: 'electrical' }).ok, false);
    assert.equal(checkEntry({ term: 'x', section: 'electrical' }).ok, false);
    assert.equal(checkEntry({ term: 'x', definition: 'y', section: 'plumbing' }).ok, false);
    assert.equal(checkEntry('a string').ok, false);
  });

  it('caps the lengths', () => {
    const long = checkEntry({
      term: 'Busbar',
      definition: 'x'.repeat(MAX_DEFINITION + 1),
      section: 'electrical',
    });
    assert.equal(long.ok, false);
    assert.equal(
      checkEntry({
        term: 'x',
        definition: 'y',
        section: 'electrical',
        aliases: Array(9)
          .fill('a')
          .map((a, i) => a + i),
      }).ok,
      false,
    );
  });

  it('takes an acronym only as it would be written, and not one that means something else', () => {
    assert.equal(checkEntry({ ...HV_MV, acronym: 'hv mv' }).ok, false);
    assert.equal(checkEntry({ ...HV_MV, acronym: 'DC' }).ok, false);
    assert.equal(checkEntry(HV_MV).ok, true);
  });

  it('cleans what it keeps', () => {
    const checked = checkEntry({
      term: '  Hot  aisle ',
      definition: 'The aisle the exhausts face \u2014 kept apart from the cold one.',
      aliases: 'HAC, hot aisle containment, HAC',
      section: 'mechanical',
    });
    assert.ok(checked.ok);
    assert.equal(checked.value.term, 'Hot aisle');
    assert.equal(
      checked.value.definition,
      'The aisle the exhausts face - kept apart from the cold one',
    );
    assert.deepEqual(checked.value.aliases, ['HAC', 'hot aisle containment']);
  });

  it('gives every entry an id the routes accept', () => {
    const usable = /^[a-z0-9][a-z0-9-]{0,79}$/;
    for (const entry of GLOSSARY) assert.match(entry.id, usable);
    for (const term of ['HV/MV Switchgear', 'N+1 Redundancy', '  ', 'x'.repeat(200)]) {
      assert.match(idFor(term), usable);
    }
  });
});

describe('the glossary page and routes', () => {
  it('refuse anybody who is not the administrator, before reading anything', () => {
    const page = read('src/app/glossary/page.tsx');
    assert.match(
      page,
      /const person = await requireUserPage\('\/glossary'\);\s*if \(!isAdministrator\(person\)\) notFound\(\);/,
    );
    for (const path of [
      'src/app/api/glossary/route.ts',
      'src/app/api/glossary/[id]/route.ts',
      'src/app/api/glossary/reset/route.ts',
    ]) {
      const source = read(path);
      const handlers = source.split(/export async function /).slice(1);
      assert.ok(handlers.length > 0, path);
      for (const handler of handlers) {
        assert.match(
          handler,
          /const gate = await checkUser\(\);\s*if \(!gate\.ok\) return gate\.response;\s*if \(!isAdministrator\(gate\.person\)\)/,
          `${path} ${handler.slice(0, 20)} does not refuse a non-administrator first`,
        );
      }
    }
  });

  it('are offered in the navigation to administrators only', () => {
    const nav = read('src/components/MainNav.tsx');
    assert.match(nav, /if \(isAdministrator\(person\)\) links\.push\(\{ href: '\/glossary'/);
  });

  it('keep the glossary itself out of the browser', () => {
    const client = read('src/app/glossary/GlossaryManager.tsx');
    assert.doesNotMatch(client, /from '@\/lib\/glossary'|glossary\/(entries|store|index)'/);
    const validate = read('src/lib/glossary/validate.ts');
    assert.doesNotMatch(validate, /from '\.\/(entries|index|store)'/);
  });

  it('are loaded by the routes and pages that build prompts or listen, not by the builder', () => {
    assert.match(read('src/app/api/chat/route.ts'), /const glossaryLoad = liveGlossary\(\);/);
    assert.match(read('src/app/session/page.tsx'), /keytermsFor\(stored\.record, glossary\)/);
    assert.match(read('src/app/sessions/[id]/run/page.tsx'), /keytermsFor\(deck, glossary\)/);
    assert.doesNotMatch(read('src/lib/trainer-prompt.ts'), /liveGlossary|glossary\/store/);
  });

  it('record every change in the platform audit history (AI-40)', async () => {
    const store = new InMemoryDocumentStore();
    const added = await addGlossaryEntry(administrator, CDFA, { store });
    await editGlossaryEntry(
      administrator,
      added.id,
      { ...CDFA, definition: 'Changed.' },
      { store },
    );
    await holdGlossaryEntry(administrator, added.id, 'Wording under review', { store });
    await releaseGlossaryEntry(administrator, added.id, 'Agreed', { store });
    await deleteGlossaryEntry(administrator, added.id, { store });
    await resetGlossary(administrator, { store });
    // Outside a request the entries are written straight after, not awaited.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const month = new Date().toISOString().slice(0, 7);
    const history = await platformAuditHistory({ month, subjectType: 'glossary-term' }, { store });
    assert.deepEqual(history.map((entry) => entry.action).sort(), [
      'created',
      'deleted',
      'updated',
      'updated',
      'updated',
      'updated',
    ]);
    assert.ok(history.every((entry) => entry.actorId === administrator.id && !entry.orgId));
    assert.ok(history.some((entry) => /Held .*: Wording under review/.test(entry.detail)));
    assert.doesNotMatch(read('src/lib/glossary/store.ts'), /\/\/ AUDIT:/);
  });
});
