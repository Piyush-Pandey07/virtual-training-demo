'use client';

/**
 * The facilitator's screen in a trainer-led session (AI-01, AI-02, AI-08, AI-09).
 *
 * The facilitator runs the room and the deck. The trainer is silent until they hand
 * over, does only what it was handed (greet the group, explain the slide, answer a
 * question they relay, or ask an engagement question), and stops the moment they take
 * back control. The microphone is open only while the facilitator is asking the trainer
 * something, so nothing anybody else says in the room can set it off.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { SlideRail } from '@/components/SlideRail';
import { SlideStage } from '@/components/SlideStage';
import { useSpeechInput } from '@/hooks/useSpeechInput';
import { useTtsPlayer } from '@/hooks/useTtsPlayer';
import { getClientSlide } from '@/lib/deck';
import { useDeck } from '@/lib/deck-context';
import { FAILURE_MESSAGES, describeFailure, readFailure } from '@/lib/failures/codes';
import { TRAINER_NAME } from '@/lib/trainer';
import type { ChatEvent, HistoryTurn } from '@/lib/types';

type Turn = 'explain' | 'answer' | 'greet' | 'engage';
type Floor = 'facilitator' | 'listening' | 'thinking' | 'speaking';

interface Props {
  sessionId: string;
  attendees: string[];
}

const PRIMARY =
  'bg-azure text-mist hover:bg-teal hover:text-charcoal rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY =
  'ring-charcoal-line text-mist hover:ring-teal rounded-md px-4 py-2.5 text-sm font-semibold ring-1 transition-colors ring-inset disabled:cursor-not-allowed disabled:opacity-50';

const FLOOR_LABEL: Record<Floor, string> = {
  facilitator: 'You have the floor',
  listening: `${TRAINER_NAME} is listening to you`,
  thinking: `${TRAINER_NAME} is thinking`,
  speaking: `${TRAINER_NAME} is speaking`,
};

export function FacilitatorScreen({ sessionId, attendees }: Props) {
  const deck = useDeck();
  const [slideId, setSlideId] = useState(deck.slides[0]?.id ?? 1);
  const [floor, setFloor] = useState<Floor>('facilitator');
  const [askedBy, setAskedBy] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [greeted, setGreeted] = useState(false);

  const historyRef = useRef<HistoryTurn[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const slideRef = useRef(slideId);
  useEffect(() => {
    slideRef.current = slideId;
  }, [slideId]);

  const tts = useTtsPlayer({ deckId: deck.meta.id });
  const ttsRef = useRef(tts);
  useEffect(() => {
    ttsRef.current = tts;
  }, [tts]);

  /** Takes control back at once: the trainer stops mid-word and the microphone closes. */
  const takeBack = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    ttsRef.current.interrupt();
    sttRef.current?.stop();
    setFloor('facilitator');
  }, []);

  const handOver = useCallback(
    async (turn: Turn, question?: string) => {
      takeBack();
      setError(null);
      const controller = new AbortController();
      abortRef.current = controller;
      setFloor('thinking');
      await ttsRef.current.unlock();

      let spoken = '';
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deckId: deck.meta.id,
            kind: turn === 'answer' ? 'answer' : 'narrate',
            slideId: slideRef.current,
            history: historyRef.current,
            question,
            language: 'en',
            facilitated: { sessionId, turn, ...(askedBy ? { askedBy } : {}) },
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          setError(describeFailure(await readFailure(response)));
          setFloor('facilitator');
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          const frames = pending.split('\n\n');
          pending = frames.pop() ?? '';
          for (const frame of frames) {
            const line = frame.split('\n').find((entry) => entry.startsWith('data: '));
            if (!line) continue;
            const event = JSON.parse(line.slice(6)) as ChatEvent;
            if (event.type === 'text') {
              if (!spoken) setFloor('speaking');
              spoken += event.delta;
              ttsRef.current.push(event.delta);
            } else if (event.type === 'error') {
              setError(event.ref ? `${event.message} (Reference ${event.ref})` : event.message);
            }
          }
        }
        ttsRef.current.flush();
        await ttsRef.current.waitUntilDone();
      } catch (caught) {
        if ((caught as Error).name !== 'AbortError') setError(FAILURE_MESSAGES.connection);
      } finally {
        if (spoken.trim()) {
          historyRef.current = [
            ...historyRef.current,
            ...(question
              ? [{ speaker: 'trainee' as const, text: question, slideId: slideRef.current }]
              : []),
            { speaker: 'trainer' as const, text: spoken.trim(), slideId: slideRef.current },
          ].slice(-12);
        }
        if (abortRef.current === controller) {
          abortRef.current = null;
          setFloor('facilitator');
        }
      }
    },
    [askedBy, deck.meta.id, sessionId, takeBack],
  );

  const stt = useSpeechInput({
    // One question at a time: the microphone closes on the first thing heard, which is
    // the facilitator relaying it, and the trainer answers that.
    onUtterance: (text) => {
      sttRef.current?.stop();
      void handOver('answer', text);
    },
    onError: setError,
  });
  const sttRef = useRef<typeof stt | null>(null);
  useEffect(() => {
    sttRef.current = stt;
  }, [stt]);

  const listen = async () => {
    takeBack();
    await ttsRef.current.unlock();
    stt.setLanguage('en');
    stt.setKeyterms(deck.listenFor ?? []);
    setFloor('listening');
    await stt.start();
  };

  useEffect(() => () => takeBack(), [takeBack]);

  const slide = getClientSlide(deck, slideId);
  const index = deck.slides.findIndex((entry) => entry.id === slideId);
  const busy = floor !== 'facilitator';
  const move = (to: number | undefined) => {
    if (to === undefined) return;
    takeBack();
    setSlideId(to);
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div
          role="alert"
          className="border-logo-red/40 bg-logo-red/10 flex items-start gap-3 rounded-md border px-4 py-3"
        >
          <p className="text-mist flex-1 text-sm">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-muted hover:text-mist text-sm font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {slide && <SlideStage slide={slide} dimmed={false} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <SlideRail
            currentId={slideId}
            coveredIds={[]}
            onSelect={(id) => move(id)}
            disabled={false}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={SECONDARY}
              disabled={index <= 0}
              onClick={() => move(deck.slides[index - 1]?.id)}
            >
              Previous
            </button>
            <button
              type="button"
              className={SECONDARY}
              disabled={index >= deck.slides.length - 1}
              onClick={() => move(deck.slides[index + 1]?.id)}
            >
              Next slide
            </button>
          </div>
        </div>

        <section
          aria-labelledby="handover-heading"
          className="border-charcoal-line bg-charcoal-soft rounded-xl border p-4"
        >
          <h2 id="handover-heading" className="text-sm font-semibold">
            Hand over to {TRAINER_NAME}
          </h2>
          <p role="status" aria-live="polite" className="text-teal mt-1 text-sm">
            {FLOOR_LABEL[floor]}
          </p>

          {busy ? (
            <button type="button" onClick={takeBack} className={`${PRIMARY} mt-4 w-full`}>
              Take back control
            </button>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {!greeted && (
                <button
                  type="button"
                  className={PRIMARY}
                  onClick={() => {
                    setGreeted(true);
                    void handOver('greet');
                  }}
                >
                  Greet the group
                </button>
              )}
              <button type="button" className={PRIMARY} onClick={() => void handOver('explain')}>
                Explain this slide
              </button>
              <button type="button" className={SECONDARY} onClick={() => void handOver('engage')}>
                Ask the group an engagement question
              </button>
            </div>
          )}

          <div className="border-charcoal-line mt-5 border-t pt-4">
            <label htmlFor="asked-by" className="block text-sm font-semibold">
              Who asked?
            </label>
            <select
              id="asked-by"
              value={askedBy}
              onChange={(event) => setAskedBy(event.target.value)}
              className="bg-charcoal text-mist ring-charcoal-line mt-2 w-full rounded-md px-3 py-2 text-sm ring-1 ring-inset"
            >
              <option value="">The group</option>
              {attendees.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`${SECONDARY} mt-3 w-full`}
              disabled={busy}
              onClick={() => void listen()}
            >
              Say the question to {TRAINER_NAME}
            </button>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const question = typed.trim();
                if (!question) return;
                setTyped('');
                void handOver('answer', question);
              }}
            >
              <label htmlFor="typed-question" className="sr-only">
                Or type the question
              </label>
              <input
                id="typed-question"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Or type the question"
                className="bg-charcoal text-mist placeholder:text-muted ring-charcoal-line min-w-0 flex-1 rounded-md px-3 py-2 text-sm ring-1 ring-inset"
              />
              <button type="submit" className={SECONDARY} disabled={busy || !typed.trim()}>
                Ask
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
