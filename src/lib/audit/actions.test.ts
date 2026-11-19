import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';

import type { Role, SignedInPerson } from '../roster/types';
import { InMemoryDocumentStore } from '../roster/documents';
import {
  AUDIT,
  AUDIT_ACTIONS,
  AUDIT_SUBJECT_LABELS,
  AUDIT_SUBJECTS,
  isPlatformAuditSubject,
  PLATFORM_AUDIT,
  recordConsentAudit,
  recordCustomerAudit,
  recordPersonAudit,
  type AuditEntry,
} from './log';

/**
 * The widened audit history (AI-40): consent changes, people added, role changes,
 * downloads, deletions, and the administrators' own actions, readable by the Benchmark
 * administrator alone.
 *
 * What can be driven without a server is driven. The rest sits in routes, which need a
 * session to call, so each is read out of the source as log.test.ts does: the action and
 * the subject it records, after the change it records.
 *
 * Attendance edits, cancelling a session and the session summary download are recorded
 * inside src/lib/training/ and the summary route, and are tested there.
 */

const read = (path: string) => readFileSync(path, 'utf8');

/** That the file records this action on this subject, after the call that does the thing. */
function records(path: string, after: RegExp, action: string, subject: string): void {
  const text = read(path);
  const start = text.search(after);
  assert.ok(start >= 0, `${path} no longer does what it should record`);
  const rest = text.slice(start);
  assert.match(
    rest,
    new RegExp(
      `record(?:Audit|ConsentAudit)\\([\\s\\S]*?${action === 'consent' ? '' : `action: '${action}',\\s*subjectType: '${subject}'`}`,
    ),
    `${path} does not record ${action} ${subject} after it`,
  );
}

describe('the vocabulary', () => {
  it('has the subjects and actions the widened history needs, each labelled', () => {
    for (const subject of [
      'consent',
      'person',
      'deck',
      'assignment',
      'batch',
      'training-session',
      'participant-upload',
    ] as const) {
      assert.ok(AUDIT_SUBJECTS.includes(subject), `no subject ${subject}`);
      assert.ok(AUDIT_SUBJECT_LABELS[subject], `no label for ${subject}`);
    }
    for (const action of [
      'given',
      'withdrawn',
      'downloaded',
      'published',
      'unpublished',
      'analysed',
      'assigned',
      'unassigned',
      'role-changed',
      'deleted',
    ] as const) {
      assert.ok(AUDIT_ACTIONS.includes(action), `no action ${action}`);
    }
  });
});

