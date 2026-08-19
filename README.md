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
| Teaches rather than reads out  | Each slide carries a teaching brief and a list of points the trainer must cover, written from the slide text and the presenter notes.       |
| Interrupt any time            | Speech detected while the trainer is talking stops playback within a chunk, aborts the generation in flight, and hands the floor over.       |
| Answers stay grounded         | The whole deck goes into the prompt. The trainer is told to say when something is outside the deck rather than inventing Technavious policy.  |
| Follows the trainee's pace    | Nothing advances on a timer. A question is answered and the floor returns to the trainee.                                                    |
| Moves the deck when it should | The model has a `navigate_to_slide` tool, so asking about classification while on slide 2 brings slide 5 up before the answer.               |
| Works without a microphone    | If mic access is blocked, the session still runs and questions can be typed.                                                                 |

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
- **`DEEPGRAM_API_KEY`** from the [Deepgram console](https://console.deepgram.com). It needs at
  least **Member** permissions, because the server uses it to mint short-lived browser tokens.

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
| `GEMINI_MODEL`               | `gemini-2.5-flash`   | Flash keeps time to first word low, which matters more than depth here.           |
| `DEEPGRAM_STT_MODEL`         | `nova-3`             | Live transcription model.                                                          |
| `DEEPGRAM_TTS_MODEL`         | `aura-2-thalia-en`   | Any Aura voice. See the [voice list](https://developers.deepgram.com/docs/tts-models). |
| `DEEPGRAM_TOKEN_TTL_SECONDS` | `300`                | Lifetime of the browser token. Only needs to outlive the initial handshake.        |

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

Both API keys stay on the server. The browser talks to Deepgram directly for transcription, but only
with a short-lived token minted by `/api/deepgram/token`, because routing live audio through the
server would add latency for no benefit.

### Why raw PCM for playback

Text to speech comes back as headerless 16-bit PCM rather than MP3. No decode step means playback
starts sooner, and because every chunk sits on one shared `AudioContext` timeline, sentences join
without a gap and an interruption can cut playback off at an exact point.

### Why sentence chunking

Waiting for a full Gemini reply before speaking would add several seconds of silence to every turn.
Text is cut at sentence boundaries as it streams and each fragment is synthesised immediately, so the
trainer starts talking while the rest is still being written.

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
    api/deepgram/    Short-lived browser token
  components/        Slide stage, trainer panel, transcript, controls
  hooks/
    useDeepgramStt   Microphone, worklet, and transcription socket
    useTtsPlayer     Sentence chunking, playback queue, barge-in
    useTrainingSession  The session state machine
  lib/
    deck.ts          Deck content and teaching briefs
    trainer-prompt.ts   System instruction and per-turn prompts
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
npm run typecheck
npm run lint
npm run format:check
npm run build
```

---

## Known limits

- Speech to text is English only, set by the `language=en` parameter on the transcription socket.
- Barge-in needs two or more transcribed words before it fires, so a single word interjection such as
  "wait" will not stop the trainer. Push to talk is the reliable route in a noisy room.
- Conversation history sent to the model is capped at the last 24 turns, so a very long session will
  lose the earliest exchanges from context. The slide content is always present.
- Session state lives in memory. A page refresh starts over.
