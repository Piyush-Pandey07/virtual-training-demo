import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';

import {
  removeBank,
  resultsForDeck,
  saveBank,
  setLevelBands,
  submitAssessment,
  assessmentPaper,
} from '../assessments/service';
import type { BankQuestion } from '../assessments/types';
import { readUpload, TEMPLATE_COLUMNS } from '../profiles/csv';
import { saveProfile } from '../profiles/store';
import { importParticipants } from '../profiles/upload';
import { viewProfile } from '../profiles/view';
import { InMemoryDocumentStore } from '../roster/documents';
import { DocumentRosterStore } from '../roster/store-documents';
import type { Role, SignedInPerson } from '../roster/types';
import {
  AUDIT,
  AUDIT_RETENTION_DAYS,
  auditHistory,
  auditRoleOf,
  PLATFORM_AUDIT,
  platformAuditHistory,
  recordAudit,
  type AuditEntry,
} from './log';

/**
 * The audit history (BRD v2.3, AI-40): what an entry holds, where it goes, how long it
 * is kept, how the page reads it, and that each place that should write one does.
 *
 * The call sites in the services are driven through the in-memory store. The ones in
 * routes, which would need a server and a session, are read out of the source, as the
 * authorisation boundary is.
 */

const ORG = 'acme';

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

const benchmark = person('benchmark', 'admin', { platform: true, homeOrgId: 'technavious' });
const companyAdmin = person('hr', 'admin');
const facilitator = person('fran', 'facilitator');
const asha = person('asha', 'trainee');

let store: InMemoryDocumentStore;

