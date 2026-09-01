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
import { requireUserPage } from '@/lib/auth/guard';
import { isPlatformAdmin } from '@/lib/auth/roles';
import { orgStore, orgsConfigured } from '@/lib/orgs/registry';
import { CustomerList, type CustomerRow } from './CustomerList';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Customers | Technavious' };

export default async function PlatformPage() {
  const person = await requireUserPage('/platform');
  if (!isPlatformAdmin(person.email)) notFound();

  const customers: CustomerRow[] = orgsConfigured()
    ? (await orgStore().list()).map((organisation) => ({
        id: organisation.id,
        name: organisation.name,
        domains: organisation.domains,
        status: organisation.status,
        sessionsPerMonth: organisation.limits.sessionsPerMonth,
      }))
    : [];

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader />

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

        <div className="mt-8">
          <CustomerList customers={customers} viewing={person.orgId} home={person.homeOrgId} />
        </div>
      </main>
    </div>
  );
}
