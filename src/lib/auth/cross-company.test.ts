import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import { resultsForDeck } from '../assessments/service';
import { assessmentDocuments, ASSESSMENT_RESULTS } from '../assessments/store';
import type { AssessmentResult } from '../assessments/types';
import { scopedDocuments } from '../orgs/scope';
import { saveProfile } from '../profiles/store';
import { viewProfile } from '../profiles/view';
import { eraseLeaverAnswers } from '../retention/leaving';
import { InMemoryDocumentStore } from '../roster/documents';
import { DocumentRosterStore } from '../roster/store-documents';
import type { Role, SignedInPerson } from '../roster/types';
import { removeBatch, removeSession, sessionFor, updateBatch } from '../training/service';
import { trainingStore } from '../training/store';
import type { TrainingSession } from '../training/types';

/**
 * Cross-company access through direct links and the API, not only on screen (AI-38, as
 * the product owner numbered it).
 *
 * Every route and page that takes an id, whether in its path, its query or its body,
 * must resolve that id inside the caller's own organisation and refuse with a 404
 * otherwise. The guarantee is structural: every store is built from an organisation id,
 * and every id-taking file builds its stores from the organisation of the person its
 * guard returned, never from anything in the request. A deck, person, session, batch,
 * result, bank or profile id from another customer therefore names something that does
 * not exist in the store the request can reach, and comes back as nothing, which the
 * file turns into a 404.
 *
 * Two halves, in the style of boundary.test.ts and scoping.test.ts. The first reads the
 * source: each id-taking file is listed here with how it scopes, every store call in it
 * is checked to take the guarded person's organisation, and a new id-taking file that is
 * not listed fails the test. The second drives the services those files call with an id
 * from another customer, and checks the refusal.
 *
 * Technavious's platform staff may look inside a customer deliberately, by choosing it
 * (`actingOrgId`); while they do, their guarded person's organisation is that customer,
 * so the same rule covers them. The platform routes that name a customer by id are the
 * deliberate exceptions and say so below.
 */

const APP = join('src', 'app');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name === 'route.ts' || entry.name === 'page.tsx') out.push(path);
  }
  return out;
}

const FILES = walk(APP).map((path) => path.slice(APP.length + 1).replace(/\\/g, '/'));
const source = (relative: string) => readFileSync(join(APP, relative), 'utf8');

/**
 * What makes a file id-taking: a dynamic segment in its path, a query string, or an id
 * read out of a request body.
 */
function takesAnId(relative: string): boolean {
  if (relative.includes('[')) return true;
  const text = source(relative);
  return (
    /searchParams/.test(text) || /body\??\.(deckId|personId|sessionId|batchId|id)\b/.test(text)
  );
}

/**
 * Every id-taking file, and how it keeps the id inside the caller's organisation.
 *
 * `scoped` is what must be in the file: the guarded person handed to a service that
 * builds its stores from that person, or a store built from their organisation.
 */