/** Lets writes queued off the response path land. Outside a request they run at once. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function entries(orgId = ORG): Promise<AuditEntry[]> {
  await settle();
  return store.all<AuditEntry>(`orgs/${orgId}/${AUDIT}`);
}

beforeEach(() => {
  store = new InMemoryDocumentStore();
});

describe('an entry', () => {
  it('names who, in which role, did what to which subject, and expires after 400 days', async () => {
    const now = Date.parse('2026-11-10T12:00:00.000Z');
    await recordAudit(
      companyAdmin,
      { action: 'viewed', subjectType: 'assessment-result', subjectId: 'deck-1', detail: 'x' },
      { store, now, immediate: true },
    );
    const [entry] = await entries();
    assert.ok(entry);
    assert.equal(entry.at, '2026-11-10T12:00:00.000Z');
    assert.equal(entry.day, '2026-11-10');
    assert.equal(entry.month, '2026-11');
    assert.equal(entry.orgId, ORG);
    assert.equal(entry.actorId, 'hr');
    assert.equal(entry.actorEmail, 'hr@acme.example');
    assert.equal(entry.actorRole, 'company administrator');
    assert.equal(entry.action, 'viewed');
    assert.equal(entry.subjectType, 'assessment-result');
    assert.equal(entry.subjectId, 'deck-1');
    assert.equal(
      new Date(entry.expireAt).getTime() - now,
      AUDIT_RETENTION_DAYS * 86_400_000,
      'kept for 400 days',
    );
    assert.ok(AUDIT_RETENTION_DAYS >= 366, 'at least a year');
  });

  it('records the role somebody had, in the words of BRD v2.3', () => {
    assert.equal(auditRoleOf(benchmark), 'administrator');
    assert.equal(auditRoleOf(companyAdmin), 'company administrator');
    assert.equal(auditRoleOf(facilitator), 'facilitator');
    assert.equal(auditRoleOf(asha), 'participant');
  });

  it('goes outside every customer for the glossary, and inside the customer otherwise', async () => {
    await recordAudit(
      benchmark,
      { action: 'updated', subjectType: 'glossary-term', subjectId: 'UPS' },
      { store, immediate: true },
    );
    const platform = await store.all<AuditEntry>(PLATFORM_AUDIT);
    assert.equal(platform.length, 1);
    assert.equal(platform[0]?.orgId, undefined);
    assert.equal((await entries()).length, 0);
  });

  it('is dropped, not misfiled, when customer data is changed by somebody with no customer', async () => {
    const { orgId: _ignored, ...nobody } = benchmark;
    void _ignored;
    await recordAudit(
      nobody,
      { action: 'viewed', subjectType: 'profile', subjectId: 'asha' },
      { store, immediate: true },
    );
    assert.equal((await store.all(PLATFORM_AUDIT)).length, 0);
  });

  it('is written off the response path by default, and still lands outside a request', async () => {
    await recordAudit(
      companyAdmin,
      {
        action: 'deleted',
        subjectType: 'profile',
        subjectId: 'asha',
      },
      { store },
    );
    assert.equal((await entries()).length, 1);
  });
});

describe('reading the history', () => {
  beforeEach(async () => {
    const at = (iso: string) => Date.parse(iso);
    const write = (subjectType: 'profile' | 'question-bank', iso: string, orgId = ORG) =>
      recordAudit(
        { ...companyAdmin, orgId },
        { action: 'viewed', subjectType, subjectId: iso },
        { store, now: at(iso), immediate: true },
      );
    await write('profile', '2026-11-02T10:00:00.000Z');
    await write('question-bank', '2026-11-02T11:00:00.000Z');
    await write('profile', '2026-11-20T10:00:00.000Z');
    await write('profile', '2026-10-31T23:00:00.000Z');
    await write('profile', '2026-11-02T12:00:00.000Z', 'globex');
    await recordAudit(
      benchmark,
      { action: 'created', subjectType: 'glossary-term', subjectId: 'PUE' },
      { store, now: at('2026-11-03T09:00:00.000Z'), immediate: true },
    );
  });

  it('reads a month, newest first, and only this customer', async () => {
    const month = await auditHistory(ORG, { month: '2026-11' }, { store });
    assert.deepEqual(
      month.map((entry) => entry.subjectId),
      ['2026-11-20T10:00:00.000Z', '2026-11-02T11:00:00.000Z', '2026-11-02T10:00:00.000Z'],
    );
  });

  it('reads a day, and one kind of subject', async () => {
    const day = await auditHistory(ORG, { day: '2026-11-02', subjectType: 'profile' }, { store });
    assert.deepEqual(
      day.map((entry) => entry.subjectId),
      ['2026-11-02T10:00:00.000Z'],
    );
  });

  it('reads the glossary from the platform, and nothing for a period it cannot parse', async () => {
    const glossary = await platformAuditHistory({ month: '2026-11' }, { store });
    assert.deepEqual(
      glossary.map((entry) => entry.subjectId),
      ['PUE'],
    );
    assert.deepEqual(await auditHistory(ORG, { month: 'November' }, { store }), []);
  });
});

// ------------------------------------------------------------ the call sites

describe('profiles', () => {
  let roster: DocumentRosterStore;

  beforeEach(async () => {
    roster = new DocumentRosterStore(store);
    await roster.upsertPerson({ id: asha.id, email: asha.email, name: 'Asha', orgId: ORG });
    await saveProfile(asha, { name: 'Asha', department: 'Facilities' }, { store });
  });

  it('records a view by somebody other than the owner', async () => {
    const view = await viewProfile(benchmark, asha.id, { roster, store });
    assert.ok(view?.profile);
    const [entry] = await entries();
    assert.equal(entry?.action, 'viewed');
    assert.equal(entry?.subjectType, 'profile');
    assert.equal(entry?.subjectId, asha.id);
    assert.equal(entry?.actorId, benchmark.id);
  });

  it('records nothing for the owner reading their own, or for a refusal', async () => {
    await viewProfile(asha, asha.id, { roster, store });
    assert.equal(await viewProfile(companyAdmin, asha.id, { roster, store }), null);
    assert.equal((await entries()).length, 0);
  });

  it('records each profile an upload prefilled, against the person', async () => {
    const header = TEMPLATE_COLUMNS.join(',');
    const line = (email: string) =>
      TEMPLATE_COLUMNS.map((column) =>
        column === 'email' ? email : column === 'name' ? 'Someone' : '',
      ).join(',');
    const read = readUpload(
      [header, line('ben@acme.example'), line('cara@acme.example')].join('\n'),
    );
    assert.ok(read.ok);
    const uploader = person('upl', 'admin');
    await importParticipants(uploader, read.rows, { roster, store });
    const uploaded = (await entries()).filter((entry) => entry.action === 'uploaded');
    assert.equal(uploaded.length, 2);
    assert.ok(
      uploaded.every((entry) => entry.subjectType === 'profile' && entry.actorId === 'upl'),
    );
  });
});

describe('assessments and question banks', () => {
  const DECK = 'security-basics-a1b2c3';
  const QUESTIONS: Omit<BankQuestion, 'id'>[] = Array.from({ length: 4 }, (_, index) => ({
    question: `Question ${index + 1}`,
    options: ['Right', 'Wrong'],
    correctIndex: 0,
  }));
  let roster: DocumentRosterStore;

  beforeEach(async () => {
    roster = new DocumentRosterStore(store);
    await roster.upsertPerson({ id: asha.id, email: asha.email, name: 'Asha', orgId: ORG });
    await roster.assign({ personId: asha.id, deckId: DECK, assignedBy: companyAdmin.id });
  });

  it('records a bank uploaded, generated, re-banded and removed', async () => {
    const options = { store, roster };
    await saveBank(benchmark, DECK, 'pre', QUESTIONS, 'upload', options);
    await saveBank(benchmark, DECK, 'post', QUESTIONS, 'sample', options);
    await setLevelBands(benchmark, DECK, { intermediateFrom: 40, advancedFrom: 80 }, options);
    await removeBank(benchmark, DECK, 'post', options);

    const banks = (await entries())
      .filter((entry) => entry.subjectType === 'question-bank')
      .sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(banks.map((entry) => entry.action).sort(), [
      'created',
      'deleted',
      'updated',
      'uploaded',
    ]);
  });

  it('records a submission, and every view of the results', async () => {
    const options = { store, roster };
    await saveBank(benchmark, DECK, 'pre', QUESTIONS, 'upload', options);
    const paper = await assessmentPaper(ORG, DECK, 'pre', options);
    assert.ok(paper);
    await submitAssessment(
      asha,
      {
        deckId: DECK,
        kind: 'pre',
        version: paper.version,
        answers: { q1: 0, q2: 0, q3: 1, q4: 0 },
        sessionId: null,
      },
      options,
    );
    await resultsForDeck(companyAdmin, DECK, null, options);

    const results = (await entries()).filter((entry) => entry.subjectType === 'assessment-result');
    const submitted = results.find((entry) => entry.action === 'created');
    const viewed = results.find((entry) => entry.action === 'viewed');
    assert.equal(submitted?.actorId, asha.id);
    assert.equal(submitted?.actorRole, 'participant');
    assert.equal(viewed?.actorId, companyAdmin.id);
    assert.equal(viewed?.subjectId, DECK);
    assert.match(viewed?.detail ?? '', /1 person/);
  });
});

describe('the routes, read from the source', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  it('record a profile saved, and consent withdrawn, by its owner', () => {
    const route = read('src/app/api/profile/route.ts');
    assert.match(
      route,
      /saveProfile\(gate\.person[\s\S]*?recordAudit\(gate\.person, \{\s*action: before \? 'updated' : 'created',\s*subjectType: 'profile'/,
    );
    assert.match(
      route,
      /deleteProfile\(gate\.person\);[\s\S]*?recordAudit\(gate\.person, \{\s*action: 'withdrawn',\s*subjectType: 'profile'/,
    );
  });

  it('record agreement at sign-in, with any profile given', () => {
    assert.match(
      read('src/app/api/consent/route.ts'),
      /recordConsent\(person, 'given'[\s\S]*?recordAudit\(person, \{[\s\S]*?subjectType: 'profile'/,
    );
  });

  it('record the profile going when a person is removed or moved', () => {
    assert.match(
      read('src/app/api/people/[id]/route.ts'),
      /deleteProfile\([\s\S]*?recordAudit\(admin, \{\s*action: 'deleted',\s*subjectType: 'profile'/,
    );
    assert.match(
      read('src/app/api/platform/move/route.ts'),
      /movePerson\([\s\S]*?recordAudit\(\s*\{ \.\.\.staff, orgId: fromOrgId \},\s*\{\s*action: 'deleted',\s*subjectType: 'profile'/,
    );
  });

  it('record deck approval and its clearing', () => {
    const approval = read('src/lib/decks/approval.ts');
    assert.match(approval, /action: 'approved',\s*subjectType: 'deck-approval'/);
    assert.match(approval, /action: 'withdrawn',\s*subjectType: 'deck-approval'/);
  });

  it('show the history to the administrator alone, linked from the header', () => {
    const page = read('src/app/audit/page.tsx');
    assert.match(page, /if \(!isAdministrator\(person\)\) notFound\(\);/);
    assert.match(
      read('src/components/MainNav.tsx'),
      /if \(isAdministrator\(person\)\) links\.push\(\{ href: '\/audit', label: 'Audit history' \}\);/,
    );
  });

  it('is purged with the customer, along with deck approvals', () => {
    const lifecycle = read('src/lib/orgs/lifecycle.ts');
    assert.match(lifecycle, /'deckApprovals',\s*'audit',/);
    assert.match(lifecycle, /collection === 'deckApprovals' \|\|\s*collection === 'audit' \|\|/);
  });
});