describe('consent', () => {
  let store: InMemoryDocumentStore;
  beforeEach(() => {
    store = new InMemoryDocumentStore();
  });

  function person(extra: Partial<SignedInPerson> = {}): SignedInPerson {
    return {
      id: 'asha',
      orgId: 'acme',
      homeOrgId: 'acme',
      platform: false,
      email: 'asha@acme.example',
      emailKey: 'asha@acme.example',
      name: 'Asha',
      role: 'trainee' as Role,
      createdAt: '2026-11-01T00:00:00.000Z',
      lastSeenAt: null,
      ...extra,
    };
  }

  it('records consent given and withdrawn, as consent', async () => {
    const asha = person();
    const options = { store, immediate: true };
    await recordConsentAudit(
      asha,
      { decision: 'given', noticeVersion: 'v1', withProfile: true },
      options,
    );
    await recordConsentAudit(
      asha,
      { decision: 'withdrawn', noticeVersion: 'v1', withProfile: false },
      options,
    );
    const entries = await store.all<AuditEntry>(`orgs/acme/${AUDIT}`);
    assert.deepEqual(entries.map((entry) => `${entry.action} ${entry.subjectType}`).sort(), [
      'given consent',
      'withdrawn consent',
    ]);
  });

  it('files Technavious staff’s own consent at home, not in the customer they are looking at', async () => {
    const staff = person({
      id: 'bench',
      orgId: 'acme',
      homeOrgId: 'technavious',
      platform: true,
      role: 'admin',
    });
    await recordConsentAudit(
      staff,
      { decision: 'given', noticeVersion: 'v1', withProfile: false },
      { store, immediate: true },
    );
    assert.equal((await store.all(`orgs/acme/${AUDIT}`)).length, 0);
    assert.equal((await store.all(`orgs/technavious/${AUDIT}`)).length, 1);
  });

  it('is recorded wherever consent is given or withdrawn', () => {
    records('src/app/api/consent/route.ts', /recordConsent\(person, 'given'/, 'consent', 'consent');
    const profile = read('src/app/api/profile/route.ts');
    assert.equal(
      [...profile.matchAll(/recordConsentAudit\(gate\.person, consent\)/g)].length,
      2,
      'a profile save or a withdrawal no longer records the consent',
    );
    assert.match(read('src/app/api/consent/route.ts'), /recordConsentAudit\(person, consent\)/);
  });
});

describe('people', () => {
  const route = 'src/app/api/people/[id]/route.ts';

  it('records a role change', () => {
    records(route, /store\.setRole\(id, body\.role\)/, 'role-changed', 'person');
  });

  it('records the removal of a person, as well as of their profile', () => {
    records(route, /roster\.removePerson\(id/, 'deleted', 'person');
    records(route, /deleteProfile\(/, 'deleted', 'profile');
  });
});

describe('people added (D-02)', () => {
  let store: InMemoryDocumentStore;
  beforeEach(() => {
    store = new InMemoryDocumentStore();
  });

  const hr: SignedInPerson = {
    id: 'hr',
    orgId: 'acme',
    homeOrgId: 'acme',
    platform: false,
    email: 'hr@acme.example',
    emailKey: 'hr@acme.example',
    name: 'Hema',
    role: 'admin',
    createdAt: '2026-11-01T00:00:00.000Z',
    lastSeenAt: '2026-11-01T00:00:00.000Z',
  };
  const asha = { id: 'local-asha-acme-example', email: 'asha@acme.example', name: '' };
  const at = (minute: number) => ({
    store,
    immediate: true,
    now: Date.parse(`2026-11-19T09:0${minute}:00.000Z`),
  });
  const entriesIn = async (orgId: string) =>
    (await store.all<AuditEntry>(`orgs/${orgId}/${AUDIT}`)).sort((a, b) =>
      a.id.localeCompare(b.id),
    );

  it('has an action for it, on the subject people already had', () => {
    // No new vocabulary: adding is 'created', as setting up a batch or a session is, and
    // the history page lists every subject and prints the action as it is stored.
    for (const action of ['created', 'updated', 'deleted'] as const) {
      assert.ok(AUDIT_ACTIONS.includes(action), `no action ${action}`);
    }
    assert.ok(AUDIT_SUBJECTS.includes('person'));
    assert.equal(AUDIT_SUBJECT_LABELS.person, 'People and roles');
    assert.ok(!isPlatformAuditSubject('person'), 'people belong to their customer');
    assert.match(read('src/app/audit/page.tsx'), /AUDIT_SUBJECTS\.map\(/);
  });

  it('records who was added by hand, with which role, by whom and when', async () => {
    await recordPersonAudit(hr, { ...asha, role: 'trainee' }, { kind: 'added' }, at(0));
    const [entry, ...rest] = await entriesIn('acme');
    assert.deepEqual(rest, []);
    assert.equal(entry!.action, 'created');
    assert.equal(entry!.subjectType, 'person');
    assert.equal(entry!.subjectId, asha.id);
    assert.equal(entry!.detail, 'Added asha@acme.example by hand, with the role trainee');
    assert.equal(entry!.actorId, 'hr');
    assert.equal(entry!.actorEmail, 'hr@acme.example');
    assert.equal(entry!.actorRole, 'company administrator');
    assert.equal(entry!.orgId, 'acme');
    assert.equal(entry!.at, '2026-11-19T09:00:00.000Z');
    // In the customer's own history, and nowhere a different customer could read it.
    assert.deepEqual(await store.all(PLATFORM_AUDIT), []);
    assert.deepEqual(await entriesIn('globex'), []);
  });

  it('says that an address added again made nobody new and changed no role', async () => {
    const facilitator = { id: 'fran-uid', email: 'fran@acme.example', role: 'facilitator' as Role };
    await recordPersonAudit(
      hr,
      { ...facilitator, name: 'Fran' },
      { kind: 'added-again', nameBefore: 'Fran' },
      at(0),
    );
    await recordPersonAudit(
      hr,
      { ...facilitator, name: 'Fran Dsouza' },
      { kind: 'added-again', nameBefore: 'Fran' },
      at(1),
    );
    await recordPersonAudit(
      hr,
      { ...facilitator, name: 'Fran' },
      { kind: 'added-again', nameBefore: '' },
      at(2),
    );
    const entries = await entriesIn('acme');
    assert.deepEqual(
      entries.map((entry) => [entry.action, entry.subjectType, entry.subjectId, entry.detail]),
      [
        [
          'updated',
          'person',
          'fran-uid',
          'Added fran@acme.example again: already here with the role facilitator, which was not changed',
        ],
        [
          'updated',
          'person',
          'fran-uid',
          'Added fran@acme.example again: already here with the role facilitator, which was not changed. Their name was changed from "Fran" to "Fran Dsouza"',
        ],
        [
          'updated',
          'person',
          'fran-uid',
          'Added fran@acme.example again: already here with the role facilitator, which was not changed. Their name was set to "Fran"',
        ],
      ],
    );
  });

  it('records somebody a participant upload added, with the line they came from', async () => {
    await recordPersonAudit(
      { ...hr, id: 'fran-uid', email: 'fran@acme.example', role: 'facilitator' },
      { ...asha, role: 'trainee' },
      { kind: 'uploaded', line: 7 },
      at(0),
    );
    const [entry] = await entriesIn('acme');
    assert.deepEqual(
      [entry!.action, entry!.subjectType, entry!.actorRole, entry!.detail],
      [
        'created',
        'person',
        'facilitator',
        'Added asha@acme.example from line 7 of a participant upload, with the role trainee',
      ],
    );
  });

  it('records a move in both customers: leaving one, and arriving in the other', async () => {
    const staff: SignedInPerson = {
      ...hr,
      id: 'bench',
      email: 'bench@technavious.example',
      orgId: 'technavious',
      homeOrgId: 'technavious',
      platform: true,
    };
    const moving = { ...asha, id: 'asha-uid', role: 'facilitator' as Role };
    await recordPersonAudit(
      { ...staff, orgId: 'globex' },
      moving,
      { kind: 'moved-out', toOrgId: 'acme' },
      at(0),
    );
    await recordPersonAudit(
      { ...staff, orgId: 'acme' },
      { ...moving, role: 'trainee' },
      { kind: 'moved-in', fromOrgId: 'globex' },
      at(1),
    );
    const [left] = await entriesIn('globex');
    const [arrived] = await entriesIn('acme');
    assert.deepEqual(
      [left!.action, left!.subjectType, left!.subjectId, left!.detail, left!.actorRole],
      [
        'deleted',
        'person',
        'asha-uid',
        'Moved asha@acme.example to "acme", which removed them from here with their assignments',
        'administrator',
      ],
    );
    assert.deepEqual(
      [arrived!.action, arrived!.subjectType, arrived!.subjectId, arrived!.detail],
      [
        'created',
        'person',
        'asha-uid',
        'Moved asha@acme.example here from "globex", with the role trainee',
      ],
    );
    assert.deepEqual(await entriesIn('technavious'), []);
  });

  it('is recorded by the people route once the row is written, new or already here', () => {
    const route = read('src/app/api/people/route.ts');
    const looked = route.indexOf('const existing = await store.getPersonByEmail(email);');
    const written = route.indexOf('const person = await store.upsertPerson(');
    const recorded = route.indexOf('await recordPersonAudit(', written);
    const answered = route.indexOf('return Response.json(person,', written);
    assert.ok(looked >= 0 && looked < written, 'whether they were here is not read first');
    assert.ok(recorded > written, 'adding somebody is not recorded after it');
    assert.ok(answered > recorded, 'the answer goes before the entry is queued');
    assert.match(
      route,
      /recordPersonAudit\(\s*admin,\s*person,\s*existing \? \{ kind: 'added-again', nameBefore: existing\.name \} : \{ kind: 'added' \},\s*\)/,
    );
  });

  it('cannot be given a role at the same time, so a role is always its own entry', () => {
    // The route reads an address and a name from the request and nothing else, and the
    // store never takes a role for somebody already here. Anything but an employee is
    // therefore the PATCH on /api/people/{id}, which records 'role-changed'.
    const route = read('src/app/api/people/route.ts');
    assert.match(route, /store\.upsertPerson\(\{ email, name: body\.name\?\.trim\(\) \}\)/);
    assert.doesNotMatch(route, /body\.role|setRole\(/);
    records(
      'src/app/api/people/[id]/route.ts',
      /store\.setRole\(id, body\.role\)/,
      'role-changed',
      'person',
    );
  });

  it('is recorded for each person an upload creates, and for nobody it only found', () => {
    assert.match(
      read('src/lib/profiles/upload.ts'),
      /if \(!existing\) \{\s*await recordPersonAudit\(\s*uploader,\s*person,\s*\{ kind: 'uploaded', line: row\.line \},/,
    );
  });

  it('is recorded for a move in the customer left and the customer joined', () => {
    const route = read('src/app/api/platform/move/route.ts');
    const moved = route.indexOf('await movePerson(person.id, fromOrgId, toOrgId);');
    assert.ok(moved >= 0, 'the route no longer moves anybody');
    const after = route.slice(moved);
    assert.match(
      after,
      /recordPersonAudit\(\{ \.\.\.staff, orgId: fromOrgId \}, person, \{\s*kind: 'moved-out',\s*toOrgId,\s*\}\)/,
    );
    assert.match(
      after,
      /recordPersonAudit\(\s*\{ \.\.\.staff, orgId: toOrgId \},\s*arrived \?\? \{ \.\.\.person, role: 'trainee' \},\s*\{ kind: 'moved-in', fromOrgId \},\s*\)/,
    );
  });
});

describe('downloads', () => {
  it('records the participant upload template', () => {
    const text = read('src/app/api/profiles/template/route.ts');
    assert.ok(
      text.indexOf("action: 'downloaded'") < text.indexOf('new Response(templateCsv()'),
      'the download is not recorded before it is sent',
    );
  });
});

describe('participant uploads', () => {
  const route = 'src/app/api/profiles/upload/route.ts';

  it('records each upload once, with its counts, after it is imported (AI-60)', () => {
    const text = read(route);
    const imported = text.indexOf('await importParticipants(');
    assert.ok(imported >= 0, 'the route no longer imports');
    assert.ok(
      text.indexOf('recordUploadAudit(uploader, results)', imported) > imported,
      'the upload is not recorded after it is imported',
    );
    assert.match(
      read('src/lib/profiles/upload.ts'),
      /action: 'uploaded',\s*subjectType: 'participant-upload'/,
    );
  });

  it('still records each profile it prefills, as it did before', () => {
    records('src/lib/profiles/upload.ts', /saveUploadedProfile\(/, 'uploaded', 'profile');
  });
});

describe('decks', () => {
  it('records an upload', () => {
    records('src/app/api/decks/route.ts', /store\.save\(record, 'draft'\)/, 'uploaded', 'deck');
  });

  it('records publishing, withdrawing and editing', () => {
    const text = read('src/app/api/decks/[id]/route.ts');
    assert.match(text, /status === 'published' \? 'published' : 'unpublished'\) : 'updated'/);
    assert.match(text, /recordAudit\(gate\.person, \{\s*action,\s*subjectType: 'deck'/);
  });

  it('records a deletion', () => {
    records('src/app/api/decks/[id]/route.ts', /removeDeckEverywhere\(/, 'deleted', 'deck');
  });

  it('records an analysis, once per run', () => {
    records(
      'src/app/api/decks/[id]/analyse/route.ts',
      /analyseDeckMeta\(deck\)/,
      'analysed',
      'deck',
    );
  });

  it('records approval, as it did before', () => {
    assert.match(
      read('src/lib/decks/approval.ts'),
      /action: 'approved',\s*subjectType: 'deck-approval'/,
    );
  });

  it('records question banks saved and deleted, as it did before', () => {
    const service = read('src/lib/assessments/service.ts');
    assert.match(service, /subjectType: 'question-bank'/);
  });
});

describe('assignments', () => {
  const route = 'src/app/api/assignments/route.ts';
  it('records assigning and unassigning', () => {
    records(route, /store\.assign\(\{/, 'assigned', 'assignment');
    records(route, /\.unassign\(body\.personId, body\.deckId\)/, 'unassigned', 'assignment');
  });
});

describe('batches and sessions', () => {
  it('records a batch set up, changed and deleted', () => {
    records('src/app/api/batches/route.ts', /createBatch\(person, body\)/, 'created', 'batch');
    records('src/app/api/batches/[id]/route.ts', /updateBatch\(person,/, 'updated', 'batch');
    records('src/app/api/batches/[id]/route.ts', /removeBatch\(person, id\)/, 'deleted', 'batch');
  });

  it('records a session set up, opened or closed, and deleted', () => {
    records(
      'src/app/api/training-sessions/route.ts',
      /createSession\(person, body\)/,
      'created',
      'training-session',
    );
    records(
      'src/app/api/training-sessions/[id]/route.ts',
      /changeSession\(person, id, body\)/,
      'updated',
      'training-session',
    );
    // Deleting is recorded where it is done, so the route does not record it twice.
    records(
      'src/lib/training/service.ts',
      /export async function removeSession/,
      'deleted',
      'training-session',
    );
  });
});

describe('customers suspended, reinstated and closed (AI-52)', () => {
  let store: InMemoryDocumentStore;
  beforeEach(() => {
    store = new InMemoryDocumentStore();
  });

  const staff: SignedInPerson = {
    id: 'bench',
    orgId: 'technavious',
    homeOrgId: 'technavious',
    platform: true,
    email: 'bench@technavious.example',
    emailKey: 'bench@technavious.example',
    name: 'Bench',
    role: 'admin',
    createdAt: '2026-11-01T00:00:00.000Z',
    lastSeenAt: null,
  };

  it('has the actions and a labelled subject for them', () => {
    for (const action of ['suspended', 'reinstated', 'deleted'] as const) {
      assert.ok(AUDIT_ACTIONS.includes(action), `no action ${action}`);
    }
    assert.ok(AUDIT_SUBJECTS.includes('customer'));
    assert.equal(AUDIT_SUBJECT_LABELS.customer, 'Customers');
    assert.ok(isPlatformAuditSubject('customer'));
    assert.ok(isPlatformAuditSubject('glossary-term'));
    assert.ok(!isPlatformAuditSubject('training-session'));
  });

  it('records who did each and when, in the platform history rather than the customer', async () => {
    // A minute apart, so the entries sort in the order they were made: two in the same
    // millisecond are told apart by a random tail, not by order.
    const at = (minute: number) => ({
      store,
      immediate: true,
      now: Date.parse(`2026-11-16T10:0${minute}:00.000Z`),
    });
    // Acting from inside the customer, as platform staff can, still files it outside them.
    const inside = { ...staff, orgId: 'acme' };
    await recordCustomerAudit(inside, 'acme', { kind: 'suspended' }, at(0));
    await recordCustomerAudit(inside, 'acme', { kind: 'reinstated' }, at(1));
    await recordCustomerAudit(staff, 'acme', { kind: 'closed', decks: 3, documents: 1 }, at(2));

    assert.equal((await store.all(`orgs/acme/${AUDIT}`)).length, 0);
    const entries = (await store.all<AuditEntry>(PLATFORM_AUDIT)).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    assert.deepEqual(
      entries.map((entry) => [entry.action, entry.subjectType, entry.subjectId, entry.detail]),
      [
        [
          'suspended',
          'customer',
          'acme',
          'Suspended customer acme: nobody there can sign in until it is reinstated',
        ],
        [
          'reinstated',
          'customer',
          'acme',
          'Reinstated customer acme: its people can sign in again',
        ],
        [
          'deleted',
          'customer',
          'acme',
          'Closed customer acme and deleted everything of theirs: 3 decks and 1 record',
        ],
      ],
    );
    for (const [index, entry] of entries.entries()) {
      assert.equal(entry.actorEmail, staff.email);
      assert.equal(entry.actorRole, 'administrator');
      assert.equal(entry.at, `2026-11-16T10:0${index}:00.000Z`);
      assert.equal(entry.orgId, undefined);
    }
  });

  it('is recorded by the route, after the change and only when the status changes', () => {
    const route = read('src/app/api/platform/customers/[id]/route.ts');
    const before = route.indexOf('const before = await orgStore().get(id);');
    const suspended = route.indexOf('await suspend(id);');
    const recorded = route.indexOf('await recordCustomerAudit(person, id, {', suspended);
    assert.ok(before >= 0 && before < suspended, 'the status is not read before it is changed');
    assert.ok(recorded > suspended, 'suspending or reinstating is not recorded after it');
    assert.match(route, /if \(before && before\.status !== body\.status\) \{/);
    assert.match(route, /kind: body\.status === 'suspended' \? 'suspended' : 'reinstated'/);

    const purged = route.indexOf('await purge(id);');
    const closed = route.indexOf("kind: 'closed'");
    assert.ok(purged >= 0 && closed > purged, 'closing a customer is not recorded after it');
  });

  it('is read from the platform on the history page, whoever it is about', () => {
    const page = read('src/app/audit/page.tsx');
    assert.match(page, /isPlatformAuditSubject\(filter\.subjectType\)/);
  });
});

describe('who may read it', () => {
  it('is the Benchmark administrator alone, a 404 for anybody else', () => {
    const page = read('src/app/audit/page.tsx');
    assert.match(page, /if \(!isAdministrator\(person\)\) notFound\(\);/);
    // The only way the history is read is through this page.
    assert.doesNotMatch(
      read('src/components/MainNav.tsx'),
      /'\/audit'[^\n]*\n[^\n]*isCompanyAdmin/,
    );
  });
});
