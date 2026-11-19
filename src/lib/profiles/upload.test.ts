import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { AUDIT, type AuditEntry } from '../audit/log';
import { InMemoryDocumentStore } from '../roster/documents';
import { DocumentRosterStore } from '../roster/store-documents';
import type { SignedInPerson } from '../roster/types';
import {
  isUsableEmail,
  MAX_UPLOAD_BYTES,
  parseCsv,
  readUpload,
  TEMPLATE_COLUMNS,
  templateCsv,
} from './csv';
import { findProfile, PROFILES, saveProfile } from './store';
import type { LearnerProfileRecord } from './types';
import {
  importParticipants,
  offDomainReason,
  recordUploadAudit,
  summarise,
  uploadAuditDetail,
} from './upload';
import { describeImported, describeUpload } from './upload-wording';

/**
 * The bulk participant upload (BRD v2.3, AI-28): the template, reading a file nobody
 * should trust, and what each row does to the roster and the profiles.
 */

const HEADER = TEMPLATE_COLUMNS.join(',');

function row(email: string, extra: Partial<Record<string, string>> = {}): string {
  const values: Record<string, string> = {
    email,
    name: 'Asha Patil',
    education: '"B.E., Electrical"',
    years_of_experience: '6',
    department: 'Facilities',
    proficiency: 'Intermediate',
    city: 'Pune',
    studied_at: '',
    interests: '',
    hobbies: 'Cricket',
    experience_by_area: '',
    ...extra,
  };
  return TEMPLATE_COLUMNS.map((column) => values[column] ?? '').join(',');
}

const uploader: SignedInPerson = {
  id: 'fac',
  orgId: 'acme',
  homeOrgId: 'acme',
  platform: false,
  email: 'fac@acme.com',
  emailKey: 'fac@acme.com',
  name: 'Fac',
  role: 'facilitator',
  createdAt: '2026-11-01T00:00:00.000Z',
  lastSeenAt: '2026-11-01T00:00:00.000Z',
};

describe('the template', () => {
  it('has the email column and every AI-05 field, header only, as UTF-8 Excel opens', () => {
    assert.deepEqual(TEMPLATE_COLUMNS, [
      'email',
      'name',
      'education',
      'years_of_experience',
      'department',
      'proficiency',
      'city',
      'studied_at',
      'experience_by_area',
      'interests',
      'hobbies',
    ]);
    const csv = templateCsv();
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.equal(csv.slice(1), `${HEADER}\r\n`);
    // And it reads back as a file with a header and no participants.
    const read = readUpload(csv);
    assert.equal(read.ok, false);
    if (!read.ok) assert.match(read.error, /no participants/);
  });
});

describe('reading CSV', () => {
  it('handles quotes, doubled quotes, commas and line breaks inside quotes, and CRLF', () => {
    const parsed = parseCsv('a,"b, c","say ""hi""","two\nlines"\r\nd,,f,\n');
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.rows, [
      ['a', 'b, c', 'say "hi"', 'two\nlines'],
      ['d', '', 'f', ''],
    ]);
  });

  it('refuses an unclosed quote rather than swallowing the rest of the file', () => {
    const parsed = parseCsv('email,name\n"asha@acme.com,Asha\nbina@acme.com,Bina\n');
    assert.equal(parsed.ok, false);
  });

  it('has no cap on how many participants a file holds (AI-28)', () => {
    const lines = [HEADER, ...Array.from({ length: 2500 }, (_, i) => row(`p${i}@acme.com`))];
    const text = lines.join('\n');
    // Only the size of the file is bounded, and this many full rows fit inside it.
    assert.ok(new TextEncoder().encode(text).length < MAX_UPLOAD_BYTES);
    const read = readUpload(text);
    assert.ok(read.ok);
    assert.equal(read.rows.length, 2500);
    assert.ok(read.rows.every((entry) => entry.ok));
  });

  it('still stops early when a caller does give it a cap', () => {
    const parsed = parseCsv('a\nb\nc\nd\n', 3);
    assert.equal(parsed.ok, false);
  });
});

