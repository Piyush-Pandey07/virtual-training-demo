import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { AUDIT, type AuditEntry } from '../audit/log';
import type { DeckRecord } from '../deck-types';
import { scopedDocuments } from '../orgs/scope';
import { InMemoryDocumentStore } from '../roster/documents';
import { resetRosterStore } from '../roster/registry';
import { DocumentRosterStore } from '../roster/store-documents';
import type { Role, SignedInPerson } from '../roster/types';
import { createSession, TrainingRuleError } from '../training/service';
import { trainingStore } from '../training/store';
import {
  ApprovalError,
  approvalStateOf,
  approveDeck,
  assignmentRefusal,
  assignmentRefusalFor,
  clearDeckApproval,
  deckApprovalState,
  deckApprovalStates,
  deckFingerprint,
  mayApproveDecks,
  noteDeckSaved,
  type DeckApproval,
} from './approval';
import { ISMS_DECK } from './isms';
import { resetDeckStore } from './registry';
import { DocumentDeckStore } from './store-documents';

/**
 * Deck approval and re-approval (BRD v2.3, AI-39).
 *
 * The rule under test: a deck can be assigned only while it is approved exactly as it
 * stands. A change to what it teaches, or withdrawing it, means approving it again, and
 * a save that changes nothing costs nothing. Every path that gives somebody a deck is
 * held to it: the assignments API, trainer-led session creation, and anything added
 * later that calls `.assign(`.
 */

const ORG = 'acme';
const DECK_ID = 'safety-a1b2c3';

