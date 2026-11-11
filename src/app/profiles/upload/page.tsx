/**
 * Upload participants (BRD v2.3, AI-28).
 *
 * Download the template, fill it in, upload it, and see what happened to every row. For
 * the administrator, a company administrator and a facilitator, in their own
 * organisation. A 404 for anybody else, and for anybody PROFILES_ENABLED leaves out.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireUserPage } from '@/lib/auth/guard';
import { profilesEnabled, profilesEnabledFor, profilesEnabledInOrg } from '@/lib/config';
import { mayUploadParticipants } from '@/lib/profiles/access';
import { MAX_UPLOAD_BYTES, TEMPLATE_COLUMNS } from '@/lib/profiles/csv';
import { PROFILE_FIELDS } from '@/lib/profiles/types';
import { UploadParticipants } from './UploadParticipants';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Upload participants | Technavious' };

export default async function UploadParticipantsPage() {
  if (!profilesEnabled()) notFound();
  const person = await requireUserPage('/profiles/upload');
  if (
    !profilesEnabledFor(person) ||
    !profilesEnabledInOrg(person.orgId) ||
    !mayUploadParticipants(person)
  ) {
    notFound();
  }

  const required = PROFILE_FIELDS.filter((field) => field.required).map((field) => field.column);

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={person} current="/profiles/upload" />
      </BrandHeader>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8">
        <Link
          href="/"
          className="text-muted hover:text-teal mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Back
        </Link>

        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Participants</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Upload participants</h1>
        <p className="text-muted mt-3 text-base leading-relaxed">
          Add a batch of participants at once, with their profiles filled in. Each person is added
          to your organisation, or found if they are already here. On their first visit they see
          their profile, correct and complete it, and agree to the privacy notice before it is used.
        </p>

        <section className="border-charcoal-line bg-charcoal-soft mt-8 rounded-xl border p-5 text-sm leading-relaxed">
          <h2 className="text-lg font-semibold">How to fill in the template</h2>
          <ul className="text-muted mt-3 list-disc space-y-1.5 pl-5">
            <li>One participant per row. Keep the first row as it is.</li>
            <li>
              <span className="text-mist font-semibold">email</span> is needed on every row, and
              each address once. If an address is given twice, the first row is kept and the other
              is reported as a duplicate.
            </li>
            <li>
              Fill in {required.join(', ')} where you know them. Anything left empty, the
              participant is asked for on their first visit.
            </li>
            <li>
              <span className="text-mist font-semibold">proficiency</span> is Beginner, Intermediate
              or Advanced. <span className="text-mist font-semibold">years_of_experience</span> is a
              number, such as 6 or 6.5.
            </li>
            <li>
              Save as &ldquo;CSV UTF-8 (comma delimited)&rdquo;. Any number of rows, in a file of up
              to {MAX_UPLOAD_BYTES / 1_048_576} MB.
            </li>
          </ul>
          <p className="text-muted mt-3 text-xs">Columns: {TEMPLATE_COLUMNS.join(', ')}</p>
          <a
            href="/api/profiles/template"
            download
            className="text-teal ring-teal/40 hover:bg-teal/10 mt-4 inline-block rounded-md px-4 py-2 font-semibold ring-1 transition-colors ring-inset"
          >
            Download the template
          </a>
        </section>

        <UploadParticipants maxBytes={MAX_UPLOAD_BYTES} />
      </main>
    </div>
  );
}