const ID_TAKING: Record<string, { scoped: RegExp[]; why: string }> = {
  'api/assessments/route.ts': {
    scoped: [/submitAssessment\(gate\.person,/],
    why: 'The deck and session ids in the body are read through stores built from the participant, and an unassigned deck is refused.',
  },
  'api/assignments/route.ts': {
    scoped: [/rosterStore\(admin\.orgId\)/, /loadStoredDeck\(admin\.orgId, deckId\)/],
    why: 'The person and the deck are both looked up in the administrator’s own organisation, and a miss is a 404.',
  },
  'api/batches/[id]/route.ts': {
    scoped: [/updateBatch\(person,/, /removeBatch\(person,/],
    why: 'The training service reads the batch through trainingStore(person.orgId) and 404s one the person may not run.',
  },
  'api/chat/route.ts': {
    scoped: [/checkAssignedDeck\(/, /loadDeck\(gate\.person\.orgId/],
    why: 'The deck must be assigned to the caller, or facilitated by them, in their own organisation; the session id is read through their trainingStore.',
  },
  'api/decks/[id]/analyse/route.ts': {
    scoped: [/checkAdministrator\(\)/, /deckStore\(gate\.person\.orgId\)/],
    why: 'Technavious only, and the deck is read from the organisation they are in.',
  },
  'api/decks/[id]/approval/route.ts': {
    scoped: [/checkAdministrator\(\)/, /approveDeck\(gate\.person,/],
    why: 'Technavious only; approveDeck loads the deck from the approver’s organisation and 404s a miss.',
  },
  'api/decks/[id]/assets/[...name]/route.ts': {
    scoped: [/checkDeckViewer\(id\)/, /assetStore\(gate\.person\.orgId\)/],
    why: 'Reading needs the deck to be viewable by the caller; both directions use the caller’s organisation’s asset store.',
  },
  'api/decks/[id]/questions/[kind]/route.ts': {
    scoped: [/mayManageBanks\(gate\.person\)/, /loadStoredDeck\(gate\.person\.orgId, id\)/],
    why: 'Technavious only, and the deck must exist in the organisation they are in.',
  },
  'api/decks/[id]/questions/[kind]/sample/route.ts': {
    scoped: [/mayManageBanks\(gate\.person\)/, /loadDeck\(gate\.person\.orgId, id\)/],
    why: 'Technavious only, and the deck must exist in the organisation they are in.',
  },
  'api/decks/[id]/route.ts': {
    scoped: [/checkAdministrator\(\)/, /deckStore\(gate\.person\.orgId\)/],
    why: 'Technavious only, and the deck is read and removed in the organisation they are in.',
  },
  'api/feedback/route.ts': {
    scoped: [/submitFeedback\(gate\.person,/],
    why: 'As for assessments: read through stores built from the participant.',
  },
  'api/glossary/[id]/route.ts': {
    scoped: [/isAdministrator\(gate\.person\)/],
    why: 'The glossary belongs to no customer. Technavious only.',
  },
  'api/people/[id]/profile/route.ts': {
    scoped: [/viewProfile\(viewer, id\)/],
    why: 'viewProfile finds the person in the viewer’s own roster and returns nothing for anybody else.',
  },
  'api/people/[id]/route.ts': {
    scoped: [/rosterStore\(admin\.orgId\)/, /No such person/],
    why: 'The person is found in the administrator’s own roster before anything is changed or removed.',
  },
  'api/platform/customers/[id]/route.ts': {
    scoped: [/isPlatformAdmin\(person\.email\)/],
    why: 'Deliberately cross-customer: platform staff suspending, resuming or removing a customer. Nobody else.',
  },
  'api/progress/route.ts': {
    scoped: [/requireAssignedDeck\(/, /rosterStore\(person\.orgId\)/],
    why: 'The deck must be assigned to the caller in their own organisation, and progress is the caller’s own.',
  },
  'api/training-sessions/[id]/route.ts': {
    scoped: [/sessionFor\(person, id\)/, /changeSession\(person,/, /removeSession\(person,/],
    why: 'The training service reads the session through trainingStore(person.orgId) and 404s one the person may not run.',
  },
  'api/training-sessions/[id]/participants/route.ts': {
    scoped: [/addParticipants\(person,/],
    why: 'addParticipants asks sessionFor first, which reads through trainingStore(person.orgId) and 404s a session from elsewhere, and only adds people on the company roster.',
  },
  'api/training-sessions/[id]/summary/route.ts': {
    scoped: [/closureSummary\(person,/, /loadDeck\(person\.orgId/],
    why: 'closureSummary asks sessionFor first, which 404s a session from elsewhere.',
  },
  'assessment/[kind]/page.tsx': {
    scoped: [/loadStoredDeck\(person\.orgId, deckId\)/],
    why: 'The deck in the query is loaded from the participant’s organisation, and a session id is checked by the assessment service.',
  },
  'audit/page.tsx': {
    scoped: [/if \(!isAdministrator\(person\)\) notFound\(\);/, /auditHistory\(orgId,/],
    why: 'Technavious only, and the history read is the organisation they are in.',
  },
  'consent/page.tsx': {
    scoped: [/requireUserPageBeforeConsent\(/],
    why: 'Takes only where to go next, which is checked to be a path in this app; reads nothing by id.',
  },
  'decks/[id]/page.tsx': {
    scoped: [
      /requireAdminPage\(/,
      /loadDeckOnce\(admin\.orgId, id\)/,
      /rosterStore\(admin\.orgId\)/,
    ],
    why: 'The deck is loaded from the administrator’s organisation; a company administrator gets a 404 for a draft.',
  },
  'decks/[id]/progress/page.tsx': {
    scoped: [/loadStoredDeck\(admin\.orgId, id\)/, /progressForDeck\(admin\.orgId, id\)/],
    why: 'The deck and its progress are read from the administrator’s organisation.',
  },
  'decks/[id]/questions/page.tsx': {
    scoped: [/mayManageBanks\(person\)/, /loadStoredDeck\(person\.orgId, id\)/],
    why: 'Technavious only, and the deck is loaded from the organisation they are in.',
  },
  'decks/[id]/results/page.tsx': {
    scoped: [/loadStoredDeck\(person\.orgId, id\)/, /resultsForDeck\(person, id, sessionId\)/],
    why: 'The deck is loaded from the viewer’s organisation, and resultsForDeck 404s a session from elsewhere.',
  },
  'feedback/page.tsx': {
    scoped: [/loadStoredDeck\(person\.orgId, deckId\)/],
    why: 'The deck in the query is loaded from the participant’s organisation.',
  },
  'people/[id]/page.tsx': {
    scoped: [/rosterStore\(admin\.orgId\)/, /if \(!person\) notFound\(\);/],
    why: 'The person is found in the administrator’s own roster, and a miss is a 404.',
  },
  'people/[id]/profile/page.tsx': {
    scoped: [/viewProfile\(viewer, id\)/, /if \(!view\) notFound\(\);/],
    why: 'viewProfile finds the person in the viewer’s own roster and returns nothing for anybody else.',
  },
  'platform/errors/page.tsx': {
    scoped: [/if \(!isAdministrator\(person\)\) notFound\(\);/],
    why: 'Technavious only. Takes a day, not an id.',
  },
  'session/page.tsx': {
    scoped: [/requireAssignedDeckPage\(deckId,/, /loadStoredDeck\(person\.orgId, deckId\)/],
    why: 'The deck must be assigned to the caller, or open to them as an administrator, in their own organisation.',
  },
  'sessions/[id]/page.tsx': {
    scoped: [/trainingStore\(me\.orgId\)/, /mayManageSession\(me, session\)/],
    why: 'The session is read from the caller’s organisation, and anybody who may not run it gets a 404.',
  },
  'sessions/[id]/run/page.tsx': {
    scoped: [/trainingStore\(me\.orgId\)/, /mayManageSession\(me, session\)/],
    why: 'As for the session page: read from the caller’s organisation, 404 for anybody who may not run it.',
  },
};

/** Files that read an id-shaped field but are not about a customer's records. */
const NOT_ID_TAKING: Record<string, string> = {
  'api/auth/dev/route.ts':
    'The development sign-in, which names a person on a developer machine and refuses to run anywhere real sign-in works.',
  'api/cron/retention/route.ts':
    'Called by Vercel Cron with a secret. Takes a dry-run date, not an id, and walks every organisation by design.',
  'api/report/route.ts':
    'The browser reporting a failure. A deck id in it is only written to the developer log as text.',
  'api/stt/route.ts': 'Transcribes audio. Any deck id is only a label for usage.',
  'api/voices/sample/route.ts': 'Plays a fixed sample line in a chosen voice. No customer data.',
  'signin/page.tsx':
    'Takes only where to go after signing in. The development picker it reads exists only where real sign-in does not, as scoping.test.ts records.',
};

/** Store calls whose first argument decides whose data comes back. */
const SCOPED_CALL =
  /\b(rosterStore|deckStore|assetStore|loadStoredDeck|loadDeck|listDecks|trainingStore|progressForDeck|deckApprovalFor|deckApprovalStates|assessmentPaper|recordQuietly|analyseSlideBatch|analyseSlideDetail|analyseTopics|leaverDocuments|recordLeaver|eraseLeaverAnswers|auditHistory|loadDeckOnce)\(\s*([^,)\s]+)/g;

/** What that first argument may be: the organisation of the person a guard returned. */
const GUARDED_ORG =
  /^(gate\.person|person|admin|me|viewer|uploader|staff|resolved\.person)\.orgId$|^orgId$/;

/** Where a bare `orgId` argument is allowed, because it is a parameter fed from above. */
const BARE_ORG_ID_ALLOWED: Record<string, string> = {
  'decks/[id]/page.tsx':
    'loadDeckOnce is a per-request cache taking (orgId, id); every call passes admin.orgId or viewer.orgId.',
  'audit/page.tsx': 'read(orgId, …) is called with person.orgId only.',
};

/** The platform's own routes, which name a customer on purpose and for staff only. */
const DELIBERATELY_CROSS_CUSTOMER = new Set([
  'api/platform/customers/[id]/route.ts',
  'api/platform/move/route.ts',
  'api/platform/route.ts',
  'platform/page.tsx',
]);

describe('every route and page that takes an id', () => {
  it('found enough of them to have looked', () => {
    assert.ok(FILES.length >= 60, `only walked ${FILES.length} routes and pages`);
    assert.ok(Object.keys(ID_TAKING).length >= 30);
  });

  it('is listed here with how it keeps the id inside the caller’s organisation', () => {
    const unlisted = FILES.filter(
      (path) =>
        takesAnId(path) &&
        !(path in ID_TAKING) &&
        !(path in NOT_ID_TAKING) &&
        !DELIBERATELY_CROSS_CUSTOMER.has(path),
    );
    assert.deepEqual(
      unlisted,
      [],
      `these take an id and nobody has said how they keep it inside the caller's organisation: ${unlisted.join(', ')}`,
    );
  });

  it('has no stale entry, and a reason for each', () => {
    for (const [path, entry] of Object.entries(ID_TAKING)) {
      assert.ok(FILES.includes(path), `${path} is listed but does not exist`);
      assert.ok(entry.why.length > 30, `${path} is listed without a reason worth reading`);
    }
    for (const [path, why] of Object.entries(NOT_ID_TAKING)) {
      assert.ok(FILES.includes(path), `${path} is excused but does not exist`);
      assert.ok(why.length > 30, `${path} is excused without a reason`);
    }
  });

  for (const [path, entry] of Object.entries(ID_TAKING)) {
    it(`${path} resolves its ids through the caller's organisation`, () => {
      const text = source(path);
      for (const pattern of entry.scoped) {
        assert.match(text, pattern, `${path} no longer scopes the way this expects`);
      }
    });
  }

  it('builds every store from the guarded person’s organisation, never from the request', () => {
    const offenders: string[] = [];
    for (const path of Object.keys(ID_TAKING)) {
      const text = source(path);
      for (const [, call, argument] of text.matchAll(SCOPED_CALL)) {
        const allowed =
          GUARDED_ORG.test(argument!) && (argument !== 'orgId' || path in BARE_ORG_ID_ALLOWED);
        if (!allowed) offenders.push(`${path}: ${call}(${argument}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `stores built from something else:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('never reads an organisation out of the request', () => {
    for (const path of Object.keys(ID_TAKING)) {
      if (DELIBERATELY_CROSS_CUSTOMER.has(path)) continue;
      const text = source(path);
      assert.doesNotMatch(
        text,
        /body\??\.orgId|searchParams[\s\S]{0,80}\borg\b|\{ orgId \} = await params/,
        path,
      );
    }
  });

  it('keeps the platform’s cross-customer routes to platform staff', () => {
    for (const path of DELIBERATELY_CROSS_CUSTOMER) {
      assert.match(source(path), /isPlatformAdmin\(/, `${path} lets somebody else look across`);
    }
  });
});

// --------------------------------------------------------------- by behaviour

const ACME = 'acme';
const GLOBEX = 'globex';

function person(
  id: string,
  role: Role,
  orgId: string,
  extra: Partial<SignedInPerson> = {},
): SignedInPerson {
  return {
    id,
    orgId,
    homeOrgId: orgId,
    platform: false,
    email: `${id}@${orgId}.example`,
    emailKey: `${id}@${orgId}.example`,
    name: id,
    role,
    createdAt: '2026-11-01T00:00:00.000Z',
    lastSeenAt: null,
    ...extra,
  };
}

const acmeAdmin = person('hr', 'admin', ACME);
const globexParticipant = person('gita', 'trainee', GLOBEX);
/** Technavious, acting inside Acme. Still Acme's data, and only Acme's. */
const benchmarkInAcme = person('bench', 'admin', ACME, {
  platform: true,
  homeOrgId: 'technavious',
});

function session(id: string, participantIds: string[]): TrainingSession {
  return {
    id,
    deckId: 'dc-power-a1b2c3',
    facilitatorId: 'fran',
    batchId: null,
    participantIds,
    scheduledFor: null,
    status: 'scheduled',
    attendance: {},
    createdBy: 'someone',
    createdAt: '2026-11-01T00:00:00.000Z',
    openedAt: null,
    closedAt: null,
    closedBy: null,
  };
}

describe('an id from another customer', () => {
  let store: InMemoryDocumentStore;

  beforeEach(async () => {
    store = new InMemoryDocumentStore();
    await trainingStore(GLOBEX, store).saveSession(session('s-globex', [globexParticipant.id]));
    await trainingStore(GLOBEX, store).saveBatch({
      id: 'b-globex',
      name: 'Globex batch',
      facilitatorId: 'fran',
      participantIds: [globexParticipant.id],
      createdBy: 'someone',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    });
  });

  it('is a 404 for a session, to an administrator and to Technavious inside another customer', async () => {
    for (const viewer of [acmeAdmin, benchmarkInAcme]) {
      await assert.rejects(sessionFor(viewer, 's-globex', { store }), { status: 404 });
      await assert.rejects(removeSession(viewer, 's-globex', { store }), { status: 404 });
    }
    assert.ok(await trainingStore(GLOBEX, store).getSession('s-globex'), 'it was removed');
  });

  it('is a 404 for a batch, and changes nothing', async () => {
    await assert.rejects(updateBatch(acmeAdmin, 'b-globex', { name: 'Mine now' }, { store }), {
      status: 404,
    });
    await assert.rejects(removeBatch(acmeAdmin, 'b-globex', { store }), { status: 404 });
    assert.equal((await trainingStore(GLOBEX, store).getBatch('b-globex'))?.name, 'Globex batch');
  });

  it('is nothing for a person’s profile, even to Technavious inside another customer', async () => {
    await saveProfile(globexParticipant, { name: 'Gita', department: 'Facilities' }, { store });
    const acmeRoster = new DocumentRosterStore(scopedDocuments(store, ACME));
    for (const viewer of [acmeAdmin, benchmarkInAcme]) {
      assert.equal(
        await viewProfile(viewer, globexParticipant.id, { store, roster: acmeRoster }),
        null,
      );
    }
  });

  it('is a 404 for a session’s results', async () => {
    const acmeRoster = new DocumentRosterStore(scopedDocuments(store, ACME));
    await assert.rejects(
      resultsForDeck(acmeAdmin, 'dc-power-a1b2c3', 's-globex', { store, roster: acmeRoster }),
      { status: 404 },
    );
  });

  it('cannot have its answers erased by removing somebody in another customer', async () => {
    const result: AssessmentResult = {
      id: `${globexParticipant.id}__dc-power-a1b2c3__pre`,
      personId: globexParticipant.id,
      deckId: 'dc-power-a1b2c3',
      kind: 'pre',
      sessionId: null,
      answers: [{ questionId: 'q1', chosenIndex: 0, correct: true }],
      correct: 1,
      total: 1,
      percent: 100,
      bankVersion: 'v1',
      bankSource: 'upload',
      submittedAt: '2026-11-01T00:00:00.000Z',
    };
    await assessmentDocuments(GLOBEX, store).set(ASSESSMENT_RESULTS, result.id, result);
    const erased = await eraseLeaverAnswers(ACME, globexParticipant.id, { store });
    assert.deepEqual(erased, { results: 0, feedback: 0 });
    const kept = await assessmentDocuments(GLOBEX, store).get<AssessmentResult>(
      ASSESSMENT_RESULTS,
      result.id,
    );
    assert.equal(kept?.answers.length, 1);
  });
});
