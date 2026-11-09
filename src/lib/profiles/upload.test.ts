import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryDocumentStore } from '../roster/documents';
import { DocumentRosterStore } from '../roster/store-documents';
import type { SignedInPerson } from '../roster/types';
import {
  isUsableEmail,
  MAX_UPLOAD_ROWS,
  parseCsv,
  readUpload,
  TEMPLATE_COLUMNS,
  templateCsv,
} from './csv';
import { findProfile, PROFILES, saveProfile } from './store';
import type { LearnerProfileRecord } from './types';
import { importParticipants, summarise } from './upload';

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

  it('stops at the row cap without reading the rest', () => {
    const lines = [
      HEADER,
      ...Array.from({ length: MAX_UPLOAD_ROWS + 1 }, (_, i) => row(`p${i}@acme.com`)),
    ];
    const read = readUpload(lines.join('\n'));
    assert.equal(read.ok, false);
    if (!read.ok) assert.match(read.error, /more than 1000 participants/);
    const atCap = readUpload(lines.slice(0, MAX_UPLOAD_ROWS + 1).join('\n'));
    assert.ok(atCap.ok);
    assert.equal(atCap.rows.length, MAX_UPLOAD_ROWS);
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
      'This address is already on line 2. Each person once.',
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
    assert.deepEqual(summarise(results), { created: 50, updated: 0, rejected: 0, incomplete: 0 });
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
    assert.deepEqual(summarise(results), { created: 2, updated: 0, rejected: 1, incomplete: 1 });
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
