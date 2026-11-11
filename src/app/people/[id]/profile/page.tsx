/**
 * One person's learner profile, read-only (BRD v2.3, AI-06).
 *
 * For the facilitator of a session or batch the person is in, and for the administrator.
 * A company administrator, another participant, or anybody PROFILES_ENABLED leaves out
 * gets a 404, the same as for an id that does not exist. The rule is `mayViewProfile`,
 * asked through `viewProfile` before anything is read.
 *
 * The trainer-led session screens link here for a facilitator; the person page links here
 * for the administrator.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireUserPage } from '@/lib/auth/guard';
import { profilesEnabled, profilesEnabledFor, profilesEnabledInOrg } from '@/lib/config';
import { detailsOf, displayValue, missingRequired, PROFILE_FIELDS } from '@/lib/profiles/types';
import { viewProfile } from '@/lib/profiles/view';
import { deletionDue } from '@/lib/retention/policy';
import { RESTRICTED_EXPLANATION } from '@/lib/retention/restricted';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Learner profile | Technavious' };

interface ProfileViewPageProps {
  params: Promise<{ id: string }>;
}

function dateOf(iso: string | undefined): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'long' }) : '';
}

export default async function ProfileViewPage({ params }: ProfileViewPageProps) {
  if (!profilesEnabled()) notFound();
  const { id } = await params;
  const viewer = await requireUserPage(`/people/${encodeURIComponent(id)}/profile`);
  if (!profilesEnabledFor(viewer) || !profilesEnabledInOrg(viewer.orgId)) notFound();

  const view = await viewProfile(viewer, id);
  if (!view) notFound();
  const { person, profile, restricted } = view;
  const details = detailsOf(profile);
  const missing = profile ? missingRequired(details) : [];
  // Only an administrator is handed a restricted profile, and is told when it will go.
  const due = profile?.retention ? deletionDue(profile.retention) : null;

  const status = restricted
    ? profile
      ? `Restricted under the retention policy on ${dateOf(profile.retention?.restrictedAt)}, because there has been no session for 90 days. Only Technavious administrators can see it${due ? `, and it will be deleted on ${dateOf(due)} unless they attend another session` : ''}. The trainer does not use it.`
      : RESTRICTED_EXPLANATION
    : !profile
      ? 'No profile. They have not filled one in, or they withdrew their consent.'
      : profile.confirmed
        ? `Confirmed by them on ${dateOf(profile.consent?.at ?? profile.updatedAt)}.`
        : `Uploaded by their organisation on ${dateOf(profile.uploadedAt)}, not yet confirmed by them. The trainer does not use it until they do.`;

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={viewer} />
      </BrandHeader>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-12 sm:px-8">
        <Link
          href="/"
          className="text-muted hover:text-teal mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Home
        </Link>

        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Learner profile</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{person.name || person.email}</h1>
        <p className="text-muted mt-2 text-base">{person.email}</p>
        <p className="text-muted mt-4 text-sm">{status}</p>
        {missing.length > 0 && (
          <p className="text-muted mt-1 text-sm">
            Still to complete: {missing.map((field) => field.label.toLowerCase()).join(', ')}.
          </p>
        )}

        {profile && (
          <dl className="border-charcoal-line bg-charcoal-soft divide-charcoal-line mt-8 divide-y rounded-xl border px-5">
            {PROFILE_FIELDS.map((field) => (
              <div key={field.key} className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
                <dt className="text-muted text-sm">{field.label}</dt>
                <dd className="text-sm sm:col-span-2">
                  {displayValue(field, details) || <span className="text-muted">Not given</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <p className="text-muted mt-6 text-xs leading-relaxed">
          Shown to you because you facilitate their training or administer the platform. Their
          company&apos;s administrators cannot see it. Do not copy it elsewhere.
        </p>
      </main>
    </div>
  );
}
