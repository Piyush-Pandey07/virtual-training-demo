/**
 * The white paper library (AI-46).
 *
 * The trainer answers only from the deck, the glossary and approved white papers. This
 * is where the papers come from: Technavious uploads them as PDFs, the deck approver
 * approves each one as it stands, and the deck page attaches approved papers to the
 * decks that may draw on them.
 *
 * Per customer, like the deck library: Technavious looking inside a customer sees and
 * manages that customer's papers. Technavious only; anybody else gets a 404, as for every
 * Technavious tool.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireAdministratorPage } from '@/lib/auth/guard';
import { listWhitePapers, whitePaperSummaryOf } from '@/lib/white-papers/store';
import type { WhitePaperApprovalView } from '@/lib/white-papers/types';
import { UploadWhitePaper } from './UploadWhitePaper';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'White papers | Technavious' };

function stateLabel(approval: WhitePaperApprovalView, withdrawn: boolean): string {
  if (withdrawn) return 'Withdrawn';
  if (approval.state === 'approved') return `Approved, version ${approval.version}`;
  if (approval.state === 'changed') return 'Changed since approval';
  return 'Needs approval';
}

export default async function WhitePapersPage() {
  const person = await requireAdministratorPage('/white-papers');
  const papers = (await listWhitePapers(person.orgId)).map(whitePaperSummaryOf);

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={person} current="/white-papers" />
      </BrandHeader>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Technavious</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">White papers</h1>
        <p className="text-muted mt-3 max-w-2xl text-base leading-relaxed">
          The trainer answers only from the deck, the glossary and approved white papers. A paper is
          used only while it is approved exactly as it stands and attached to the deck being taught,
          and then only the few passages that bear on the slide and the question.
        </p>

        <div className="mt-8 space-y-8">
          <UploadWhitePaper />

          <section aria-labelledby="library-heading">
            <h2 id="library-heading" className="text-xl font-semibold">
              {papers.length} {papers.length === 1 ? 'paper' : 'papers'}
            </h2>
            {papers.length === 0 ? (
              <p className="text-muted mt-2 text-sm">None uploaded yet.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {papers.map((paper) => (
                  <li
                    key={paper.id}
                    className="border-charcoal-line bg-charcoal-soft rounded-xl border px-5 py-3"
                  >
                    <Link
                      href={`/white-papers/${encodeURIComponent(paper.id)}`}
                      className="hover:text-teal font-semibold transition-colors"
                    >
                      {paper.title}
                    </Link>
                    <p className="text-muted mt-1 text-sm">
                      {stateLabel(paper.approval, paper.status === 'withdrawn')} · {paper.pageCount}{' '}
                      {paper.pageCount === 1 ? 'page' : 'pages'} · {paper.passageCount} passages
                    </p>
                    {paper.summary && <p className="mt-1 text-sm">{paper.summary}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
