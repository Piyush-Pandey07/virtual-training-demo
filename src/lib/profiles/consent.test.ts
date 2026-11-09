import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { InMemoryDocumentStore } from '../roster/documents';
import { DocumentRosterStore } from '../roster/store-documents';
import type { SignedInPerson } from '../roster/types';
import { trainingStore } from '../training/store';
import type { TrainingSession } from '../training/types';
import { mayUploadParticipants, mayViewProfile } from './access';
import {
  agreedToCurrent,
  CONSENTS,
  type ConsentRecord,
  consentHistory,
  hasCurrentConsent,
  recordConsent,
} from './consent';
import { consentAddress, mustConsent } from './gate';
import { PROFILE_NOTICE_VERSION } from './notice';
import { deleteProfile, findProfile, PROFILES, saveProfile, saveUploadedProfile } from './store';
import { viewProfile } from './view';

/**
 * Consent, withdrawal and who may see a profile (BRD v2.3, AI-27 and AI-06).
 *
 * Done when, in the brief's words: no consent means no attendance; after withdrawal the
 * profile is gone; a company administrator and another participant are refused.
 *
 * The rules are driven against in-memory stores. Where the rule is enforced by a guard
 * that needs Next's request machinery, the guard is read from source, the way the
 * authorisation boundary test reads every route.
 */

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

function signedIn(overrides: Partial<SignedInPerson>): SignedInPerson {
  return {
    id: 'someone',
    orgId: 'acme',
    homeOrgId: 'acme',
    platform: false,
    email: 'someone@acme.com',
    emailKey: 'someone@acme.com',
    name: 'Someone',
    role: 'trainee',
    createdAt: '2026-11-01T00:00:00.000Z',
    lastSeenAt: null,
    ...overrides,
  };
}

const asha = signedIn({ id: 'asha', email: 'asha@acme.com', emailKey: 'asha@acme.com' });
const bina = signedIn({ id: 'bina', email: 'bina@acme.com', emailKey: 'bina@acme.com' });
const facilitator = signedIn({ id: 'fac', role: 'facilitator', email: 'fac@acme.com' });
const otherFacilitator = signedIn({ id: 'fac-2', role: 'facilitator', email: 'fac2@acme.com' });
const companyAdmin = signedIn({ id: 'hr', role: 'admin', email: 'hr@acme.com' });
// Technavious staff supporting Acme: acting in Acme, belonging to Technavious.
const administrator = signedIn({
  id: 'tech',
  role: 'admin',
  homeOrgId: 'technavious',
  platform: true,
  email: 'tech@technavious.com',
});

const DETAILS = {
  name: 'Asha Patil',
  education: 'B.E., Electrical',
  yearsExperience: 6,
  department: 'Facilities',
  proficiency: 'beginner' as const,
};

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.PROFILES_ENABLED;
  process.env.PROFILES_ENABLED = 'true';
});
afterEach(() => {
  if (saved === undefined) delete process.env.PROFILES_ENABLED;
  else process.env.PROFILES_ENABLED = saved;
});

