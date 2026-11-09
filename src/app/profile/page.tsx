/**
 * My profile: what somebody has told the trainer about themselves, to view, change, or
 * withdraw consent and delete.
 *
 * Their own and nobody else's. There is no id in the address and none is read: the page
 * shows the signed-in person's profile, and an administrator opening it sees their own,
 * exactly as anybody else would. The views others are allowed are on /people/{id}/profile.
 *
 * Exists only for people PROFILES_ENABLED covers. Off, it is a 404 before anything else
 * is asked, including whether the visitor is signed in, so a signed-out visitor is not
 * sent to sign in on the way to a page that is not there.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireUserPage } from '@/lib/auth/guard';
import { profilesEnabled, profilesEnabledFor } from '@/lib/config';
import { formValuesOf } from '@/lib/profiles/client';
import { consentHistory, latestDecision } from '@/lib/profiles/consent';
import { findProfile } from '@/lib/profiles/store';
import { TRAINER_NAME } from '@/lib/trainer';
import { ProfileEditor } from './ProfileEditor';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'My profile | Technavious' };

export default async function ProfilePage() {
  if (!profilesEnabled()) notFound();
  const person = await requireUserPage('/profile');
  if (!profilesEnabledFor(person)) notFound();

  // A failed read is told apart from an empty profile, so somebody whose profile could
  // not be read is not shown a blank form that looks as if it had been lost.
  const read = await Promise.all([findProfile(person), consentHistory(person)]).then(
    ([profile, history]) => ({ ok: true as const, profile, latest: latestDecision(history) }),
    () => ({ ok: false as const, profile: undefined, latest: undefined }),
  );
  const { profile, latest } = read;

  const initial = formValuesOf(profile);
  if (!initial.name && person.name) initial.name = person.name;

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={person} current="/profile" />
      </BrandHeader>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-12 sm:px-8">
        <Link
          href="/"
          className="text-muted hover:text-teal mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Back
        </Link>

        <p className="text-teal text-sm font-semibold tracking-wide uppercase">My profile</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">What {TRAINER_NAME} knows about you</h1>
        <p className="text-muted mt-3 text-base leading-relaxed">
          These details let the trainer choose explanations and examples that suit your background.
          You, the facilitator of your sessions and Technavious&apos;s administrators can see them;
          your company&apos;s administrators cannot. You can withdraw your consent and delete them
          at any time.
        </p>

        {latest && (
          <p className="text-muted mt-4 text-sm">
            {latest.decision === 'given'
              ? `You agreed to the privacy notice on ${new Date(latest.at).toLocaleDateString('en-GB', { dateStyle: 'long' })}.`
              : `You withdrew your consent on ${new Date(latest.at).toLocaleDateString('en-GB', { dateStyle: 'long' })}. Your training carries on without a profile.`}
          </p>
        )}

        {!read.ok ? (
          <div
            role="alert"
            className="border-logo-red/40 bg-logo-red/10 mt-6 rounded-md border p-4 text-sm"
          >
            <p className="font-semibold">Your profile cannot be read right now.</p>
            <p className="text-muted mt-1 leading-relaxed">
              Nothing has been changed. Try again in a few minutes.
            </p>
          </div>
        ) : (
          <ProfileEditor
            initial={initial}
            exists={Boolean(profile)}
            withdrawn={latest?.decision === 'withdrawn'}
          />
        )}
      </main>
    </div>
  );
}
