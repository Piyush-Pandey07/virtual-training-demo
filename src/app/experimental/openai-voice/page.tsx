/**
 * EXPERIMENTAL -- OpenAI voice trial, at /experimental/openai-voice.
 *
 * Anybody signed in may open it, since the people judging the voices are the people
 * who attend the training. Signed-out visitors are sent to sign in, because every
 * button on this page spends money on the OpenAI key.
 *
 * Nothing in the app links here and nothing here changes a training session. Delete
 * the experimental folders to remove it; see src/experimental/openai-voice/README.md.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { BrandHeader } from '@/components/BrandHeader';
import { MainNav } from '@/components/MainNav';
import { TRIAL_PATH } from '@/experimental/openai-voice/catalogue';
import { openAiKey } from '@/experimental/openai-voice/openai';
import { SpeechToText } from '@/experimental/openai-voice/SpeechToText';
import { VoiceSamples } from '@/experimental/openai-voice/VoiceSamples';
import { requireUserPage } from '@/lib/auth/guard';
import { VOICE_SAMPLE_TEXT, voiceCatalogue } from '@/lib/voice/catalogue';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'OpenAI voice trial | Technavious' };

export default async function OpenAiVoiceTrialPage() {
  const me = await requireUserPage(TRIAL_PATH);
  const configured = openAiKey() !== null;

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader>
        <MainNav person={me} />
      </BrandHeader>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8">
        <Link
          href="/"
          className="text-muted hover:text-teal mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Back
        </Link>

        <p className="text-teal text-sm font-semibold tracking-wide uppercase">
          Experimental trial
        </p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">OpenAI voice trial</h1>
        <p className="text-muted mt-3 max-w-2xl leading-relaxed">
          Hear how the trainer would sound with OpenAI&apos;s voices, and how well OpenAI hears a
          trainee. This page is separate from the training app: nothing here changes a session.
        </p>

        {!configured && (
          <div
            role="alert"
            className="border-logo-red/40 bg-logo-red/10 mt-6 rounded-md border p-4 text-sm"
          >
            <p className="font-semibold">OpenAI is not connected on this deployment.</p>
            <p className="text-muted mt-1 leading-relaxed">
              Set <code className="text-mist">OPENAI_API_KEY</code> in the Vercel project&apos;s
              environment variables and redeploy. Until then every button here will say so.
            </p>
          </div>
        )}

        <section className="mt-12" aria-labelledby="voices-heading">
          <h2 id="voices-heading" className="text-xl font-bold">
            1. Hear the voices
          </h2>
          <p className="text-muted mt-1 mb-5 text-sm">
            Every voice says the same line, so they can be compared. Each shows how long it took to
            start speaking, which is the pause a trainee would hear.
          </p>
          <VoiceSamples
            currentVoices={voiceCatalogue().voices}
            currentSampleText={VOICE_SAMPLE_TEXT}
          />
        </section>

        <section
          className="border-charcoal-line mt-14 border-t pt-10"
          aria-labelledby="stt-heading"
        >
          <h2 id="stt-heading" className="text-xl font-bold">
            2. Test speech to text
          </h2>
          <p className="text-muted mt-1 mb-5 text-sm">
            Read a sentence aloud and see what each model heard, how long it took, and how many
            words it got right.
          </p>
          <SpeechToText />
        </section>
      </main>
    </div>
  );
}
