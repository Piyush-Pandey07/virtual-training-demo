# Virtual Training Demo

An AI trainer that delivers Technavious's ISO 27001 ISMS awareness deck as a live one to one
session. It speaks, it listens, and it answers questions out loud. The trainee can interrupt
mid-sentence, ask for anything to be explained again, jump to any slide, or ask to be tested.

Gemini does the teaching and the question answering. Deepgram does both speech to text and text to
speech.

---

## What it actually does

| Behaviour                     | How it works                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Teaches rather than reads out  | A 22-topic knowledge base of ISO 27001 expertise sits behind the deck: attack mechanics, worked sector examples, misconceptions, and clause references.  |
| Interrupt any time            | Speech detected while the trainer is talking stops playback within a chunk, aborts the generation in flight, and hands the floor over.       |
| Answers stay grounded         | The deck is the authority on Technavious policy, the knowledge base is general expertise, and the trainer says which is which. Each topic records what it must not guess at. |
| Corrects the misconception    | Topics carry the wrong beliefs trainees arrive with. "I would spot a phishing email" gets the belief addressed, not just the question. |
| Adapts to the person          | Asking to simplify, to go deeper, for an example, or for the clause each produce a genuinely different reply, and the preference persists across the session. |
| Warm without going soft       | Encouraging and patient in manner, and unmoved on the facts. A wrong belief still gets corrected, just with the reasoning behind it acknowledged first. |
| Follows the trainee's pace    | Nothing advances on a timer. A question is answered and the floor returns to the trainee.                                                    |
| Moves the deck when it should | Asking about classification while on slide 2 brings slide 5 up before the answer. The target is worked out from the knowledge base, not asked of the model. |
| Understands being told to move on | "Please move to the next topic" advances and teaches. It is not answered as though it were a question. |
| Opens by naming the session   | The first sentence welcomes the trainee to the virtual training session and names its subject, before the trainer introduces itself. |
| Works without a microphone    | If mic access is blocked, the session still runs and questions can be typed.                                                                 |
| Answers stay short            | Follow-ups are budgeted by register, from 65 words for "simpler" up to 170 for "go deeper", so a question gets an answer rather than a lecture. |

---

## Setup

Requires Node 20 or newer.

```bash
npm install
```

Copy the example environment file and fill in your own keys:

```bash
cp .env.example .env.local
```

You need two keys:

