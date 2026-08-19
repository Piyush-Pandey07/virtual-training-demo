'use client';

import { TRAINER_NAME } from '@/lib/trainer';
import type { SttTransport } from '@/hooks/useSpeechInput';
import type { MicState, SessionPhase } from '@/lib/types';

/** Plain-language status line, so the trainee always knows whose turn it is. */
function statusFor(
  phase: SessionPhase,
  micState: MicState,
  transcribing: boolean,
): { label: string; tone: string } {
  if (phase === 'error') return { label: 'Something went wrong', tone: 'text-logo-red' };
  // Batch transport only. Worth showing, because the transcript lands a beat
  // after the trainee stops rather than appearing as they speak.
  if (transcribing) return { label: 'Getting that down', tone: 'text-teal' };
  if (phase === 'connecting') return { label: 'Connecting', tone: 'text-muted' };
  if (phase === 'thinking') return { label: 'Thinking', tone: 'text-teal' };
  if (phase === 'speaking') return { label: `${TRAINER_NAME} is speaking`, tone: 'text-teal' };
  if (phase === 'ended') return { label: 'Session complete', tone: 'text-muted' };
  if (phase === 'listening') {
    if (micState === 'live') return { label: 'Listening, go ahead', tone: 'text-azure-bright' };
    if (micState === 'denied') return { label: 'Microphone blocked', tone: 'text-logo-red' };
    return { label: 'Your turn', tone: 'text-muted' };
  }
  return { label: 'Ready', tone: 'text-muted' };
}

interface TrainerPanelProps {
  phase: SessionPhase;
  micState: MicState;
  micLevel: number;
  speaking: boolean;
  transcribing: boolean;
  transport: SttTransport | null;
}

/**
 * The trainer's presence: an avatar that reacts while speaking, the current
 * status, and a live microphone level so the trainee can see they are being
 * heard before they say anything important.
 */
export function TrainerPanel({
  phase,
  micState,
  micLevel,
  speaking,
  transcribing,
  transport,
}: TrainerPanelProps) {
  const status = statusFor(phase, micState, transcribing);
  const listening = phase === 'listening' && micState === 'live';

  return (
    <section className="border-charcoal-line bg-charcoal-soft flex items-center gap-4 rounded-xl border p-4">
      <div className="relative grid h-14 w-14 shrink-0 place-items-center">
        {speaking && (
          <>
            <span className="ring-out border-teal absolute inset-0 rounded-full border-2" />
            <span className="ring-out-delayed border-teal absolute inset-0 rounded-full border-2" />
          </>
        )}
        <span
          className={`relative grid h-12 w-12 place-items-center rounded-full text-lg font-bold transition-colors ${
            speaking ? 'bg-teal text-charcoal' : 'bg-azure text-mist'
          }`}
        >
          {TRAINER_NAME.charAt(0)}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-mist text-sm font-semibold">
          {TRAINER_NAME}
          <span className="text-muted ml-2 font-normal">Information security trainer</span>
        </p>

        <p className={`mt-0.5 flex items-center gap-1.5 text-sm ${status.tone}`}>
          {status.label}
          {(phase === 'thinking' || transcribing) && (
            <span className="dot-pulse inline-flex gap-0.5" aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          )}
        </p>

        {/* Microphone level. Only meaningful while the trainee has the floor. */}
        <div
          className="bg-charcoal mt-2 h-1 w-full overflow-hidden rounded-full"
          role="meter"
          aria-label="Microphone level"
          aria-valuenow={Math.round(micLevel * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-75 ${
              listening ? 'bg-azure-bright' : 'bg-charcoal-line'
            }`}
            style={{ width: `${Math.min(100, Math.round(micLevel * 100))}%` }}
          />
        </div>

        {transport === 'batch' && (
          <p className="text-muted mt-1.5 text-xs">
            Pause briefly when you finish speaking, then your question is sent across.
          </p>
        )}
      </div>
    </section>
  );
}
