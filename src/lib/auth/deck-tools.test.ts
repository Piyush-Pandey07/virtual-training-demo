import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { isAdministrator, isCompanyAdmin } from './permissions';

/**
 * Decks are Technavious's (the product owner, for UAT): "only the Benchmark administrator
 * can upload and review decks; company administrators manage facilitators and
 * participants and see company-wide statistics."
 *
 * So uploading, editing, analysing, publishing and withdrawing, approving, deleting, and
 * question banks are behind `isAdministrator`, which Technavious staff looking inside a
 * customer pass. A company administrator keeps the published library read-only,
 * assigning approved decks, their people, and their company's progress and results.
 *
 * The routes need a session to call, so they are read out of the source, as the
 * authorisation boundary is.
 */

const read = (path: string) => readFileSync(path, 'utf8');

const companyAdmin = { role: 'admin' as const, platform: false, homeOrgId: 'acme' };
const benchmark = { role: 'admin' as const, platform: false, homeOrgId: 'technavious' };
const staffInside = { role: 'admin' as const, platform: true, homeOrgId: 'technavious' };

describe('who manages decks', () => {
  it('is Technavious, including staff looking inside a customer, and not a company administrator', () => {
    assert.equal(isAdministrator(benchmark), true);
    assert.equal(isAdministrator(staffInside), true);
    assert.equal(isAdministrator(companyAdmin), false);
    assert.equal(isCompanyAdmin(companyAdmin), true);
  });
});

describe('the deck routes', () => {
  const ADMINISTRATOR_ONLY = [
    'src/app/api/decks/route.ts',
    'src/app/api/decks/[id]/route.ts',
    'src/app/api/decks/[id]/analyse/route.ts',
    'src/app/api/decks/[id]/approval/route.ts',
    'src/app/api/decks/[id]/lesson-plan/route.ts',
  ];

  for (const path of ADMINISTRATOR_ONLY) {
    it(`${path} is Technavious only`, () => {
      const text = read(path);
      assert.match(text, /const gate = await checkAdministrator\(\);/);
      assert.doesNotMatch(text, /\bcheckAdmin\(\)/, 'a company administrator can still get in');
    });
  }

  it('lets a company administrator read slide images but not upload them', () => {
    const text = read('src/app/api/decks/[id]/assets/[...name]/route.ts');
    const put = text.slice(text.indexOf('export async function PUT'));
    assert.match(put, /await checkAdministrator\(\)/);
    assert.match(text, /checkDeckViewer\(id\)/);
  });

  it('keeps question banks Technavious’s', () => {
    assert.match(read('src/lib/assessments/access.ts'), /return isAdministrator\(viewer\);/);
  });

  it('refuses with the 404 the other Technavious tools give', () => {
    const guard = read('src/lib/auth/guard.ts');
    assert.match(
      guard,
      /export async function requireAdministrator[\s\S]*?if \(!isAdministrator\(person\)\) throw new NotAuthorised\(404/,
    );
    assert.match(
      guard,
      /export async function requireAdministratorPage[\s\S]*?if \(!isAdministrator\(person\)\) notFound\(\);/,
    );
  });

  it('still lets a company administrator assign approved decks', () => {
    assert.match(read('src/app/api/assignments/route.ts'), /await requireAdmin\(\)/);
  });
});

describe('the deck pages', () => {
  it('keeps the upload page to Technavious', () => {
    assert.match(
      read('src/app/decks/new/page.tsx'),
      /await requireAdministratorPage\('\/decks\/new'\)/,
    );
  });

  it('shows a company administrator the published library only, with no upload', () => {
    const text = read('src/app/decks/page.tsx');
    assert.match(text, /manages \|\| deck\.status === 'published'/);
    assert.match(text, /\{manages && store\.writable && \(/);
  });

  it('shows a company administrator a published deck read-only, and never a draft', () => {
    const text = read('src/app/decks/[id]/page.tsx');
    assert.match(text, /if \(!manages && stored\.status !== 'published'\) notFound\(\);/);
    assert.match(
      text,
      /\{manages \? \(\s*<DeckReview/,
      'the editor is shown to a company administrator',
    );
    assert.match(text, /\{manages && !stored\.readOnly && \(\s*<DeleteDeck/);
    assert.match(text, /<AssignDeck/, 'the company administrator lost the way to assign');
  });

  it('lets a company administrator open a published deck without being assigned it, not a draft', () => {
    const guard = read('src/lib/auth/guard.ts');
    const opens = guard.slice(guard.indexOf('async function opensUnassigned'));
    assert.match(opens, /if \(isAdministrator\(person\)\) return true;/);
    assert.match(opens, /return stored\?\.status === 'published';/);
  });
});

describe('the deck page layout', () => {
  const text = read('src/app/decks/[id]/page.tsx');

  it('shows the approval near the top, before the slides and their Publish actions', () => {
    assert.ok(text.indexOf('<ApproveDeck') < text.indexOf('<DeckReview'));
  });

  it('puts the deck’s own links in a row under the title, not in the main header', () => {
    const header = text.slice(text.indexOf('<BrandHeader>'), text.indexOf('</BrandHeader>'));
    assert.doesNotMatch(header, /Who has attended|Results and feedback|Question banks|deckLinks/);
    assert.match(text, /<nav\s+aria-label="This deck"/);
  });
});

describe('the administrator home and the navigation', () => {
  it('does not offer a company administrator uploading', () => {
    const page = read('src/app/page.tsx');
    assert.match(page, /canUpload=\{manages && store\.writable\}/);
    assert.match(page, /mayManageDecks=\{manages\}/);
    const home = read('src/app/HomeForAdmin.tsx');
    assert.match(home, /\{mayManageDecks &&\s*\(canUpload \?/);
  });

  it('offers no upload link in the header to anybody', () => {
    assert.doesNotMatch(read('src/components/MainNav.tsx'), /\/decks\/new/);
  });
});
