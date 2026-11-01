/**
 * The OpenAI test.
 *
 * For Technavious staff deciding how to offer languages beyond English: Deepgram with
 * Sarvam beside it, or OpenAI alone. Here they can hear OpenAI's voices say the same
 * sentence in English, Hindi and Indonesian, and in Arabic, Malay, Filipino, Vietnamese,
 * Tamil, Telugu and Marathi, which are wanted next; hear today's voice say it where there
 * is one; and record themselves to compare OpenAI's transcript with Deepgram's.
 *
 * Nothing a trainee does reaches this page or OpenAI. Anybody who is not Technavious
 * staff gets a 404, exactly as for any other administrator's page.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { requireAdminPage } from '@/lib/auth/guard';
import { hindiAvailable, openAiConfigured } from '@/lib/config';
import { mayUseOpenAiTest } from '@/lib/openai-test/access';
import { OpenAiTest } from './OpenAiTest';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'OpenAI test' };

export default async function OpenAiTestPage() {
  const person = await requireAdminPage('/openai-test');
  if (!mayUseOpenAiTest(person)) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={person} current="/openai-test" />
      </BrandHeader>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-8">
        <p className="text-teal text-sm font-semibold tracking-wide uppercase">
          Technavious staff only
        </p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">OpenAI test</h1>
        <p className="text-muted mt-3 text-base leading-relaxed">
          Hear how OpenAI speaks English, Hindi, Indonesian and the languages wanted next, beside
          the voices the trainer uses today, and see how well it understands you. Nothing here is
          used in a training session, and customers never see this page.
        </p>

        <OpenAiTest configured={openAiConfigured()} hindi={hindiAvailable()} />
      </main>
    </div>
  );
}
