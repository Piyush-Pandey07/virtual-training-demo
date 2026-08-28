/**
 * What somebody sees when they open an invitation link.
 *
 * Reachable without signing in, necessarily — it is the door. So it is careful about
 * what it says: the training being offered, and nothing about who else was invited,
 * who sent it, or what else exists here. A link that turns out to be dead says only
 * that it is not valid, in the same words whether it expired, was withdrawn, or
 * never existed, so a guessed token learns nothing from the difference.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { BrandHeader } from '@/components/BrandHeader';
import { currentPerson } from '@/lib/auth/session';
import { listDecks } from '@/lib/decks/registry';
import { explainProblem, hashToken, inviteProblem } from '@/lib/roster/invites';
import { rosterStore } from '@/lib/roster/registry';
import { AcceptInvite } from './AcceptInvite';

export const dynamic = 'force-dynamic';

// Not indexable, and no referrer, so the token does not travel to anywhere the
// person clicks next.
export const metadata: Metadata = {
  title: 'Invitation | Technavious',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;

  const store = rosterStore();
  const invite = await store.findInviteByHash(hashToken(token)).catch(() => undefined);
  const problem = inviteProblem(invite, new Date());

  const [person, decks] = await Promise.all([
    currentPerson(),
    invite ? listDecks().catch(() => []) : Promise.resolve([]),
  ]);

  const titles = invite
    ? invite.deckIds
        .map((id) => decks.find((deck) => deck.id === id))
        .filter((deck) => deck !== undefined)
        .map((deck) => ({ id: deck.id, title: deck.title, minutes: deck.estimatedMinutes }))
    : [];

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-16 sm:px-8">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Invitation</p>

        {problem || !invite ? (
          <>
            <h1 className="mt-3 text-3xl font-bold">This link does not work</h1>
            <p className="text-muted mt-3 text-base leading-relaxed">
              {explainProblem(problem ?? 'unknown')}
            </p>
            <p className="text-muted mt-8 text-sm">
              <Link href="/" className="hover:text-teal underline transition-colors">
                Go to the training home
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-3 text-3xl font-bold">You have been invited to training</h1>

            <p className="text-muted mt-3 text-base leading-relaxed">
              {titles.length === 0
                ? 'Accepting will give you access. Training will be assigned to you separately.'
                : `Accepting will assign you ${titles.length === 1 ? 'this session' : `these ${titles.length} sessions`}.`}
            </p>

            {titles.length > 0 && (
              <ul className="mt-6 grid gap-2">
                {titles.map((deck) => (
                  <li
                    key={deck.id}
                    className="border-charcoal-line bg-charcoal-soft flex items-center justify-between gap-3 rounded-md border px-4 py-3"
                  >
                    <span className="min-w-0 font-semibold">{deck.title}</span>
                    <span className="text-muted shrink-0 text-sm">{deck.minutes} min</span>
                  </li>
                ))}
              </ul>
            )}

            {invite.email && (
              <p className="text-muted mt-6 text-sm leading-relaxed">
                This invitation was issued to{' '}
                <span className="text-mist font-semibold">{invite.email}</span> and works only for
                that address.
              </p>
            )}

            <AcceptInvite
              token={token}
              signedInAs={person?.email ?? null}
              boundEmail={invite.email}
            />
          </>
        )}
      </main>
    </div>
  );
}