describe('reading an upload', () => {
  it('reads fifty good rows', () => {
    const lines = [HEADER, ...Array.from({ length: 50 }, (_, i) => row(`p${i}@acme.com`))];
    const read = readUpload(lines.join('\r\n'));
    assert.ok(read.ok);
    assert.equal(read.rows.length, 50);
    const first = read.rows[0]!;
    assert.ok(first.ok);
    assert.equal(first.line, 2);
    assert.deepEqual(first.details, {
      name: 'Asha Patil',
      education: 'B.E., Electrical',
      yearsExperience: 6,
      department: 'Facilities',
      proficiency: 'intermediate',
      city: 'Pune',
      hobbies: 'Cricket',
    });
    assert.deepEqual(first.missing, []);
  });

  it('rejects bad rows with a reason and keeps the good ones', () => {
    const csv = [
      HEADER,
      row('asha@acme.com'),
      row(''),
      row('not an address'),
      row('two@acme.com; three@acme.com'),
      row('ASHA@acme.com'),
      row('bina@acme.com', { proficiency: 'Expert' }),
      row('chen@acme.com', { years_of_experience: 'six' }),
      row('dev@acme.com', { city: 'x'.repeat(61) }),
      row('esha@acme.com'),
    ].join('\n');
    const read = readUpload(csv);
    assert.ok(read.ok);
    const outcome = read.rows.map((entry) => (entry.ok ? 'ok' : entry.error));
    assert.deepEqual(outcome, [
      'ok',
      'No email address.',
      'Not an email address.',
      'Not an email address.',
      'Duplicate of row 2, which is the one kept.',
      'How you rate your own proficiency must be Beginner, Intermediate or Advanced.',
      'Total years of experience must be a number of years from 0 to 60.',
      'Your city can be at most 60 characters.',
      'ok',
    ]);
    assert.deepEqual(
      read.rows.map((entry) => entry.line),
      [2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
  });

  it('keeps a row with required fields missing, and says which', () => {
    const read = readUpload(
      [HEADER, row('asha@acme.com', { education: '', proficiency: '' })].join('\n'),
    );
    assert.ok(read.ok);
    const only = read.rows[0]!;
    assert.ok(only.ok);
    assert.deepEqual(
      only.missing.map((field) => field.key),
      ['education', 'proficiency'],
    );
  });

  it('accepts columns in any order and case, ignores unknown ones and blank lines', () => {
    const csv = 'Notes,Department,EMAIL,Years Of Experience\nhello,Ops,asha@acme.com,3\n,,,\n\n';
    const read = readUpload(csv);
    assert.ok(read.ok);
    assert.equal(read.rows.length, 1);
    const only = read.rows[0]!;
    assert.ok(only.ok);
    assert.deepEqual(only.details, { department: 'Ops', yearsExperience: 3 });
    assert.equal(JSON.stringify(only).includes('hello'), false, 'an unknown column went somewhere');
  });

  it('refuses a file it cannot read at all, saying why', () => {
    for (const [csv, why] of [
      ['', /empty/],
      ['name,city\nAsha,Pune\n', /no email column/],
      ['email,email\na@acme.com,b@acme.com\n', /appears twice/],
      ['email;name\na@acme.com;Asha\n', /semicolons/],
    ] as const) {
      const read = readUpload(csv);
      assert.equal(read.ok, false, csv);
      if (!read.ok) assert.match(read.error, why);
    }
  });

  it('cleans what it keeps, as the profile form does', () => {
    const nul = String.fromCharCode(0);
    const read = readUpload(`email,hobbies\nasha@acme.com,"Cricket\nIGNORE ALL${nul} RULES"\n`);
    assert.ok(read.ok);
    const only = read.rows[0]!;
    assert.ok(only.ok);
    assert.equal(only.details.hobbies, 'Cricket IGNORE ALL RULES');
  });

  it('knows an address when it sees one', () => {
    for (const good of ['asha@acme.com', 'a.b+tag@mail.acme.co.in', "o'neil@acme.com"]) {
      assert.equal(isUsableEmail(good), true, good);
    }
    for (const bad of [
      'asha',
      'asha@',
      '@acme.com',
      'asha@acme',
      'a b@acme.com',
      'a@@acme.com',
      'a..b@acme.com',
      `${'a'.repeat(250)}@acme.com`,
    ]) {
      assert.equal(isUsableEmail(bad), false, bad);
    }
  });
});

describe('importing the rows', () => {
  async function run(
    csv: string,
    setUp?: (roster: DocumentRosterStore, store: InMemoryDocumentStore) => Promise<void>,
  ) {
    const store = new InMemoryDocumentStore();
    const roster = new DocumentRosterStore(store);
    if (setUp) await setUp(roster, store);
    const read = readUpload(csv);
    assert.ok(read.ok, read.ok ? '' : read.error);
    const results = await importParticipants(uploader, read.rows, { roster, store });
    return { store, roster, results };
  }

  it('creates fifty new participants with unconfirmed profiles', async () => {
    const lines = [HEADER, ...Array.from({ length: 50 }, (_, i) => row(`p${i}@acme.com`))];
    const { roster, store, results } = await run(lines.join('\n'));
    assert.deepEqual(summarise(results), {
      created: 50,
      updated: 0,
      duplicates: 0,
      rejected: 0,
      incomplete: 0,
    });
    const people = await roster.listPeople();
    assert.equal(people.length, 50);
    assert.ok(people.every((person) => person.role === 'trainee' && person.lastSeenAt === null));
    const profiles = await store.all<LearnerProfileRecord>(`orgs/acme/${PROFILES}`);
    assert.equal(profiles.length, 50);
    assert.ok(profiles.every((profile) => profile.source === 'upload' && !profile.confirmed));
    assert.ok(profiles.every((profile) => profile.uploadedBy === uploader.id));
  });

  it('updates somebody already here without marking them as seen', async () => {
    const { roster, results } = await run([HEADER, row('asha@acme.com')].join('\n'), async (r) => {
      await r.upsertPerson({ email: 'asha@acme.com', name: 'Asha' });
    });
    assert.equal(results[0]!.status, 'updated');
    const asha = await roster.getPersonByEmail('asha@acme.com');
    assert.equal(asha?.lastSeenAt, null, 'the upload claimed they had signed in');
  });

  it('keeps a profile the participant already confirmed', async () => {
    const { store, results } = await run(
      [HEADER, row('asha@acme.com', { department: 'Overwritten' })].join('\n'),
      async (r, s) => {
        const asha = await r.upsertPerson({ id: 'asha-uid', email: 'asha@acme.com' });
        await saveProfile(
          { id: asha.id, orgId: 'acme' },
          {
            name: 'Asha',
            education: 'B.Sc.',
            yearsExperience: 2,
            department: 'Mine',
            proficiency: 'advanced',
          },
          { store: s },
        );
      },
    );
    assert.equal(results[0]!.status, 'updated');
    assert.equal(results[0]!.profile, 'kept');
    const profile = await findProfile({ id: 'asha-uid', orgId: 'acme' }, { store });
    assert.equal(profile?.department, 'Mine');
  });

  it('refuses to touch an administrator or facilitator', async () => {
    const { store, results } = await run([HEADER, row('hr@acme.com')].join('\n'), async (r) => {
      await r.upsertPerson({ email: 'hr@acme.com', role: 'admin' });
    });
    assert.equal(results[0]!.status, 'rejected');
    assert.match(results[0]!.reason ?? '', /administrator or facilitator/);
    assert.deepEqual(await store.all(`orgs/acme/${PROFILES}`), []);
  });

  it('reports bad rows, says who must finish their profile, and carries on', async () => {
    const { results } = await run(
      [HEADER, row('bad'), row('asha@acme.com', { education: '' }), row('bina@acme.com')].join(
        '\n',
      ),
    );
    assert.deepEqual(
      results.map((result) => [result.line, result.status]),
      [
        [2, 'rejected'],
        [3, 'created'],
        [4, 'created'],
      ],
    );
    assert.deepEqual(results[1]!.missing, ['Education, with stream']);
    assert.deepEqual(summarise(results), {
      created: 2,
      updated: 0,
      duplicates: 0,
      rejected: 1,
      incomplete: 1,
    });
  });

  it('keeps the first of an address given twice, and reports the other as its duplicate', async () => {
    const { roster, results } = await run(
      [
        HEADER,
        row('asha@acme.com', { department: 'First' }),
        row('bina@acme.com'),
        row('Asha@ACME.com', { department: 'Second' }),
        row('asha@acme.com'),
      ].join('\n'),
    );
    assert.deepEqual(
      results.map((result) => [result.line, result.status, result.duplicateOf]),
      [
        [2, 'created', undefined],
        [3, 'created', undefined],
        [4, 'duplicate', 2],
        [5, 'duplicate', 2],
      ],
    );
    assert.equal(results[2]!.reason, 'Duplicate of row 2, which is the one kept.');
    assert.equal(results[2]!.email, 'Asha@ACME.com');
    assert.equal((await roster.listPeople()).length, 2);
    assert.equal(summarise(results).duplicates, 2);
  });

  it('imports the valid rows of fifty and lists the failed ones with the reason (AI-28)', async () => {
    const lines = [
      HEADER,
      ...Array.from({ length: 50 }, (_, i) =>
        i === 10
          ? row('not an address')
          : i === 20
            ? row('p0@acme.com')
            : i === 30
              ? row(`p${i}@acme.com`, { proficiency: 'Expert' })
              : row(`p${i}@acme.com`),
      ),
    ];
    const { roster, results } = await run(lines.join('\n'));
    assert.equal(results.length, 50);
    assert.deepEqual(summarise(results), {
      created: 47,
      updated: 0,
      duplicates: 1,
      rejected: 2,
      incomplete: 0,
    });
    assert.equal((await roster.listPeople()).length, 47);
    const failed = results.filter((result) => result.status === 'rejected');
    assert.deepEqual(
      failed.map((result) => [result.line, result.reason]),
      [
        [12, 'Not an email address.'],
        [32, 'How you rate your own proficiency must be Beginner, Intermediate or Advanced.'],
      ],
    );
    const duplicate = results.find((result) => result.status === 'duplicate');
    assert.deepEqual([duplicate?.line, duplicate?.duplicateOf], [22, 2]);
  });

  it('writes into the uploader organisation and no other', async () => {
    const { store } = await run([HEADER, row('asha@acme.com')].join('\n'));
    assert.equal((await store.all(`orgs/acme/${PROFILES}`)).length, 1);
    assert.deepEqual(await store.all(`orgs/globex/${PROFILES}`), []);
  });

  it('reports a row that fails to save and carries on with the rest', async () => {
    class FailsOnce extends DocumentRosterStore {
      failed = false;
      override async upsertPerson(input: Parameters<DocumentRosterStore['upsertPerson']>[0]) {
        if (!this.failed && input.email === 'asha@acme.com') {
          this.failed = true;
          throw new Error('Firestore is down');
        }
        return super.upsertPerson(input);
      }
    }
    const store = new InMemoryDocumentStore();
    const roster = new FailsOnce(store);
    const read = readUpload([HEADER, row('asha@acme.com'), row('bina@acme.com')].join('\n'));
    assert.ok(read.ok);
    const results = await importParticipants(uploader, read.rows, {
      roster,
      store,
      concurrency: 1,
    });
    assert.deepEqual(
      results.map((result) => result.status),
      ['rejected', 'created'],
    );
  });
});

describe('refusing addresses the company has not claimed (AI-59)', () => {
  async function run(
    csv: string,
    domains: readonly string[] | undefined,
    setUp?: (roster: DocumentRosterStore) => Promise<void>,
  ) {
    const store = new InMemoryDocumentStore();
    const roster = new DocumentRosterStore(store);
    if (setUp) await setUp(roster);
    const read = readUpload(csv);
    assert.ok(read.ok, read.ok ? '' : read.error);
    const results = await importParticipants(uploader, read.rows, { roster, store, domains });
    return { store, roster, results };
  }

  it('says which domain is wrong and which the company uses', () => {
    assert.equal(
      offDomainReason('asha@gmail.com', ['acme.com', 'acme.in']),
      'The address is not on a domain this company uses (gmail.com), so this person could ' +
        'not sign in. This company uses acme.com, acme.in.',
    );
    assert.equal(offDomainReason('asha@acme.in', ['acme.com', 'acme.in']), null);
    // Recorded domains are compared as sign-in compares them, whatever their case or `@`.
    assert.equal(offDomainReason('asha@acme.com', ['@ACME.com']), null);
    // A subdomain is not the domain: sign-in would not place it either.
    assert.match(offDomainReason('asha@mail.acme.com', ['acme.com']) ?? '', /mail\.acme\.com/);
  });

  it('refuses nothing for an organisation with no domains, rather than refusing everybody', () => {
    assert.equal(offDomainReason('asha@gmail.com', []), null);
    assert.equal(offDomainReason('asha@gmail.com', undefined), null);
  });

  it('imports the rows on any of its domains and lists the others as failed, with why', async () => {
    const { roster, store, results } = await run(
      [
        HEADER,
        row('asha@acme.com'),
        row('bina@gmail.com'),
        row('chitra@ACME.IN'),
        row('dev@globex.com'),
      ].join('\n'),
      ['acme.com', 'acme.in'],
    );
    assert.deepEqual(
      results.map((result) => [result.line, result.status]),
      [
        [2, 'created'],
        [3, 'rejected'],
        [4, 'created'],
        [5, 'rejected'],
      ],
    );
    assert.match(results[1]!.reason ?? '', /not on a domain this company uses \(gmail\.com\)/);
    assert.match(results[3]!.reason ?? '', /\(globex\.com\)/);
    // Nobody refused was put on the roster or given a profile.
    assert.deepEqual((await roster.listPeople()).map((person) => person.emailKey).sort(), [
      'asha@acme.com',
      'chitra@acme.in',
    ]);
    assert.equal((await store.all(`orgs/acme/${PROFILES}`)).length, 2);
    assert.equal(summarise(results).rejected, 2);
  });

  it('still updates somebody here who has signed in, wherever their address is', async () => {
    const { results } = await run(
      [HEADER, row('moved@gmail.com'), row('added@gmail.com')].join('\n'),
      ['acme.com'],
      async (roster) => {
        // Signed in, so the directory knows them: placed here by hand, say.
        await roster.upsertPerson({ id: 'moved-uid', email: 'moved@gmail.com' });
        // Added on the people screen and never signed in, so still unable to.
        await roster.upsertPerson({ email: 'added@gmail.com' });
      },
    );
    assert.deepEqual(
      results.map((result) => result.status),
      ['updated', 'rejected'],
    );
  });

  it('still gives the documented result for the 50-row sample, on the domain it is for', async () => {
    const sample = readFileSync('docs/uat/samples/sample-participants-50.csv', 'utf8');
    const claimed = await run(sample, ['example.com']);
    assert.deepEqual(summarise(claimed.results), {
      created: 49,
      updated: 0,
      duplicates: 1,
      rejected: 0,
      incomplete: 2,
    });
    // Uploaded into a company that has not claimed example.com, as UAT-NOTES warns.
    const unclaimed = await run(sample, ['technavious.com']);
    assert.deepEqual(summarise(unclaimed.results), {
      created: 0,
      updated: 0,
      duplicates: 1,
      rejected: 49,
      incomplete: 0,
    });
  });
});

describe('recording an upload (AI-60)', () => {
  it('says how the upload went, in counts', async () => {
    const store = new InMemoryDocumentStore();
    const roster = new DocumentRosterStore(store);
    const read = readUpload(
      [
        HEADER,
        row('asha@acme.com'),
        row('bina@acme.com', { education: '' }),
        row('asha@acme.com'),
        row('dev@gmail.com'),
        row('bad'),
      ].join('\n'),
    );
    assert.ok(read.ok);
    const results = await importParticipants(uploader, read.rows, {
      roster,
      store,
      domains: ['acme.com'],
    });
    assert.equal(
      uploadAuditDetail(results),
      'Uploaded a file of 5 rows: 2 imported (2 new, 0 already here), 1 duplicate, ' +
        '2 failed or refused, 1 to complete',
    );
  });

  it('writes one entry for the upload, in the uploader organisation', async () => {
    const store = new InMemoryDocumentStore();
    const now = Date.parse('2026-11-16T09:30:00.000Z');
    await recordUploadAudit(
      uploader,
      [{ line: 2, email: 'asha@acme.com', status: 'created', profile: 'prefilled', missing: [] }],
      { store, now, immediate: true },
    );
    const entries = await store.all<AuditEntry>(`orgs/acme/${AUDIT}`);
    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.equal(entry!.action, 'uploaded');
    assert.equal(entry!.subjectType, 'participant-upload');
    assert.equal(entry!.subjectId, '2026-11-16T09:30:00.000Z');
    assert.equal(entry!.actorId, uploader.id);
    assert.equal(
      entry!.detail,
      'Uploaded a file of 1 row: 1 imported (1 new, 0 already here), 0 duplicates, ' +
        '0 failed or refused, 0 to complete',
    );
    assert.deepEqual(await store.all(`orgs/globex/${AUDIT}`), []);
  });
});

/**
 * A company whose roster and profiles outlive one upload, so a second can follow the
 * first, with somebody signing in and confirming their profile in between.
 */
function company() {
  const store = new InMemoryDocumentStore();
  const roster = new DocumentRosterStore(store);
  const upload = async (csv: string, at: string, domains?: readonly string[]) => {
    const read = readUpload(csv);
    assert.ok(read.ok, read.ok ? '' : read.error);
    return importParticipants(uploader, read.rows, { roster, store, domains, now: new Date(at) });
  };
  const profiles = () => store.all<LearnerProfileRecord>(`orgs/acme/${PROFILES}`);
  /** The audit entries about one kind of thing, once the queued ones have been written. */
  const audited = async (subjectType: AuditEntry['subjectType']) => {
    await new Promise((resolve) => setImmediate(resolve));
    return (await store.all<AuditEntry>(`orgs/acme/${AUDIT}`)).filter(
      (entry) => entry.subjectType === subjectType,
    );
  };
  return { store, roster, upload, profiles, audited };
}

const MONDAY = '2026-11-16T09:00:00.000Z';
const TUESDAY = '2026-11-17T09:00:00.000Z';
const WEDNESDAY = '2026-11-18T09:00:00.000Z';

const LEFT_ALONE =
  'Already here. They have confirmed their own profile, so it was left exactly as it is.';
const REFILLED =
  'Already here. They have not confirmed a profile yet, so it was prefilled from this file.';

describe('uploading a file again', () => {
  it('refills a profile an earlier upload prefilled, while nobody has confirmed it', async () => {
    const { roster, upload, profiles } = company();
    await upload(
      [HEADER, row('asha@acme.com', { department: 'First', hobbies: 'Cricket' })].join('\n'),
      MONDAY,
    );
    const person = await roster.getPersonByEmail('asha@acme.com');
    assert.equal((await profiles())[0]!.confirmed, false);

    const results = await upload(
      [HEADER, row('asha@acme.com', { department: 'Second', hobbies: '' })].join('\n'),
      WEDNESDAY,
    );
    assert.deepEqual(
      results.map((result) => [result.status, result.profile]),
      [['updated', 'prefilled']],
    );

    const stored = await profiles();
    assert.equal(stored.length, 1);
    const [profile] = stored;
    // Replaced whole by the newer file rather than merged with the older one, so a
    // field the newer file leaves empty is empty.
    assert.equal(profile!.department, 'Second');
    assert.equal(profile!.hobbies, undefined);
    assert.equal(profile!.uploadedAt, WEDNESDAY);
    // And still only what their organisation said about them: nothing the trainer is given.
    assert.equal(profile!.source, 'upload');
    assert.equal(profile!.confirmed, false);
    // Their row on the roster is not touched by either upload.
    assert.deepEqual(await roster.getPersonByEmail('asha@acme.com'), person);
    assert.equal(
      describeImported(results[0]!),
      `${REFILLED} They will confirm it when they next sign in.`,
    );
  });

  it('refills it under their real id when they have signed in but not confirmed it', async () => {
    const { roster, upload, profiles } = company();
    await upload([HEADER, row('asha@acme.com', { department: 'First' })].join('\n'), MONDAY);
    // Signing in replaces the placeholder id. The profile is still the uploaded one.
    await roster.upsertPerson({ id: 'asha-uid', email: 'asha@acme.com' });

    const results = await upload(
      [HEADER, row('asha@acme.com', { department: 'Second' })].join('\n'),
      WEDNESDAY,
    );
    assert.deepEqual([results[0]!.status, results[0]!.profile], ['updated', 'prefilled']);
    const stored = await profiles();
    assert.deepEqual(
      stored.map((profile) => [profile.personId, profile.department, profile.confirmed]),
      [['asha-uid', 'Second', false]],
    );
  });

  it('leaves a profile exactly as it is once the participant has confirmed it', async () => {
    const { store, roster, upload, profiles, audited } = company();
    await upload([HEADER, row('asha@acme.com', { department: 'Facilities' })].join('\n'), MONDAY);
    // They sign in, correct what their organisation said about them, and confirm it.
    const asha = await roster.upsertPerson({ id: 'asha-uid', email: 'asha@acme.com' });
    await saveProfile(
      { id: asha.id, orgId: 'acme', emailKey: asha.emailKey },
      {
        name: 'Asha P.',
        education: 'B.E., Electrical',
        yearsExperience: 7,
        department: 'Operations',
        proficiency: 'advanced',
      },
      { store },
      new Date(TUESDAY),
    );
    const person = await roster.getPerson('asha-uid');
    const confirmed = await profiles();
    assert.equal(confirmed.length, 1);
    assert.deepEqual(
      [confirmed[0]!.source, confirmed[0]!.confirmed, confirmed[0]!.department],
      ['upload', true, 'Operations'],
    );
    const prefills = (await audited('profile')).length;

    // The same address again, with different answers, a field they did not give and a
    // required one left empty.
    const results = await upload(
      [
        HEADER,
        row('asha@acme.com', { department: 'Overwritten', city: 'Mumbai', education: '' }),
      ].join('\n'),
      WEDNESDAY,
    );

    assert.deepEqual(
      results.map((result) => [result.status, result.profile, result.missing]),
      [['updated', 'kept', []]],
    );
    // Not one field, date or mark of it is different, and no second copy was written.
    assert.deepEqual(await profiles(), confirmed);
    assert.deepEqual(await roster.getPerson('asha-uid'), person);
    // Nothing was written, so nothing is recorded as written, and nobody is told they
    // have a profile to complete.
    assert.equal((await audited('profile')).length, prefills);
    assert.equal(summarise(results).incomplete, 0);
    assert.equal(describeImported(results[0]!), LEFT_ALONE);
  });

  it('leaves a profile the participant gave themselves, however often they edited it', async () => {
    const { store, roster, upload, profiles } = company();
    // Never uploaded: they signed in and filled it in, then changed it the next day.
    const asha = await roster.upsertPerson({ id: 'asha-uid', email: 'asha@acme.com' });
    const owner = { id: asha.id, orgId: 'acme', emailKey: asha.emailKey };
    const theirs = {
      name: 'Asha',
      education: 'B.Sc.',
      yearsExperience: 2,
      department: 'Mine',
      proficiency: 'beginner' as const,
    };
    await saveProfile(owner, theirs, { store }, new Date(MONDAY));
    await saveProfile(owner, { ...theirs, department: 'Still mine' }, { store }, new Date(TUESDAY));
    const own = await profiles();
    assert.deepEqual(
      [own[0]!.source, own[0]!.confirmed, own[0]!.department],
      ['self', true, 'Still mine'],
    );

    const results = await upload(
      [HEADER, row('asha@acme.com', { department: 'Overwritten' })].join('\n'),
      WEDNESDAY,
    );
    assert.deepEqual([results[0]!.status, results[0]!.profile], ['updated', 'kept']);
    assert.deepEqual(await profiles(), own);
    assert.equal(describeImported(results[0]!), LEFT_ALONE);
  });

  it('says for each row which of the two it was, and counts those left alone', async () => {
    const { store, roster, upload } = company();
    await upload([HEADER, row('asha@acme.com'), row('bina@acme.com')].join('\n'), MONDAY);
    const asha = await roster.upsertPerson({ id: 'asha-uid', email: 'asha@acme.com' });
    await saveProfile(
      { id: asha.id, orgId: 'acme', emailKey: asha.emailKey },
      {
        name: 'Asha',
        education: 'B.E.',
        yearsExperience: 6,
        department: 'Facilities',
        proficiency: 'intermediate',
      },
      { store },
      new Date(TUESDAY),
    );

    const results = await upload(
      [
        HEADER,
        row('asha@acme.com'),
        row('bina@acme.com', { department: '' }),
        row('chen@acme.com'),
      ].join('\n'),
      WEDNESDAY,
    );
    assert.deepEqual(results.map(describeImported), [
      LEFT_ALONE,
      `${REFILLED} They will be asked for: current department.`,
      'Created. Profile prefilled. They will confirm it on their first visit.',
    ]);
    assert.equal(
      describeUpload(results, summarise(results)),
      '3 imported (1 new, 2 already here), 0 duplicates, 0 failed. 1 will be asked to ' +
        'complete required fields on their first visit. 1 already here has confirmed ' +
        'their own profile, which was left as it is.',
    );
  });

  it('counts several left alone in the plural, and says nothing when there are none', () => {
    const summary = { created: 0, updated: 2, duplicates: 1, rejected: 0, incomplete: 0 };
    assert.equal(
      describeUpload(
        [
          { status: 'updated', profile: 'kept' },
          { status: 'updated', profile: 'kept' },
          { status: 'duplicate' },
        ],
        summary,
      ),
      '2 imported (0 new, 2 already here), 1 duplicate, 0 failed. 2 already here have ' +
        'confirmed their own profiles, which were left as they are.',
    );
    assert.equal(
      describeUpload([{ status: 'updated', profile: 'prefilled' }], { ...summary, updated: 1 }),
      '1 imported (0 new, 1 already here), 1 duplicate, 0 failed.',
    );
  });

  it('gives the documented wording for the 50-row sample, the first time and the second', async () => {
    const { upload } = company();
    const sample = readFileSync('docs/uat/samples/sample-participants-50.csv', 'utf8');
    const asked = ' 2 will be asked to complete required fields on their first visit.';

    const first = await upload(sample, MONDAY, ['example.com']);
    assert.equal(
      describeUpload(first, summarise(first)),
      `49 imported (49 new, 0 already here), 1 duplicate, 0 failed.${asked}`,
    );
    const firstRow = (line: number) => describeImported(first.find((each) => each.line === line)!);
    assert.equal(
      firstRow(2),
      'Created. Profile prefilled. They will confirm it on their first visit.',
    );
    assert.equal(
      firstRow(18),
      'Created. Profile prefilled. They will be asked for: current department.',
    );
    assert.equal(
      firstRow(27),
      'Created. Profile prefilled. They will be asked for: total years of experience.',
    );

    // Nobody has signed in or confirmed anything, so the second upload refills all 49.
    const second = await upload(sample, WEDNESDAY, ['example.com']);
    assert.equal(
      describeUpload(second, summarise(second)),
      `49 imported (0 new, 49 already here), 1 duplicate, 0 failed.${asked}`,
    );
    const again = (line: number) => describeImported(second.find((each) => each.line === line)!);
    assert.equal(again(2), `${REFILLED} They will confirm it when they next sign in.`);
    assert.equal(again(18), `${REFILLED} They will be asked for: current department.`);
  });

  it('records each person it adds under people, and nobody it only found (D-02)', async () => {
    const { roster, upload, audited } = company();
    await roster.upsertPerson({ email: 'bina@acme.com' });
    const csv = [HEADER, row('asha@acme.com'), row('bina@acme.com')].join('\n');

    await upload(csv, MONDAY);
    assert.deepEqual(
      (await audited('person')).map((entry) => [
        entry.action,
        entry.subjectId,
        entry.actorId,
        entry.actorRole,
        entry.detail,
      ]),
      [
        [
          'created',
          'local-asha-acme-com',
          uploader.id,
          'facilitator',
          'Added asha@acme.com from line 2 of a participant upload, with the role trainee',
        ],
      ],
    );

    // The same file again adds nobody, so there is nobody new to record.
    await upload(csv, WEDNESDAY);
    assert.equal((await audited('person')).length, 1);
  });
});
