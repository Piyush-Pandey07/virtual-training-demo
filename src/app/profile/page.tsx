/**
 * My profile: what somebody has told the trainer about themselves, to view, change or
 * delete.
 *
 * Their own and nobody else's. There is no id in the address and none is read: the
 * page shows the signed-in person's profile, and an administrator opening it sees their
 * own, exactly as anybody else would.
 *
 * Exists only while PROFILES_ENABLED is on. Off, it is a 404 before anything else is
 * asked, including whether the visitor is signed in, so a signed-out visitor is not sent
 * to sign in on the way to a page that is not there.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireUserPage } from '@/lib/auth/guard';
import { profilesEnabled } from '@/lib/config';
import { listDecks } from '@/lib/decks/registry';
import { getProfile } from '@/lib/profiles/store';
import { isExpertiseLevel, type LearnerProfileRecord, PERSONAL_FIELDS } from '@/lib/profiles/types';
import { rosterStore } from '@/lib/roster/registry';
import type { SignedInPerson } from '@/lib/roster/types';
import { TRAINER_NAME } from '@/lib/trainer';
import { ProfileEditor, type CourseLevel } from './ProfileEditor';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'My profile | Technavious' };

/**
 * The courses a profile holds a level for, with their titles where this person may
 * know them.
 *
 * Titles come only from decks the person could attend: every deck in their customer for
 * an administrator, their assignments for anybody else. A level can be saved against any
 * well-formed deck id, so naming whatever deck an id resolved to would let somebody
 * guess ids and read back titles of decks nobody gave them, which is the confirmation
 * the guard's 404s exist to withhold.
 */
async function coursesFor(
  person: SignedInPerson,
  profile: LearnerProfileRecord | undefined,
): Promise<CourseLevel[]> {
  const entries = Object.entries(profile?.expertise ?? {});
  if (entries.length === 0) return [];

  const [decks, assigned] = await Promise.all([
    listDecks(person.orgId).catch(() => []),
    person.role === 'admin'
      ? Promise.resolve(null)
      : rosterStore(person.orgId)
          .listAssignmentsForPerson(person.id)
          .then((rows) => new Set(rows.map((row) => row.deckId)))
          .catch(() => new Set<string>()),
  ]);
  const titles = new Map(
    decks
      .filter((deck) => assigned === null || assigned.has(deck.id))
      .map((deck) => [deck.id, deck.title]),
  );

  return (
    entries
      .map(([deckId, level]) => ({ deckId, level, title: titles.get(deckId) ?? null }))
      .filter((course) => isExpertiseLevel(course.level))
      // By title, with the courses they can no longer see at the end.
      .sort((a, b) =>
        a.title === null || b.title === null
          ? Number(a.title === null) - Number(b.title === null)
          : a.title.localeCompare(b.title),
      )
  );
}

export default async function ProfilePage() {
  if (!profilesEnabled()) notFound();
  const person = await requireUserPage('/profile');

  // A failed read is told apart from an empty profile, so somebody whose profile could
  // not be read is not shown a blank form that looks as if it had been lost.
  const read = await getProfile(person).then(
    (profile) => ({ ok: true as const, profile }),
    () => ({ ok: false as const, profile: undefined }),
  );
  const unreadable = !read.ok;
  const profile = read.profile;
  const courses = await coursesFor(person, profile);

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
          These details let the trainer pitch each course to your experience and use the odd example
          that means something to you. All of it is optional, only you can see this page, and you
          can delete it at any time.
        </p>

        {unreadable ? (
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
            initial={Object.fromEntries(
              PERSONAL_FIELDS.map((field) => [field.key, profile?.[field.key] ?? '']),
            )}
            courses={courses}
            exists={Boolean(profile)}
          />
        )}
      </main>
    </div>
  );
}