function person(id: string, role: Role, extra: Partial<SignedInPerson> = {}): SignedInPerson {
  return {
    id,
    orgId: ORG,
    homeOrgId: ORG,
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

/** Technavious staff looking inside Acme, which makes them an administrator. */
const srikant = person('srikant', 'admin', {
  platform: true,
  homeOrgId: 'technavious',
  email: 'Srikant@Technavious.example',
  name: 'Srikant',
});
const homeAdmin = person('tara', 'admin', { homeOrgId: 'technavious' });
const companyAdmin = person('hr', 'admin');
const facilitator = person('fran', 'facilitator');
const asha = person('asha', 'trainee');

function deck(overrides: Partial<DeckRecord> = {}): DeckRecord {
  return {
    meta: { ...ISMS_DECK.meta, id: DECK_ID, origin: 'uploaded' },
    slides: ISMS_DECK.slides.map((slide) => ({ ...slide })),
    topics: ISMS_DECK.topics.map((topic) => ({ ...topic })),
    ...overrides,
  };
}

let store: InMemoryDocumentStore;
let decks: DocumentDeckStore;
let savedApprovers: string | undefined;

/** Lets the audit writes queued after a call land, since they run off the response path. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function auditOf(orgId = ORG): Promise<AuditEntry[]> {
  await settle();
  return store.all<AuditEntry>(`orgs/${orgId}/${AUDIT}`);
}

beforeEach(async () => {
  savedApprovers = process.env.DECK_APPROVERS;
  delete process.env.DECK_APPROVERS;
  store = new InMemoryDocumentStore();
  decks = new DocumentDeckStore(scopedDocuments(store, ORG));
  resetDeckStore(decks, ORG);
  await decks.save(deck(), 'published');
});

afterEach(() => {
  if (savedApprovers === undefined) delete process.env.DECK_APPROVERS;
  else process.env.DECK_APPROVERS = savedApprovers;
  resetDeckStore();
  resetRosterStore();
});

describe('the fingerprint', () => {
  it('is the same for the same teachable content, whatever the key order', () => {
    const a = deck();
    const b: DeckRecord = JSON.parse(JSON.stringify(a));
    b.meta = Object.fromEntries(Object.entries(b.meta).reverse()) as DeckRecord['meta'];
    assert.equal(deckFingerprint(a, 'published'), deckFingerprint(b, 'published'));
  });

  it('ignores what no trainee is taught from', () => {
    const base = deckFingerprint(deck(), 'published');
    const reanalysed = deck();
    reanalysed.meta.outlineAnalysedAt = '2026-11-09T10:00:00.000Z';
    reanalysed.meta.outlinePromptVersion = 7;
    reanalysed.slides[1] = {
      ...reanalysed.slides[1]!,
      internalNotes: ['author only'],
      printedTitle: 'PRINTED',
      width: 1600,
      height: 900,
    };
    assert.equal(deckFingerprint(reanalysed, 'published'), base);
  });

  it('changes with the meta, any slide teaching field, the topics and the status', () => {
    const base = deckFingerprint(deck(), 'published');

    const retitled = deck();
    retitled.meta.title = 'Something else';
    const rebriefed = deck();
    rebriefed.slides[2] = { ...rebriefed.slides[2]!, narrationBrief: 'Say something new.' };
    const repointed = deck();
    repointed.slides[2] = { ...repointed.slides[2]!, keyPoints: ['A different point'] };
    const paced = deck();
    paced.slides[2] = { ...paced.slides[2]!, targetSeconds: paced.slides[2]!.targetSeconds + 5 };
    const retaught = deck();
    retaught.topics[0] = { ...retaught.topics[0]!, explanation: ['A new explanation.'] };
    const completion = deck();
    completion.meta.completionPercent = 75;

    for (const changed of [retitled, rebriefed, repointed, paced, retaught, completion]) {
      assert.notEqual(deckFingerprint(changed, 'published'), base);
    }
    assert.notEqual(deckFingerprint(deck(), 'draft'), base);
  });
});

describe('where a deck stands', () => {
  const approval = (record: DeckRecord, extra: Partial<DeckApproval> = {}): DeckApproval => ({
    id: DECK_ID,
    deckId: DECK_ID,
    fingerprint: deckFingerprint(record, 'published'),
    approvedById: srikant.id,
    approvedByEmail: srikant.email,
    approvedByName: 'Srikant',
    approvedAt: '2026-11-09T09:00:00.000Z',
    ...extra,
  });

  it('is unapproved with no approval, and approved while the fingerprint matches', () => {
    assert.deepEqual(approvalStateOf(undefined, deck(), 'published'), { state: 'unapproved' });
    assert.equal(approvalStateOf(approval(deck()), deck(), 'published').state, 'approved');
  });

  it('is changed once the deck differs from what was approved', () => {
    const edited = deck();
    edited.meta.closingReminder = 'Something new to remember.';
    const state = approvalStateOf(approval(deck()), edited, 'published');
    assert.deepEqual(state, {
      state: 'changed',
      by: 'Srikant',
      at: '2026-11-09T09:00:00.000Z',
      reason: 'changed',
    });
  });

  it('stays changed once cleared, even if the deck is put back exactly as it was', () => {
    const cleared = approval(deck(), {
      clearedAt: '2026-11-09T10:00:00.000Z',
      clearedReason: 'withdrawn',
    });
    assert.equal(approvalStateOf(cleared, deck(), 'published').state, 'changed');
  });

  it('refuses assignment in every state but approved, and says why', () => {
    assert.equal(assignmentRefusalFor({ state: 'approved', by: 'Srikant', at: 'x' }), null);
    assert.match(assignmentRefusalFor({ state: 'unapproved' }) ?? '', /not been approved/);
    assert.match(
      assignmentRefusalFor({
        state: 'changed',
        by: 'Srikant',
        at: '2026-11-09T09:00:00.000Z',
        reason: 'changed',
      }) ?? '',
      /changed since Srikant approved it on 9 Nov 2026, so it needs approving again/,
    );
    assert.match(
      assignmentRefusalFor({ state: 'changed', by: 'Srikant', at: 'x', reason: 'withdrawn' }) ?? '',
      /withdrawn after Srikant approved it/,
    );
  });
});

describe('who may approve', () => {
  it('is every Technavious administrator while DECK_APPROVERS is empty', () => {
    assert.equal(mayApproveDecks(srikant), true);
    assert.equal(mayApproveDecks(homeAdmin), true);
    assert.equal(mayApproveDecks(companyAdmin), false);
    assert.equal(mayApproveDecks(facilitator), false);
    assert.equal(mayApproveDecks(asha), false);
  });

  it('is only the people listed once DECK_APPROVERS holds anybody, by address and any case', () => {
    process.env.DECK_APPROVERS = ' srikant@technavious.example , someone@else.example';
    assert.equal(mayApproveDecks(srikant), true);
    // A Technavious administrator who is not on the list no longer qualifies.
    assert.equal(mayApproveDecks(homeAdmin), false);
    assert.equal(mayApproveDecks(companyAdmin), false);
    assert.equal(
      mayApproveDecks(person('someone', 'admin', { email: 'SOMEONE@else.example' })),
      true,
    );
  });

  it('is said in the example environment, with a place for Srikant', () => {
    const example = readFileSync('.env.example', 'utf8');
    assert.match(example, /^DECK_APPROVERS=$/m);
    assert.match(example, /SRIKANT'S ADDRESS GOES HERE/);
    assert.match(example, /While this is blank every Technavious administrator may\s+#\s+approve/);
  });
});

describe('approving, and losing it', () => {
  it('refuses anybody but the approver, and a deck that is not published', async () => {
    await assert.rejects(
      approveDeck(companyAdmin, DECK_ID, { store }),
      (error: unknown) => error instanceof ApprovalError && error.status === 403,
    );
    await decks.save(deck(), 'draft');
    await assert.rejects(
      approveDeck(srikant, DECK_ID, { store }),
      (error: unknown) => error instanceof ApprovalError && error.status === 409,
    );
    await assert.rejects(
      approveDeck(srikant, 'no-such-deck', { store }),
      (error: unknown) => error instanceof ApprovalError && error.status === 404,
    );
  });

  it('approves the deck as it stands, records who and when, and audits it', async () => {
    const state = await approveDeck(srikant, DECK_ID, { store, now: () => '2026-11-09T09:00:00Z' });
    assert.deepEqual(state, { state: 'approved', by: 'Srikant', at: '2026-11-09T09:00:00Z' });
    assert.equal((await deckApprovalState(ORG, DECK_ID, { store })).state, 'approved');
    assert.equal(await assignmentRefusal(ORG, DECK_ID, { store }), null);

    const [entry] = await auditOf();
    assert.equal(entry?.action, 'approved');
    assert.equal(entry?.subjectType, 'deck-approval');
    assert.equal(entry?.subjectId, DECK_ID);
    assert.equal(entry?.actorRole, 'administrator');
  });

  it('keeps the approval through a save that changes nothing that counts', async () => {
    await approveDeck(srikant, DECK_ID, { store });
    const same = deck();
    same.meta.outlineAnalysedAt = '2026-11-10T00:00:00.000Z';
    await decks.save(same, 'published');
    await noteDeckSaved(companyAdmin, same, 'published', { store });
    assert.equal((await deckApprovalState(ORG, DECK_ID, { store })).state, 'approved');
    assert.equal((await auditOf()).length, 1, 'only the approval was recorded');
  });

  it('clears on a real change, and stays cleared if the change is undone', async () => {
    await approveDeck(srikant, DECK_ID, { store });

    const edited = deck();
    edited.slides[1] = { ...edited.slides[1]!, narrationBrief: 'A rewritten brief.' };
    await decks.save(edited, 'published');
    // Refused on the fingerprint alone, before anything clears it.
    assert.match((await assignmentRefusal(ORG, DECK_ID, { store })) ?? '', /changed since/);

    await noteDeckSaved(companyAdmin, edited, 'published', { store });
    await decks.save(deck(), 'published');
    await noteDeckSaved(companyAdmin, deck(), 'published', { store });
    const state = await deckApprovalState(ORG, DECK_ID, { store });
    assert.equal(state.state, 'changed');

    const entries = await auditOf();
    const cleared = entries.filter((entry) => entry.action === 'withdrawn');
    assert.equal(cleared.length, 1, 'cleared once, and recorded once');
    assert.match(cleared[0]!.detail, /deck changed/);
  });

  it('clears on withdrawal, and republishing unchanged does not bring it back', async () => {
    await approveDeck(srikant, DECK_ID, { store });
    await decks.save(deck(), 'draft');
    assert.equal(await clearDeckApproval(companyAdmin, DECK_ID, 'withdrawn', { store }), true);
    assert.equal(await clearDeckApproval(companyAdmin, DECK_ID, 'withdrawn', { store }), false);
    await decks.save(deck(), 'published');

    const state = await deckApprovalState(ORG, DECK_ID, { store });
    assert.deepEqual(
      state.state === 'changed' ? state.reason : state.state,
      'withdrawn',
      'a withdrawn deck needs approving again',
    );
    assert.match((await assignmentRefusal(ORG, DECK_ID, { store })) ?? '', /withdrawn/);

    // And approving again is what puts it right.
    await approveDeck(srikant, DECK_ID, { store });
    assert.equal(await assignmentRefusal(ORG, DECK_ID, { store }), null);
  });

  it('is read for a whole list at once, for the pickers', async () => {
    await decks.save({ ...deck(), meta: { ...deck().meta, id: 'other-d4e5f6' } }, 'published');
    await approveDeck(srikant, DECK_ID, { store });
    const states = await deckApprovalStates(ORG, [{ id: DECK_ID }, { id: 'other-d4e5f6' }], {
      store,
    });
    assert.equal(states.get(DECK_ID)?.state, 'approved');
    assert.equal(states.get('other-d4e5f6')?.state, 'unapproved');
  });

  it('belongs to one customer: another customer reads no approval for the same id', async () => {
    await approveDeck(srikant, DECK_ID, { store });
    const elsewhere = await store.all<DeckApproval>('orgs/globex/deckApprovals');
    assert.equal(elsewhere.length, 0);
  });
});

describe('a trainer-led session', () => {
  let roster: DocumentRosterStore;

  beforeEach(async () => {
    roster = new DocumentRosterStore(scopedDocuments(store, ORG));
    resetRosterStore(roster, ORG);
    for (const who of [facilitator, asha]) {
      await roster.upsertPerson({
        id: who.id,
        email: who.email,
        name: who.name,
        role: who.role,
        orgId: ORG,
      });
    }
  });

  const input = { deckId: DECK_ID, participantIds: [asha.id] };

  it('cannot be created on an unapproved deck, and nothing is written or assigned', async () => {
    await assert.rejects(
      createSession(facilitator, input, { store }),
      (error: unknown) =>
        error instanceof TrainingRuleError &&
        error.status === 409 &&
        /not been approved/.test(error.message),
    );
    assert.equal((await trainingStore(ORG, store).listSessions()).length, 0);
    assert.equal(await roster.isAssigned(asha.id, DECK_ID), false);
  });

  it('cannot be created on a deck that changed since its approval', async () => {
    await approveDeck(srikant, DECK_ID, { store });
    const edited = deck();
    edited.meta.title = 'A different title';
    await decks.save(edited, 'published');
    await assert.rejects(
      createSession(facilitator, input, { store }),
      (error: unknown) => error instanceof TrainingRuleError && /changed since/.test(error.message),
    );
    assert.equal(await roster.isAssigned(asha.id, DECK_ID), false);
  });

  it('is created, and assigns the deck, once the deck is approved', async () => {
    await approveDeck(srikant, DECK_ID, { store });
    const session = await createSession(facilitator, input, { store });
    assert.equal(session.deckId, DECK_ID);
    assert.equal(await roster.isAssigned(asha.id, DECK_ID), true);
  });
});

// ---------------------------------------------------------------- every path

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/**
 * Every file that assigns a deck, and how it is held to approval.
 *
 * A new caller of `.assign(` fails the test below until it is added here, which is the
 * point: the next way of giving somebody a deck has to be checked against approval on
 * the day it is written, not found later by somebody assigning a changed deck.
 */
const ASSIGNS: Record<string, RegExp> = {
  'src/app/api/assignments/route.ts':
    /const refusal = assignmentRefusalFor\(approvalStateOf\(approval, stored\.record, stored\.status\)\);\s*if \(refusal\) return Response\.json\(\{ error: refusal \}, \{ status: 409 \}\);[\s\S]*store\.assign\(/,
  'src/lib/training/service.ts':
    /const refusal = await assignmentRefusal\(person\.orgId, deck\.id, \{ store: options\.store \}\);\s*if \(refusal\) throw new TrainingRuleError\(409, refusal\);[\s\S]*roster\.assign\(/,
};

describe('every path that assigns a deck', () => {
  it('is known, and asks about approval before it assigns', () => {
    const assigning = walk('src')
      .map((path) => path.split('\\').join('/'))
      .filter((path) => /\.assign\(\{/.test(read(path)));
    assert.deepEqual(assigning.sort(), Object.keys(ASSIGNS).sort());
    for (const [path, rule] of Object.entries(ASSIGNS)) {
      assert.match(read(path), rule, `${path} assigns without checking approval first`);
    }
  });

  it('the roster store itself is not a path: it is what the paths call', () => {
    // `assign` is defined in the roster stores, not called, so the walk above does not
    // find them. Checked so a store that started calling itself would be noticed.
    for (const path of ['src/lib/roster/store-documents.ts', 'src/lib/roster/store-fs.ts']) {
      assert.doesNotMatch(read(path), /\.assign\(\{/);
    }
  });
});

describe('the paths that change a deck', () => {
  it('clear the approval on unpublish and delete, and on any edit that changes it', () => {
    const route = read('src/app/api/decks/[id]/route.ts');
    assert.match(
      route,
      /await store\.save\(deck, status\);\s*\/\/[^\n]*\n[\s\S]*?if \(stored\.status === 'published' && status === 'draft'\) \{\s*await clearDeckApproval\(gate\.person, id, 'withdrawn'\)[\s\S]*?\} else \{\s*await noteDeckSaved\(gate\.person, deck, status\);/,
    );
    assert.match(
      route,
      /removeDeckEverywhere\([\s\S]*?\);\s*await clearDeckApproval\(gate\.person, id, 'withdrawn'\)/,
    );
  });

  it('re-analysis checks every step it saves', () => {
    const route = read('src/app/api/decks/[id]/analyse/route.ts');
    assert.match(
      route,
      /const save = async \(record: typeof deck\) => \{\s*await store\.save\(record, status\);\s*await noteDeckSaved\(gate\.person, record, status\);/,
    );
    assert.equal(route.match(/store\.save\(/g)?.length, 1, 'a step saves without the check');
    assert.equal(route.match(/await save\(/g)?.length, 5);
  });

  it('shows the approval on the deck page, with the button for the approver', () => {
    const page = read('src/app/decks/[id]/page.tsx');
    assert.match(page, /<ApproveDeck[\s\S]*?mayApprove=\{mayApproveDecks\(admin\)\}/);
    assert.match(page, /refusal=\{assignmentRefusalFor\(approval\)\}/);
    // And the person page offers an unapproved deck disabled, with why.
    assert.match(
      read('src/app/people/[id]/PersonDetail.tsx'),
      /disabled=\{Boolean\(deck\.unavailable\)\}/,
    );
  });
});
