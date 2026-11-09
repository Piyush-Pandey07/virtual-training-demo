/**
 * The privacy notice at sign-in (BRD v2.3, AI-27).
 *
 * Every guarded page sends somebody here until they have agreed to the notice that is
 * current, administrators and facilitators included, and back to where they were going
 * once they have. A participant also confirms their profile here: prefilled if their
 * organisation uploaded one, with any required field still missing to complete. Nobody
 * attends without agreeing; the optional fields can be left blank.
 *
 * The one guarded page that does not ask for consent first, since it is where consent is
 * asked for. Exists only for people PROFILES_ENABLED covers: for everybody else it is a
 * 404, and with the switch off a 404 before anything else is asked.
 */

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { SignOutButton } from '@/components/SignOutButton';
import { requireUserPageBeforeConsent } from '@/lib/auth/guard';
import { safeDestination } from '@/lib/auth/destination';
import { profilesEnabled, profilesEnabledFor } from '@/lib/config';
import { formValuesOf } from '@/lib/profiles/client';
import { hasCurrentConsent } from '@/lib/profiles/consent';
import { CONSENT_PATH } from '@/lib/profiles/gate';
import { findProfile } from '@/lib/profiles/store';
import { ConsentForm } from './ConsentForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Privacy notice | Technavious' };

interface ConsentPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  if (!profilesEnabled()) notFound();
  const { next } = await searchParams;
  // Checked before it is followed, as the sign-in page does, and never back to here.
  const parsed = safeDestination(next);
  const destination = parsed.startsWith(CONSENT_PATH) ? '/' : parsed;
  const person = await requireUserPageBeforeConsent(
    next ? `${CONSENT_PATH}?next=${encodeURIComponent(destination)}` : CONSENT_PATH,
  );
  if (!profilesEnabledFor(person)) notFound();

  // Somebody who has already agreed has nothing to do here. A failed read is treated as
  // not yet agreed: agreeing again only adds a record.
  if (await hasCurrentConsent(person).catch(() => false)) redirect(destination);

  const participant = person.role === 'trainee';
  const profile = participant ? await findProfile(person).catch(() => undefined) : undefined;
  const initial = formValuesOf(profile);
  // Their name from the roster, where nothing else has given one.
  if (participant && !initial.name && person.name) initial.name = person.name;

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <SignOutButton />
      </BrandHeader>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-12 sm:px-8">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Before you start</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Your data and your consent</h1>
        <p className="text-muted mt-3 text-base leading-relaxed">
          {participant
            ? 'Read how your data is used, check your profile, and agree to continue to your training.'
            : 'Read how your data is used and agree to continue. If you also attend training yourself, you can add a learner profile from My profile.'}
        </p>

        <ConsentForm
          participant={participant}
          initial={initial}
          uploaded={profile?.source === 'upload' && !profile.confirmed}
          destination={destination}
        />
      </main>
    </div>
  );
}
