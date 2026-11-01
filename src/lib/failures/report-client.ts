/**
 * Tells the developer log what went wrong in the browser.
 *
 * Browser-only. The failures behind "the voice kept dropping" happen on the trainee's
 * side of the connection and never reach our server, so the browser reports them itself
 * through /api/report. A report about a dropped connection usually cannot be sent while
 * the connection is down, so reports wait in memory and go once the browser says it is
 * back online, or on the next report that does get through.
 *
 * Best effort throughout. Nothing here may throw into the session or hold it up.
 */

import type { FailureCode } from './codes';

export type ReportArea = 'speech' | 'narration' | 'listening' | 'live-listening' | 'sample';

export interface BrowserReport {
  area: ReportArea;
  /** The finer kind, such as `timeout`, `network`, `http-503` or `recovered`. */
  kind: string;
  code: FailureCode;
  detail?: string;
  deckId?: string;
  language?: string;
}

/** Enough to cover a long outage; older reports are dropped first. */
const MAX_WAITING = 20;
const waiting: Array<BrowserReport & { page: string; network?: string }> = [];
let listening = false;

/**
 * What the browser knows about its connection, where it says.
 *
 * Chrome and Android expose an estimate; Safari and Firefox do not, and then this is
 * left out rather than guessed.
 */
function networkSummary(): string | undefined {
  const connection = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
    }
  ).connection;
  const parts = [navigator.onLine ? 'online' : 'offline'];
  if (connection?.effectiveType) parts.push(connection.effectiveType);
  if (typeof connection?.downlink === 'number') parts.push(`${connection.downlink} Mbps`);
  if (typeof connection?.rtt === 'number') parts.push(`${connection.rtt} ms rtt`);
  if (connection?.saveData) parts.push('data saver');
  return parts.join(', ');
}

async function send(report: (typeof waiting)[number]): Promise<boolean> {
  try {
    const response = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
    });
    // A refusal is final: asking again would be refused the same way.
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function flush(): Promise<void> {
  while (waiting.length > 0) {
    const next = waiting[0]!;
    if (!(await send(next))) return;
    waiting.shift();
  }
}

/** Queues a report and sends everything waiting as soon as it can. */
export function reportFailure(report: BrowserReport): void {
  if (typeof window === 'undefined') return;
  waiting.push({ ...report, page: window.location.pathname, network: networkSummary() });
  if (waiting.length > MAX_WAITING) waiting.splice(0, waiting.length - MAX_WAITING);

  if (!listening) {
    listening = true;
    window.addEventListener('online', () => void flush());
  }
  if (navigator.onLine) void flush();
}