describe('the consent record', () => {
  it('records the notice version and the moment, in the person own organisation', async () => {
    const store = new InMemoryDocumentStore();
    const at = new Date('2026-11-08T09:30:00.000Z');
    const record = await recordConsent(asha, 'given', true, { store }, at);
    assert.equal(record.noticeVersion, PROFILE_NOTICE_VERSION);
    assert.equal(record.at, at.toISOString());
    assert.equal(record.withProfile, true);
    const rows = await store.all<ConsentRecord>(`orgs/acme/${CONSENTS}`);
    assert.deepEqual(rows, [record]);
    // Keyed on its own id, as the purge rebuilds it.
    assert.deepEqual(await store.get(`orgs/acme/${CONSENTS}`, record.id), record);
  });

  it('keeps staff consent in their own organisation, not the one they are visiting', async () => {
    const store = new InMemoryDocumentStore();
    await recordConsent(administrator, 'given', false, { store });
    assert.deepEqual(await store.all(`orgs/acme/${CONSENTS}`), []);
    assert.equal((await store.all(`orgs/technavious/${CONSENTS}`)).length, 1);
  });

  it('never overwrites: every decision is its own record, oldest first', async () => {
    const store = new InMemoryDocumentStore();
    await recordConsent(asha, 'given', true, { store }, new Date('2026-11-08T09:00:00Z'));
    await recordConsent(asha, 'withdrawn', true, { store }, new Date('2026-11-09T09:00:00Z'));
    await recordConsent(asha, 'given', true, { store }, new Date('2026-11-10T09:00:00Z'));
    const history = await consentHistory(asha, { store });
    assert.deepEqual(
      history.map((record) => record.decision),
      ['given', 'withdrawn', 'given'],
    );
    assert.equal(history[1]!.withProfile, false, 'a withdrawal carries no profile');
    assert.deepEqual(await consentHistory(bina, { store }), [], 'and only their own');
  });

  it('counts only an agreement to the notice on screen now', () => {
    const record = (decision: 'given' | 'withdrawn', noticeVersion: string): ConsentRecord => ({
      id: 'x',
      personId: 'asha',
      decision,
      noticeVersion,
      at: '2026-11-08T00:00:00.000Z',
      withProfile: true,
    });
    assert.equal(agreedToCurrent([]), false);
    assert.equal(agreedToCurrent([record('given', 'draft-2020-01-01')]), false, 'an older notice');
    assert.equal(agreedToCurrent([record('given', PROFILE_NOTICE_VERSION)]), true);
    // Withdrawing takes back the profile, not the agreement that lets them attend.
    assert.equal(
      agreedToCurrent([
        record('given', PROFILE_NOTICE_VERSION),
        record('withdrawn', PROFILE_NOTICE_VERSION),
      ]),
      true,
    );
  });
});

