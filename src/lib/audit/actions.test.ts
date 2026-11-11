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
  recordConsentAudit,
  type AuditEntry,
} from './log';

/**
 * The widened audit history (AI-40): consent changes, role changes, downloads, deletions,
 * and the administrators' own actions, readable by the Benchmark administrator alone.
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

describe('downloads', () => {
  it('records the participant upload template', () => {
    const text = read('src/app/api/profiles/template/route.ts');
    assert.ok(
      text.indexOf("action: 'downloaded'") < text.indexOf('new Response(templateCsv()'),
      'the download is not recorded before it is sent',
    );
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
