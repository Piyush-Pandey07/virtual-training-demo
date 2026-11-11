/**
 * The data centre glossary, as the administrator manages it (AI-21).
 *
 * The glossary decides what terms mean; the deck decides what is taught. Every term here
 * is given to the trainer, with its definition, on any turn of a data centre deck that
 * uses it, except the ones held back. The administrator searches the list, adds terms,
 * changes their words, holds a definition back or releases it with a reason, deletes
 * one, or puts the whole glossary back to the imported file.
 *
 * Technavious only. Anybody else gets a 404, as for every administrator's tool they have
 * no use for. The list is read fresh rather than from the trainer's cache, so what is
 * shown is what is stored.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireUserPage } from '@/lib/auth/guard';
import { isAdministrator } from '@/lib/auth/permissions';
import {
  GLOSSARY_CACHE_MS,
  glossaryForAdministrator,
  glossaryPersists,
} from '@/lib/glossary/store';
import { GlossaryManager } from './GlossaryManager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Glossary | Technavious' };

export default async function GlossaryPage() {
  const person = await requireUserPage('/glossary');
  if (!isAdministrator(person)) notFound();

  const entries = await glossaryForAdministrator(person);
  const held = entries.filter((entry) => entry.held).length;

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={person} current="/glossary" />
      </BrandHeader>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-8">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">Technavious</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Data centre glossary</h1>
        <p className="text-muted mt-3 max-w-3xl text-base leading-relaxed">
          The glossary decides what terms mean; the deck decides what is taught. On a data centre
          deck, the trainer is given the definitions of the terms each turn uses, and keeps to them.
          {` ${entries.length} terms, ${held} held back from the trainer.`} A change reaches every
          session within {Math.round(GLOSSARY_CACHE_MS / 60_000)} minutes.
        </p>
        {!glossaryPersists() && (
          <p className="border-logo-red/50 mt-4 max-w-3xl rounded-md border px-4 py-3 text-sm">
            Firestore is not configured on this deployment, so the glossary is the imported file
            held in memory. Changes work, and are lost when the server restarts.
          </p>
        )}

        <GlossaryManager entries={entries} />
      </main>
    </div>
  );
}
