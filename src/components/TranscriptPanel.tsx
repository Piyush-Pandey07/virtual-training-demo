'use client';

import { useEffect, useRef } from 'react';

import { TRAINER_NAME } from '@/lib/trainer';
import type { TranscriptEntry } from '@/lib/types';

interface TranscriptPanelProps {
  entries: TranscriptEntry[];
  /** Trainer text still streaming in, shown before it is committed. */
  streamingReply: string;
  /** Live partial transcript of the trainee. */
  interim: string;
}

function Bubble({ entry }: { entry: TranscriptEntry }) {
  const isTrainer = entry.speaker === 'trainer';
  return (
    <li className={`flex ${isTrainer ? 'justify-start' : 'justify-end'}`}>
      <div className="max-w-[88%]">
        <p
          className={`mb-1 text-[11px] font-semibold tracking-wide uppercase ${
            isTrainer ? 'text-teal' : 'text-muted'
          } ${isTrainer ? 'text-left' : 'text-right'}`}
        >
          {isTrainer ? TRAINER_NAME : 'You'}
          <span className="text-muted ml-2 font-normal tracking-normal normal-case">
            slide {entry.slideId}
          </span>
        </p>
        <div
          className={`rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
            isTrainer
              ? 'bg-charcoal-soft text-mist'
              : 'bg-azure/20 text-mist ring-azure/40 ring-1 ring-inset'
          }`}
        >
          {entry.text}
        </div>
      </div>
    </li>
  );
}

/**
 * The running transcript. Auto-scrolls, but only while the trainee is already at
 * the bottom, so scrolling back to reread something is not yanked away.
 */
export function TranscriptPanel({ entries, streamingReply, interim }: TranscriptPanelProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  useEffect(() => {
    const el = scrollerRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [entries, streamingReply, interim]);

  const empty = entries.length === 0 && !streamingReply && !interim;

  return (
    <div className="border-charcoal-line bg-charcoal flex min-h-0 flex-1 flex-col rounded-xl border">
      <div className="border-charcoal-line border-b px-4 py-2.5">
        <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">Transcript</h2>
      </div>

      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {empty ? (
          <p className="text-muted py-8 text-center text-sm">
            The conversation will appear here as it happens.
          </p>
        ) : (
          <ul className="space-y-3.5">
            {entries.map((entry) => (
              <Bubble key={entry.id} entry={entry} />
            ))}

            {/* Trainer reply mid-stream. Replaced by a committed bubble on completion. */}
            {streamingReply && (
              <li className="flex justify-start">
                <div className="max-w-[88%]">
                  <p className="text-teal mb-1 text-left text-[11px] font-semibold tracking-wide uppercase">
                    {TRAINER_NAME}
                  </p>
                  <div className="bg-charcoal-soft text-mist rounded-xl px-3.5 py-2.5 text-sm leading-relaxed">
                    {streamingReply}
                  </div>
                </div>
              </li>
            )}

            {/* Live caption of what the trainee is saying right now. */}
            {interim && (
              <li className="flex justify-end">
                <div className="max-w-[88%]">
                  <p className="text-muted mb-1 text-right text-[11px] font-semibold tracking-wide uppercase">
                    You
                  </p>
                  <div className="border-azure/50 text-muted rounded-xl border border-dashed px-3.5 py-2.5 text-sm leading-relaxed italic">
                    {interim}
                  </div>
                </div>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
