/**
 * One white paper (AI-46): where it stands with its approver, what can be done to it,
 * and its text exactly as the trainer would be given it, passage by passage.
 *
 * The text is shown in full because that is what is being approved. The passages are
 * the units the trainer is handed a few at a time, so seeing where they break is part of
 * reading it.
 *
 * Technavious only, and read from the organisation the viewer is in, so an id from
 * another customer is a 404.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireAdministratorPage } from '@/lib/auth/guard';
import {
  mayApproveWhitePapers,
  whitePaperFor,
  whitePaperSummaryOf,
  whitePaperTextFor,
} from '@/lib/white-papers/store';
import { ManageWhitePaper } from './ManageWhitePaper';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'White paper | Technavious' };

interface PaperPageProps {
  params: Promise<{ id: string }>;
}

export default async function WhitePaperPage({ params }: PaperPageProps) {
  const { id } = await params;
  const person = await requireAdministratorPage(`/white-papers/${encodeURIComponent(id)}`);

  const [paper, text] = await Promise.all([
    whitePaperFor(person.orgId, id).catch(() => undefined),
    whitePaperTextFor(person.orgId, id).catch(() => undefined),
  ]);
  if (!paper) notFound();
  const summary = whitePaperSummaryOf(paper);

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={person} />
      </BrandHeader>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8">
        <Link href="/white-papers" className="text-muted hover:text-teal text-sm">
          White papers
        </Link>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{paper.title}</h1>
        <p className="text-muted mt-3 text-sm">
          Version {paper.version}, from {paper.fileName}: {paper.pageCount}{' '}
          {paper.pageCount === 1 ? 'page' : 'pages'}, {paper.passageCount} passages,{' '}
          {paper.characters.toLocaleString('en-GB')} characters.{' '}
          {summary.originalKept ? (
            <a
              href={`/api/white-papers/${encodeURIComponent(paper.id)}/original`}
              className="text-teal hover:underline"
            >
              Open the original PDF
            </a>
          ) : (
            'The original PDF was not kept; its text is.'
          )}
        </p>
        {paper.summary && <p className="mt-3 max-w-2xl leading-relaxed">{paper.summary}</p>}

        <div className="mt-8 space-y-8">
          <ManageWhitePaper paper={summary} mayApprove={mayApproveWhitePapers(person)} />

          <section aria-labelledby="text-heading">
            <h2 id="text-heading" className="text-xl font-semibold">
              The text, as the trainer is given it
            </h2>
            {!text || text.textFingerprint !== paper.textFingerprint ? (
              <p className="border-logo-red/50 mt-4 rounded-md border px-4 py-3 text-sm">
                The stored text does not match this version, so no deck will draw on it. Replace the
                PDF to store it again.
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {text.passages.map((passage) => (
                  <li
                    key={passage.id}
                    className="border-charcoal-line bg-charcoal-soft rounded-xl border px-5 py-3"
                  >
                    <p className="text-muted text-xs">
                      {passage.id}, page {passage.page}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
                      {passage.text}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
