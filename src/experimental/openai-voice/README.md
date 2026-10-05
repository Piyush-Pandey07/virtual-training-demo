# Experimental: OpenAI voice trial

A page where the team can hear OpenAI's voices and test OpenAI's speech to text, before
anybody decides whether to move the trainer off Deepgram. It is a trial, kept apart from
the training app so it can be switched off or deleted without touching anything else.

**Open it at `/experimental/openai-voice`** once signed in. Nothing in the app links to it.

## What it does

1. **Hear the voices.** All 13 OpenAI voices say the same line, using the same speaking
   style, so they can be compared. Each shows how long it took to start speaking, which
   is the pause a trainee would hear. The app's current Deepgram voices sit underneath,
   saying the app's own sample line, for a like-for-like comparison. You can choose the
   model, the line (including tricky terms such as "ISO/IEC 27001" and "TVRA", or your own
   words), and the speaking style, including an Indian English accent.
2. **Test speech to text.** Read a test sentence aloud. The recording goes to each chosen
   OpenAI model in parallel, and each result shows what it heard, how long it took, and
   the percentage of words it got right. You can send the training vocabulary along to
   see whether it helps.

## Switching it on

Set one environment variable, in Vercel under **Settings → Environment Variables**, then
redeploy:

| Variable          | Value                                                                |
| ----------------- | -------------------------------------------------------------------- |
| `OPENAI_API_KEY`  | An OpenAI key with billing enabled.                                  |
| `OPENAI_BASE_URL` | Optional. Defaults to `https://api.openai.com/v1`. Only for a proxy. |

Without the key the page still opens and says the key is missing. The rest of the app is
unaffected either way.

## Who can use it, and what it costs

- **Signed-in users only.** Both the page and its two routes use the app's own sign-in
  guard, so a leaked link cannot spend money on the key.
- **Capped.** At most 600 characters per sample and 30 seconds per recording.
- **Cheap.** A voice sample or a transcription costs a fraction of a cent. Replaying a
  voice with the same settings is served from the browser, so it costs nothing.
- **Not metered.** This spending does not appear in the app's own usage figures, because
  it is charged to the OpenAI key rather than to a customer.

## Removing it

Delete these three folders. Nothing else in the app imports them, and a test enforces
that:

```
src/experimental/
src/app/experimental/
src/app/api/experimental/
```

Then remove `OPENAI_API_KEY` from Vercel. No package was added, so `package.json` and the
lockfile need no changes.

## How it fits together

| File                                                | What it does                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| `src/experimental/openai-voice/catalogue.ts`        | Models, voices, sample lines, styles, test sentences, limits.        |
| `src/experimental/openai-voice/validate.ts`         | What the routes accept, and the word-accuracy score. Tested.         |
| `src/experimental/openai-voice/openai.ts`           | The only file that calls OpenAI. Plain `fetch`, no SDK.              |
| `src/experimental/openai-voice/VoiceSamples.tsx`    | Section 1 of the page.                                               |
| `src/experimental/openai-voice/SpeechToText.tsx`    | Section 2 of the page.                                               |
| `src/experimental/openai-voice/pcm-stream.ts`       | Plays audio as it arrives, so timings are what a trainee would hear. |
| `src/experimental/openai-voice/useRecorder.ts`      | Records one utterance from the microphone.                           |
| `src/app/experimental/openai-voice/page.tsx`        | The page, behind sign-in.                                            |
| `src/app/api/experimental/openai-voice/speech/`     | Text to speech, returning raw PCM.                                   |
| `src/app/api/experimental/openai-voice/transcribe/` | Speech to text, one model per request.                               |

It borrows three things from the app, without changing them: the sign-in guard, the
header, and the current voice samples (`/api/voices/sample`), used for the comparison.

## If the team approves

Moving the trainer to OpenAI voices would be a change in `src/lib/voice/catalogue.ts` and
`src/lib/voice/synthesise.ts`, which were built to be the only provider-specific files.
OpenAI's `pcm` output is 24 kHz 16-bit mono, which is the format the app already plays,
so the session screen would not need to change. Speech to text would be a separate change
to `src/hooks/useSpeechInput.ts` and `/api/stt`.