describe('no consent means no attendance', () => {
  it('asks everybody the switch covers, administrators and facilitators included', async () => {
    const store = new InMemoryDocumentStore();
    for (const person of [asha, facilitator, companyAdmin, administrator]) {
      assert.equal(await mustConsent(person, { store }), true, person.id);
      await recordConsent(person, 'given', false, { store });
      assert.equal(await mustConsent(person, { store }), false, person.id);
    }
  });

  it('asks nobody, and reads nothing, when the switch leaves them out', async () => {
    class Untouchable extends InMemoryDocumentStore {
      override async where<T>(): Promise<T[]> {
        throw new Error('read with the switch off');
      }
    }
    delete process.env.PROFILES_ENABLED;
    assert.equal(await mustConsent(asha, { store: new Untouchable() }), false);
    process.env.PROFILES_ENABLED = 'staff';
    assert.equal(await mustConsent(asha, { store: new Untouchable() }), false, 'a customer');
    assert.equal(
      await mustConsent(signedIn({ homeOrgId: 'technavious', orgId: 'technavious' }), {
        store: new InMemoryDocumentStore(),
      }),
      true,
      'a Technavious employee in staff mode',
    );
  });

  it('treats a failed read as no agreement', async () => {
    class Failing extends InMemoryDocumentStore {
      override async where<T>(): Promise<T[]> {
        throw new Error('Firestore is down');
      }
    }
    assert.equal(await mustConsent(asha, { store: new Failing() }), true);
  });

  it('is enforced by every page guard, without looping on the consent page', () => {
    const guard = read('src/lib/auth/guard.ts');
    const page = guard.slice(guard.indexOf('export async function requireUserPage('));
    assert.match(
      page.slice(0, page.indexOf('\n}\n')),
      /if \(await needsConsent\(person\)\) redirect\(consentAddress\(next\)\);/,
    );
    // The admin and deck page guards both go through requireUserPage.
    assert.match(guard, /requireAdminPage[\s\S]*?await requireUserPage\(next\)/);
    assert.match(guard, /requireAssignedDeckPage[\s\S]*?await requireUserPage\(next\)/);
    // The consent page uses the one guard that does not ask, and nothing else does.
    const consent = read('src/app/consent/page.tsx');
    assert.match(consent, /requireUserPageBeforeConsent\(/);
    assert.doesNotMatch(consent, /requireUserPage\(/);
    // And an address back to it is never built, so a redirect cannot go round in a circle.
    assert.equal(consentAddress('/consent?next=%2F'), '/consent');
    assert.equal(consentAddress('/session?deck=isms'), '/consent?next=%2Fsession%3Fdeck%3Disms');
    assert.equal(consentAddress(undefined), '/consent');
  });

  it('is enforced by the route that lets somebody attend, so the chat route refuses', () => {
    const guard = read('src/lib/auth/guard.ts');
    const attend = guard.slice(guard.indexOf('export async function requireAssignedDeck('));
    assert.match(attend.slice(0, attend.indexOf('\n}\n')), /await refuseWithoutConsent\(person\);/);
    assert.match(guard, /throw new NotAuthorised\(\s*403,\s*'Read and agree to the privacy notice/);
    assert.match(read('src/app/api/chat/route.ts'), /await checkAssignedDeck\(/);
  });

  it('only lets the sign-in and consent pages through without it', () => {
    // Sign-in is public; every other page is guarded by something that asks.
    const boundary = read('src/lib/auth/boundary.test.ts');
    assert.match(boundary, /'signin\/page\.tsx': 'The way in/);
  });
});

describe('withdrawal', () => {
  it('deletes the profile, records the withdrawal, and keeps their access', async () => {
    const store = new InMemoryDocumentStore();
    await saveProfile(asha, DETAILS, { store });
    await recordConsent(asha, 'given', true, { store });

    // What DELETE /api/profile does.
    await deleteProfile(asha, { store });
    await recordConsent(asha, 'withdrawn', false, { store });

    assert.equal(await findProfile(asha, { store }), undefined, 'the profile is gone');
    assert.deepEqual(await store.all(`orgs/acme/${PROFILES}`), []);
    const history = await consentHistory(asha, { store });
    assert.equal(history.at(-1)?.decision, 'withdrawn');
    assert.equal(await hasCurrentConsent(asha, { store }), true, 'they still attend');
    assert.equal(await mustConsent(asha, { store }), false, 'and are not sent back to agree');
  });

  it('takes an uploaded copy with it', async () => {
    const store = new InMemoryDocumentStore();
    await saveUploadedProfile(
      { id: 'local-asha-acme-com', orgId: 'acme', emailKey: asha.emailKey },
      DETAILS,
      'fac',
      { store },
    );
    await deleteProfile(asha, { store });
    assert.equal(await findProfile(asha, { store }), undefined);
  });

  it('is what DELETE /api/profile does', () => {
    const route = read('src/app/api/profile/route.ts');
    const remove = route.slice(route.indexOf('export async function DELETE'));
    assert.match(
      remove,
      /await deleteProfile\(gate\.person\);\s*await recordConsent\(gate\.person, 'withdrawn', false\);/,
    );
  });
});

describe('who may see a profile (AI-06)', () => {
  async function setUp() {
    const store = new InMemoryDocumentStore();
    const roster = new DocumentRosterStore(store);
    for (const person of [asha, bina, facilitator, otherFacilitator, companyAdmin]) {
      await roster.upsertPerson({ id: person.id, email: person.email, name: person.name });
    }
    await saveProfile(asha, DETAILS, { store });
    const session: TrainingSession = {
      id: 's-1',
      deckId: 'isms',
      facilitatorId: facilitator.id,
      batchId: null,
      participantIds: [asha.id],
      scheduledFor: null,
      status: 'scheduled',
      attendance: {},
      createdBy: companyAdmin.id,
      createdAt: '2026-11-08T00:00:00.000Z',
      openedAt: null,
      closedAt: null,
      closedBy: null,
    };
    await trainingStore('acme', store).saveSession(session);
    return { store, roster };
  }

  it('lets the participant see their own', async () => {
    const { store, roster } = await setUp();
    const view = await viewProfile(asha, asha.id, { store, roster });
    assert.equal(view?.profile?.education, DETAILS.education);
  });

  it('lets the facilitator of a session they are in see it', async () => {
    const { store, roster } = await setUp();
    assert.equal(await mayViewProfile(facilitator, asha.id, { store }), true);
    const view = await viewProfile(facilitator, asha.id, { store, roster });
    assert.equal(view?.profile?.department, DETAILS.department);
  });

  it('lets the facilitator of a batch they are in see it', async () => {
    const { store } = await setUp();
    await trainingStore('acme', store).saveBatch({
      id: 'b-1',
      name: 'November',
      facilitatorId: otherFacilitator.id,
      participantIds: [asha.id],
      createdBy: companyAdmin.id,
      createdAt: '2026-11-08T00:00:00.000Z',
      updatedAt: '2026-11-08T00:00:00.000Z',
    });
    assert.equal(await mayViewProfile(otherFacilitator, asha.id, { store }), true);
  });

  it('lets the administrator see it', async () => {
    const { store, roster } = await setUp();
    const view = await viewProfile(administrator, asha.id, { store, roster });
    assert.equal(view?.person.email, asha.email);
    assert.equal(view?.profile?.name, DETAILS.name);
  });

  it('refuses a company administrator', async () => {
    const { store, roster } = await setUp();
    assert.equal(await mayViewProfile(companyAdmin, asha.id, { store }), false);
    assert.equal(await viewProfile(companyAdmin, asha.id, { store, roster }), null);
  });

  it('refuses another participant', async () => {
    const { store, roster } = await setUp();
    assert.equal(await viewProfile(bina, asha.id, { store, roster }), null);
  });

  it('refuses a facilitator who does not facilitate them', async () => {
    const { store, roster } = await setUp();
    assert.equal(await viewProfile(otherFacilitator, asha.id, { store, roster }), null);
  });

  it('finds nobody outside the viewer own organisation, administrator or not', async () => {
    const { store, roster } = await setUp();
    // A roster for another customer does not hold Asha, so even the administrator sees
    // nothing when looking inside it.
    const globex = new DocumentRosterStore(new InMemoryDocumentStore());
    assert.equal(
      await viewProfile({ ...administrator, orgId: 'globex' }, asha.id, { store, roster: globex }),
      null,
    );
    assert.ok(await viewProfile(administrator, asha.id, { store, roster }));
  });

  it('is enforced by the route and the page, which turn a refusal into a 404', () => {
    const route = read('src/app/api/people/[id]/profile/route.ts');
    assert.match(
      route,
      /const view = await viewProfile\(viewer, id\);\s*if \(!view\) return notFound\(\);/,
    );
    const page = read('src/app/people/[id]/profile/page.tsx');
    assert.match(
      page,
      /const view = await viewProfile\(viewer, id\);\s*if \(!view\) notFound\(\);/,
    );
  });

  it('is offered from the person page to the administrator only', () => {
    const page = read('src/app/people/[id]/page.tsx');
    assert.match(page, /\{isAdministrator\(admin\) &&\s+profilesEnabledFor\(admin\)/);
  });
});

describe('who may upload participants (AI-28)', () => {
  it('is the administrator, a company administrator and a facilitator, never a participant', () => {
    assert.equal(mayUploadParticipants(administrator), true);
    assert.equal(mayUploadParticipants(companyAdmin), true);
    assert.equal(mayUploadParticipants(facilitator), true);
    assert.equal(mayUploadParticipants(asha), false);
  });

  it('is enforced by both routes and the page', () => {
    for (const path of [
      'src/app/api/profiles/template/route.ts',
      'src/app/api/profiles/upload/route.ts',
      'src/app/profiles/upload/page.tsx',
    ]) {
      assert.match(read(path), /!mayUploadParticipants\((person|uploader)\)/, path);
    }
  });
});