- **`GEMINI_API_KEY`** from [Google AI Studio](https://aistudio.google.com/apikey).
- **`DEEPGRAM_API_KEY`** from the [Deepgram console](https://console.deepgram.com). A plain speech
  key is enough to run the demo. Give it **Member** permissions if you want the better of the two
  speech to text transports; see [Speech to text transports](#speech-to-text-transports) below.

Then:

```bash
npm run dev
```

Open http://localhost:3000.

> Headphones are recommended. On speakers, the trainer's own voice can carry into the microphone and
> get transcribed. Browser echo cancellation is enabled and there is a word-count threshold before a
> barge-in registers, but headphones remove the problem outright. There is also a push to talk mode
> for noisy rooms.

### Optional settings

| Variable                     | Default              | Notes                                                                             |
| ---------------------------- | -------------------- | --------------------------------------------------------------------------------- |
| `GEMINI_MODEL`               | `gemini-2.5-flash`   | 3.7-flash was tried and reverted: it narrates in stubs for no latency gain.       |
| `DEEPGRAM_STT_MODEL`         | `nova-3`             | Live transcription model.                                                          |
| `DEEPGRAM_TTS_MODEL`         | `aura-2-thalia-en`   | Any Aura voice. See the [voice list](https://developers.deepgram.com/docs/tts-models). |
| `DEEPGRAM_TOKEN_TTL_SECONDS` | `300`                | Lifetime of the browser token. Only needs to outlive the initial handshake.        |

---

## Deploying to Vercel

Import the repository at [vercel.com/new](https://vercel.com/new). Next.js is detected
automatically, so the build settings need no changes.

Set two environment variables under **Settings → Environment Variables**, for Production, Preview and
Development:

| Variable | Value |
| --- | --- |
| `GEMINI_API_KEY` | Your Google AI Studio key |
| `DEEPGRAM_API_KEY` | Your Deepgram key |

Nothing else is required. Every other setting has a default in `src/lib/config.ts`, which is
deliberate: one source of truth beats a dashboard that quietly disagrees with the code.

Then deploy and open `/api/health`:

```bash
curl https://your-deployment.vercel.app/api/health
```

`{"ready": true, "missing": []}` means the variables landed. It also reports which models are live,
which is how to confirm what is actually deployed. It returns no key material and makes no upstream
calls, so it is safe to leave public. The session lobby calls it on load and blocks the start button
with a plain explanation if something is missing, rather than letting a trainee grant microphone
access and then hit an error.

### What was configured for Vercel, and why

**Function durations.** Vercel's default function timeout is 10 seconds. Narration takes 9 to 10
seconds on the densest slides, so the default would truncate a turn mid-sentence, and a stream cannot
outlive the function producing it. `/api/chat` is set to 60 seconds, which is the Hobby plan ceiling.
The other routes are set lower, in each route file next to the code they govern.

**Request body size.** A non-streaming Vercel function cannot accept a body over 4.5 MB. `/api/stt`
posts raw audio, so its cap is 60 seconds of 16 kHz mono PCM, about 1.9 MB. The browser's own voice
activity detector stops an utterance at 30 seconds, so that is already double what should ever arrive.

**Deployment size.** `.vercelignore` keeps `docs/` out, which is about 5 MB of source PowerPoint that
the app never serves.

**Node version.** `engines` pins Node 20 or newer, which Next 16 requires.

### Things worth knowing before the demo

- **HTTPS is required** for microphone access, which Vercel provides. It will not work over plain
  HTTP on a custom setup.
- **Cold starts** add a second or two to the first turn after a period of inactivity. Loading the
  session page early warms it, since the lobby's health check hits the same deployment.
- **Region** is left at your team default. For an audience in India, `bom1` shortens the browser
  round trip, though Gemini and Deepgram are reached from the function either way, so the gain is
  partial. Worth measuring rather than assuming.
- **Live transcription does not go through Vercel.** The browser opens its socket straight to
  Deepgram, so that path is unaffected by function limits. See
  [Speech to text transports](#speech-to-text-transports).

---

## How it fits together

```
Browser                                  Server                        Upstream
───────────────────────────────────────  ───────────────────────────   ─────────────────
mic ─► AudioWorklet ─► 16 kHz PCM ──────────────────────────────────►  Deepgram Listen
                                                                        (direct WebSocket)
        transcript ◄───────────────────────────────────────────────────┘
             │
             ▼
      useTrainingSession ──► POST /api/chat ──────────────────────────►  Gemini
             │                (SSE: text deltas + nav events)
             ▼
      sentence chunks ─────► POST /api/tts ───────────────────────────►  Deepgram Speak
             │                (raw 16-bit PCM back)
             ▼
      Web Audio queue ─► speakers
```

Both API keys stay on the server, on either transport.

### Speech to text transports

The app picks one automatically when the session starts, by asking the server for a browser token.

**`stream`**, used when the key can mint tokens. The browser opens a WebSocket straight to Deepgram
with a short-lived token from `/api/deepgram/token`. Live partial transcripts appear as the trainee
speaks, and barge-in triggers off the transcript. This is the better experience, and needs a key with
**Member** permissions, because `/v1/auth/grant` is a management operation.

**`batch`**, the fallback when token minting returns a permissions error. The browser runs a small
energy-based voice activity detector (onset count, pre-roll ring, silence hangover), buffers the
utterance locally, and posts the PCM to `/api/stt`. No live captions, and the transcript lands a beat
after the trainee stops speaking, but it needs no permission beyond speech itself.

The key is never sent to the browser on either path. If your key cannot mint tokens, the alternative
would be exposing a full-power speech key to every page load, which is why the batch route exists.

You can tell which one is live: batch mode shows a short note under the microphone level, and the
status line reads "Getting that down" while an utterance is being transcribed.

### Why raw PCM for playback

Text to speech comes back as headerless 16-bit PCM rather than MP3. No decode step means playback
starts sooner, and because every chunk sits on one shared `AudioContext` timeline, sentences join
without a gap and an interruption can cut playback off at an exact point.

### Why sentence chunking

Waiting for a full Gemini reply before speaking would add several seconds of silence to every turn.
Text is cut at sentence boundaries as it streams and each fragment is synthesised immediately, so the
trainer starts talking while the rest is still being written.

---

## The knowledge base

`src/lib/deck.ts` is what is on screen. `src/lib/knowledge/` is what the trainer knows. Keeping them
apart is what stops the trainer either reciting the slide or inventing policy.

Twenty-two topics across five modules: `foundations` (what an ISMS is, how the standard is built, the
CIA triad), `threats` (the six on slide 2, in mechanism-level detail), `classification`, `policies`
(all eight, with what each asks of a person on an ordinary day), and `incidents`.

Every topic has the same shape:

| Field | What it carries |
| --- | --- |
| `explanation` | The substance, one idea per entry, written to be spoken. |
| `examples` | Worked illustrations from data centre consultancy: single-line diagrams, TVRA reports, commissioning records, client sites. |
| `misconceptions` | The wrong belief, and the correction. The trainer addresses the belief rather than answering around it. |
| `standardRefs` | ISO/IEC 27001:2022 clause and Annex A control references, for trainees who want the clause. |
| `analogy` | One comparison that makes an abstract control land. |
| `faqs` | Questions trainees genuinely ask, with the expert answer. |
| `outOfScope` | What this deck does not settle. The trainer names the gap and points at the controlled document instead of guessing. |
| `triggers` | Phrases that pull the topic in when a question reaches for it. |

### Selection

Sending all 92,000 characters every turn would dilute attention as well as costing latency, so
`selectKnowledge` assembles each turn:

- **Narration:** every topic on the slide, at full depth. The job is to teach the whole slide.
- **A question:** the slide's topics compete on relevance. The ones the question reaches for stay at
  full depth, the rest are demoted to a compact form, and up to three topics from elsewhere in the
  deck are pulled in. Asking about phishing on slide 2 loads the phishing topic at depth and the other
  five threats compactly, which cuts that prompt from 27k to 19k characters and stops the answer being
  buried under material about passwords.
- **Recap or quiz:** the whole base, compactly, because those turns range over everything.

### Answer register

`detectAnswerStyle` reads what shape of answer was asked for, and the prompt changes accordingly.
"I am a bit lost" drops all jargon and shortens; "which Annex A control" gives the reference and
then translates it; "go deeper" gives the mechanism. The preference is remembered in a `LearnerProfile`
that also tracks which slides drew questions, so the trainer weights later examples towards what this
person actually cares about.

### Manner

The trainer is warm, patient and encouraging. That is a real requirement rather than a coat of paint,
because security awareness training that reads as finger-wagging gets ignored, and a trainee who feels
judged stops asking.

The risk in asking a model to be soft is that it starts agreeing with things to seem agreeable, which
would destroy the most useful thing this trainer does. So the persona is explicit that kindness and
accuracy are not in tension: a mistaken belief is still corrected, the red line about personal
accounts is still a red line, and "I don't know" is still said out loud. What changes is the route
there. Almost every misconception in the knowledge base is held for a sensible reason, so the trainer
names that reason first and then moves them on, which is both gentler and more persuasive than a flat
contradiction.

There is separate guidance for the moment a trainee attempts an answer, since that is where confidence
is won or lost. Right answers get confirmed without hedging, partly right answers lead with the part
that was right, and wrong answers get corrected plainly rather than left standing to spare feelings.

One instruction earned its place by trial: warmth is not length. "Warm and unhurried" read as licence
to run long and pushed narration to 60% over budget, so the persona now says that brevity is part of
the kindness, because it leaves room for the trainee to speak.

### No transcript

The session shows the slide, the trainer's presence and the controls. There is no scrolling
conversation log, because it made the page read as a chat window rather than a training session.

The transcript still exists in state and is still what the model receives as history; only the display
is gone. What survived is the live caption under the trainer's status, since with the log removed that
is the only signal that speech was heard correctly, and speech to text does mishear the occasional
term. Without it, a garbled question looks like the trainer misunderstood.

Removing the display also let `streamingReply` go, which was calling `setState` on every token with
nothing rendering the result.

### Slide transitions

Every slide is mounted once and revealed by opacity. Keying a single image on the slide id unmounted
and remounted it on every change, which restarted the loader and showed a blank frame between slides.
It was most obvious going backwards, where the trainee expects an instant cut to something already
seen.

The images are also loaded eagerly rather than lazily. Being in the viewport at zero opacity is not
enough to make the lazy loader fetch them, so only two of seven were ever decoded and the first jump to
slide 3 still flashed. The whole deck is about 600 kB and is needed within one session anyway.

Navigation stays enabled while a turn is generating. It used to be locked for the ten seconds a
narration takes, so pressing Next mid-generation did nothing and the controls felt broken. Moving the
deck already interrupts playback and aborts the request in flight, and turns carry a sequence token so
a superseded one cannot alter state.

### Answer length

Answers are budgeted per register: 65 words when asked to simplify, 70 by default, 95 for an example or
a clause reference, 170 when explicitly asked to go deeper. The answer turn previously had no length
instruction at all, only narration did, so follow-ups ran to 250 words, which is a minute and a half of
speech for one question.

The prompt also bans opening with praise for the question. Three consecutive answers began "That is a
really good question", which is warm once in a session and filler every turn. Answers now lead with the
answer: "Yes, you absolutely do report that."

### The opening

Slide 1 requires a specific first sentence: a welcome to the virtual training session naming what the
session is on, before the trainer introduces itself. The wording is left to the model but both parts
are mandatory, set in slide 1's `narrationBrief` and reinforced in the turn task.

The subject is taken from `DECK_SUBJECT_SPOKEN`, not `DECK_SUBTITLE`. The formal subtitle reads
"ISO/IEC 27001", which the speech engine renders as "ISO IEC" and is not how anyone introduces a
session out loud. The spoken form drops the slash. The written subtitle is still used on the page.

### Length

Three things hold narration near its budget, and the third turned out to matter most.

Narration is budgeted in words rather than seconds, because a model can count words and has no
reliable sense of duration. `spokenWordBudget` converts each slide's `targetSeconds` at 150 words per
minute. In testing this moved narration from roughly 200% of target down to within about 25 to 45%,
and it is what stops the eight-policy slide being read out as an eight-item list. Narration also runs
at a lower temperature than question answering, since it is fully briefed and variation only costs
length discipline.

The one that moved the needle furthest was neither: it was giving the model less to say. Slide 2
carries seven topics and 27,000 characters of expertise, and the model uses what it is given however
the prompt is worded. Each topic now declares a `narrationPriority`, only the top few go in at depth,
and the rest ride along compactly for the trainee who asks. Slide 2's brief says spend the time on
spear phishing and passwords, so those are the two that survive the cap. Nothing is lost from the
trainee's side, because the slide's own key points still name all six threats.

---

## Layout

```
public/
  slides/            Slide renders exported from the source deck
  brand/             Official Technavious logo artwork
  worklets/          Microphone capture worklet
src/
  app/
    page.tsx         Landing page and session outline
    session/         The training room
    api/chat/        Gemini turn, streamed as server sent events
    api/tts/         Deepgram Aura proxy
    api/stt/         Deepgram batch transcription, fallback transport
    api/deepgram/    Short-lived browser token
  components/        Slide stage, trainer panel, transcript, controls
  hooks/
    useMicCapture    Microphone, AudioContext, and capture worklet
    useSpeechInput   Transport selection, transcription socket, batch VAD
    useTtsPlayer     Sentence chunking, playback queue, barge-in
    useTrainingSession  The session state machine
  lib/
    deck.ts          What is on the slides, and the teaching brief for each
    knowledge/       What the trainer knows: 22 topics across 5 modules
    intent.ts        Advance, back, repeat or question
    trainer-prompt.ts   System instruction, per-turn prompts, answer register
docs/
  ISMS-Awareness-Session.pptx   The source deck
```

---

## The deck content

`src/lib/deck.ts` is the single source of truth for what the trainer teaches. Each slide has:

- `bullets` and `title`, reproducing what is printed on the slide.
- `speakerNotes`, the presenter notes that are genuine teaching content.
- `internalNotes`, notes the author wrote to themselves. **Never sent to the model.** Two slides in
  the source deck carry a note about promoting a third-party platform, which a trainer reading notes
  aloud would have repeated to the trainee.
- `narrationBrief` and `keyPoints`, the teaching instructions.

To swap in a different deck: export the slides as images into `public/slides/`, then rewrite
`SLIDES`. Nothing else needs to change.

### Note on the source deck

Slide 2 of the original PowerPoint contains two empty rectangles positioned off the content area, one
of which renders as a black bar along the bottom edge. They were removed from the exported image
only. The file in `docs/` is untouched.

---

## Checks

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

72 tests, on Node's built-in runner via tsx, no framework. They cover the parts that
have actually had bugs:

- **`src/lib/intent.test.ts`** pins every phrasing that has broken a session or was
  observed in one, including the negations that used to advance the deck when the
  trainee said the opposite.
- **`src/lib/knowledge/knowledge.test.ts`** checks base integrity (unique ids, no
  slide without expertise, no topic that can never be retrieved) and every
  navigation decision.
- **`src/lib/source-hygiene.test.ts`** fails on control characters in source. A regex
  written through a shell heredoc had its escapes processed twice, so `` became a
  literal backspace byte. The file looked right, TypeScript compiled it, and the
  pattern silently never matched. Nothing else in the toolchain catches that.

---

## Intent, and why navigation is not a tool

Two things here were fixed the hard way, and both are worth knowing before changing them back.

### Reading the trainee's intent

`src/lib/intent.ts` classifies every utterance as `advance`, `back`, `repeat` or `question` before
anything else happens. It exists because "please move to the next topic" was originally treated as a
question. The trainer answered it correctly ("right, let's move on"), the deck advanced, and nothing
ever taught the new slide. The session looked hung when it had done exactly what it was told.

A question mark, or any question wording, always wins over a navigational reading, because mistaking
a question for a nudge silently drops what the trainee wanted to know. Filler is stripped before
matching, but the raw form is matched too: "no questions" strips to "questions", since "no" is also a
filler word. Typed input goes through the same routing, so typing "next slide" does what saying it
does.

### Navigation is decided on the server, not by the model

The model used to have a `navigate_to_slide` tool. Gemini does not emit speech in the same turn as a
function call: it returns the call and stops. The obvious repair is to hand back a `functionResponse`
and continue, but the original "answer the question" framing stays in context and the model treats the
tool call as having dealt with the request, replying with an acknowledgement and no teaching. Roughly
one turn in four. Rebuilding the turn from scratch against the new slide got that to one in five,
because the model sometimes emits a short deferral *alongside* the call, which meant the rebuild never
triggered. Strengthening the prompt made it worse: listing forbidden phrases primed the model to use
them, and 4 of 4 runs deferred.

So the tool is gone. `bestSlideForQuestion` scores the question against every topic's triggers and
returns the slide that beats the current one by a margin. The route emits the `nav` event before
generation starts and builds the answer prompt against that slide, so as far as the model is
concerned the trainee asked about the slide already showing, and there is nothing to defer to.

The result is one pass instead of two, deterministic and unit-testable, and it halved latency on
navigating answers from about 4 to 6 seconds down to 2.5 to 3.8. Six consecutive runs of the case that
used to fail now teach all four classification tiers.

One detail worth recording: topic triggers include stems such as `classif` and `tailgat`, so matching
is by word prefix for single-word triggers and by phrase for multi-word ones. Whole-word matching made
every stem trigger in the base dead, and a question about classification scored zero against the
classification topic.

## Known limits

- Speech to text is English only, set by the `language=en` parameter on the transcription socket.
- Barge-in behaviour differs by transport. On `stream` it needs two or more transcribed words, so a
  single word interjection such as "wait" will not stop the trainer. On `batch` it fires on sustained
  energy, which is faster but will also trigger on a loud noise. Push to talk is the reliable route in
  a noisy room either way.
- The `batch` transport has no live partial transcript, because there is nothing to show until the
  utterance has been sent and transcribed.
- Conversation history sent to the model is capped at the last 24 turns, so a very long session will
  lose the earliest exchanges from context. The slide content is always present.
- Session state lives in memory. A page refresh starts over.
- Interrupting the trainer while a turn is still generating can put the transcript
  slightly out of order, because a reply is committed when it finishes rather than
  when it starts. What was said is right; the ordering can read oddly.
- On the streaming transport the socket opens just after the microphone does, so the
  first fraction of a second is dropped if the trainee starts talking instantly.
- Narration length still runs over target on the three densest slides, 2, 4 and 5, by 43 to 51%. Three
  separate levers brought this down from 200%: a word budget, a lower temperature for narration, and
  capping how many topics go in at depth. It is not pinned, and prompt wording has stopped helping.
  The levers left are `targetSeconds` in `deck.ts` and `MAX_CORE_ON_NARRATION` in the knowledge module.
  The content is good; those slides simply have more worth saying than fits.
- The knowledge base is hand-written rather than retrieved from a document store, and topic selection
  is lexical rather than semantic. A question phrased with none of a topic's `triggers` will not pull
  it in, though the slide's own topics and the full deck text are always present.
- Slide navigation is lexical for the same reason, so an unusually phrased question may leave the deck
  where it is. The answer is still correct, because the full deck is always in the prompt; only the
  slide on screen is wrong. Adding a trigger to the relevant topic is the fix.
