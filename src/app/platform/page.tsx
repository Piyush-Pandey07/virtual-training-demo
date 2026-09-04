/**
 * The customer list, for Technavious only.
 *
 * Every other screen in the app shows one customer, because the store behind it was
 * built for one. This is the only page that sees across them, and it exists so support
 * can find a customer rather than needing an organisation id from somewhere else.
 *
 * A 404 for anybody else. Not a 403: a customer's administrator should not learn that
 * this page exists, and certainly not that other customers do.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireUserPage } from '@/lib/auth/guard';
import { isPlatformAdmin } from '@/lib/auth/roles';
import { orgStore, orgsConfigured } from '@/lib/orgs/registry';
import { customerOverview } from '@/lib/platform/overview';
import { usageFor } from '@/lib/usage/store';
import { CustomerList, type CustomerRow } from './CustomerList';
import { HappeningNow } from './HappeningNow';
import { MovePerson } from './MovePerson';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Customers | Technavious' };

export default async function PlatformPage() {
  const person = await requireUserPage('/platform');
  if (!isPlatformAdmin(person.email)) notFound();

  // This month's spend beside each customer, and who and what is behind it.
  //
  // Read cost, stated properly because the first version of this comment said "a handful
  // per customer" and was wrong. One page load is 1 + C x (3 + D) round trips: the
  // organisation list, then per customer the usage record, the roster, the deck list, and
  // one attempts query per deck. Twenty customers with thirty decks each is about 660.
  //
  // The multiplication is by decks, not customers, so a few customers with large
  // libraries reach that long before the customer count does. Nothing bounds either: no
  // pagination on the organisation list, the roster or the deck list, and no cap on how
  // many decks a customer may upload.
  //
  // Acceptable while customers are hand-provisioned and this screen is opened a few times
  // a day. The fix when it stops being acceptable is a rollup counter written as
  // assignments and attempts are recorded, which turns the per-customer cost into O(1)
  // reads. Not built yet because a counter maintained on every write is a second source
  // of truth, and a wrong one is worse than a slow page.
  const customers: CustomerRow[] = orgsConfigured()
    ? await Promise.all(
        (await orgStore().list()).map(async (organisation) => {
          const [usage, overview] = await Promise.all([
            usageFor(organisation.id).catch(() => undefined),
            customerOverview(organisation.id),
          ]);
          return {
            id: organisation.id,
            name: organisation.name,
            domains: organisation.domains,
            status: organisation.status,
            sessionsPerMonth: organisation.limits.sessionsPerMonth,
            usage: {
              sessions: usage?.sessions ?? 0,
              ttsCharacters: usage?.ttsCharacters ?? 0,
              sttSeconds: usage?.sttSeconds ?? 0,
              geminiTokens: (usage?.geminiInputTokens ?? 0) + (usage?.geminiOutputTokens ?? 0),
            },
            overview,
          };
        }),
      )
    : [];

  // Every session open anywhere, newest first. Lifted out of the per-customer rows
  // because "is anybody in a session right now" is the question this screen is opened
  // for, and answering it should not mean reading five rows and adding them up.
  const happeningNow = customers
    .flatMap((customer) =>
      customer.overview.sessions.open.map((session) => ({ ...session, customer: customer.name })),
    )
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={person} current="/platform" />
      </BrandHeader>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Technavious</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Customers</h1>
        <p className="text-muted mt-3 max-w-2xl text-base leading-relaxed">
          Every company using this deployment. Opening one shows you what their administrators see,
          and everything you do while you are in there happens inside their organisation — so leave
          it again when you are done.
        </p>

        {!orgsConfigured() && (
          <p className="border-logo-red/40 bg-logo-red/10 mt-8 rounded-md border p-4 text-sm">
            Firebase is not configured on this deployment, so there is nowhere for customers to be
            kept and this list cannot mean anything.
          </p>
        )}

        {orgsConfigured() && <HappeningNow sessions={happeningNow} />}

        <div className="mt-8">
          <CustomerList customers={customers} viewing={person.orgId} home={person.homeOrgId} />
        </div>

        {customers.length > 1 && (
          <MovePerson
            customers={customers.map((customer) => ({ id: customer.id, name: customer.name }))}
          />
        )}
      </main>
    </div>
  );
}
