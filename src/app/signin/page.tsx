/**
 * The way in.
 *
 * Today it offers the development sign-in, which trusts a name rather than checking
 * one. When Firebase credentials arrive this becomes a "Continue with Microsoft"
 * button and nothing else on either dashboard changes, because everything downstream
 * asks `currentPerson()` rather than asking how the cookie got there.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { bootstrapAvailable } from '@/lib/auth/bootstrap';
import { currentPerson, devAuthEnabled, firebaseConfigured } from '@/lib/auth/session';
import { rosterStore } from '@/lib/roster/registry';
import { FirstAdmin } from './FirstAdmin';
import { PasswordSignIn } from './PasswordSignIn';
import { SignInForm, type Candidate } from './SignInForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Sign in | Technavious' };

interface SignInPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { next } = await searchParams;

  // Only ever somewhere inside this app. A `next` out of a query string is untrusted,
  // and sending somebody to an absolute URL after they sign in is an open redirect.
  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const person = await currentPerson();
  if (person) redirect(destination);

  const store = rosterStore();
  const real = firebaseConfigured();
  // The development sign-in is a fallback, not an alternative: wherever real
  // sign-in works, it is the only one offered.
  const dev = !real && devAuthEnabled();
  const firstRun = real && (await bootstrapAvailable());

  const people: Candidate[] = dev
    ? (await store.listPeople().catch(() => [])).map((entry) => ({
        id: entry.id,
        email: entry.email,
        name: entry.name,
        role: entry.role,
      }))
    : [];

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-16 sm:px-8">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">
          AI-led training sessions
        </p>
        <h1 className="mt-3 text-3xl font-bold">Sign in</h1>

        {firstRun ? (
          <>
            <p className="text-muted mt-3 text-sm leading-relaxed">
              Nobody administers this yet. Create the first account, using an address listed in
              AUTH_ADMIN_EMAILS. Everybody after you joins by invitation.
            </p>
            <div className="mt-8">
              <FirstAdmin next={destination} />
            </div>
          </>
        ) : real ? (
          <>
            <p className="text-muted mt-3 text-sm leading-relaxed">
              Sign in with your Technavious email address.
            </p>
            <div className="mt-8">
              <PasswordSignIn next={destination} />
            </div>
          </>
        ) : dev ? (
          <>
            <p className="text-muted mt-3 text-sm leading-relaxed">
              This is the development sign-in: it takes your word for who you are. Company sign-in
              replaces it once Firebase is configured.
            </p>
            <div className="mt-8">
              <SignInForm people={people} next={destination} />
            </div>
          </>
        ) : (
          <div
            role="alert"
            className="border-logo-red/40 bg-logo-red/10 mt-6 rounded-md border p-4 text-sm"
          >
            <p className="font-semibold">Sign-in is not configured on this deployment.</p>
            <p className="text-muted mt-2 leading-relaxed">
              {firebaseConfigured()
                ? 'Firebase is configured but the sign-in button has not been wired up yet.'
                : 'Whoever deployed this needs to set the Firebase credentials and redeploy. Until then nobody can sign in, which is why nothing here is reachable.'}
            </p>
          </div>
        )}

        <p className="text-muted mt-10 text-sm">
          <Link href="/" className="hover:text-teal underline transition-colors">
            Back
          </Link>
        </p>
      </main>
    </div>
  );
}
