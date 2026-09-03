import { OPEN_SESSION_MINUTES, type OpenSession } from '@/lib/platform/overview';

/**
 * Sessions open across every customer, right now.
 *
 * The first question anybody opens this screen to answer. It is deliberately at the
 * top and deliberately small: who, which company, which deck, how far in. Not what
 * they asked, and not what the trainer said back -- support needing to know a session
 * exists is not support needing to read it.
 */

type Row = OpenSession & { customer: string };

/** "4 minutes ago", which is what matters here rather than a clock time. */
function ago(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 90) return 'just now';
  return `${Math.round(seconds / 60)} min ago`;
}

export function HappeningNow({ sessions }: { sessions: Row[] }) {
  return (
    <section className="border-charcoal-line mt-10 rounded-xl border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">
          {sessions.length === 0
            ? 'Nothing running'
            : `${sessions.length} session${sessions.length === 1 ? '' : 's'} in progress`}
        </h2>
        <p className="text-muted text-xs">active in the last {OPEN_SESSION_MINUTES} minutes</p>
      </div>

      {sessions.length === 0 ? (
        <p className="text-muted mt-2 text-sm leading-relaxed">
          Nobody is part-way through a session at any customer. A session shows here while it is
          being attended and drops off {OPEN_SESSION_MINUTES} minutes after the last slide it
          recorded — nothing tells the server that a trainee closed the tab, so this is the most
          that can honestly be said.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {sessions.map((session) => (
            <li
              key={`${session.customer}-${session.personEmail}-${session.deckId}`}
              className="border-charcoal-line bg-charcoal-soft flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-3 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{session.personName}</span>
                <span className="text-muted"> · {session.customer}</span>
                <span className="text-muted block truncate text-xs">
                  {session.deckTitle ?? session.deckId} · started {ago(session.startedAt)}
                </span>
              </span>
              <span className="text-teal shrink-0 text-xs font-semibold tabular-nums">
                {session.percent}%
              </span>
              <span className="text-muted shrink-0 text-xs tabular-nums">
                {ago(session.lastSeenAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
