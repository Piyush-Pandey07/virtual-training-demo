import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { alertsFrom } from './alerts';
import type { DevLogEntry } from './devlog';

/**
 * What the administrator is told needs attention (AI-11): the failures that do not clear
 * on their own, by provider, with the latest time and how often.
 */

const entry = (overrides: Partial<DevLogEntry>): DevLogEntry => ({
  id: 'X',
  at: '2026-11-10T09:00:00.000Z',
  day: '2026-11-10',
  source: 'server',
  provider: 'sarvam',
  kind: 'out_of_credit',
  code: 'unavailable',
  detail: 'No credits available.',
  route: '/api/tts',
  repeats: 1,
  expireAt: new Date(),
  ...overrides,
});

describe('provider alerts for the administrator', () => {
  it('folds repeats into one alert per provider and kind, newest first', () => {
    const alerts = alertsFrom([
      entry({ at: '2026-11-10T09:00:00.000Z', repeats: 12 }),
      entry({ at: '2026-11-10T10:30:00.000Z', repeats: 3 }),
      entry({ provider: 'deepgram', kind: 'bad_key', at: '2026-11-09T18:00:00.000Z' }),
    ]);
    assert.deepEqual(alerts, [
      { provider: 'sarvam', kind: 'out_of_credit', lastAt: '2026-11-10T10:30:00.000Z', count: 15 },
      { provider: 'deepgram', kind: 'bad_key', lastAt: '2026-11-09T18:00:00.000Z', count: 1 },
    ]);
  });

  it('leaves out what clears on its own, and what the browser reported', () => {
    assert.deepEqual(
      alertsFrom([
        entry({ kind: 'rate_limited' }),
        entry({ kind: 'unreachable' }),
        entry({ source: 'browser', provider: 'speech', kind: 'network' }),
      ]),
      [],
    );
  });

  it('opens the developer log to every Technavious administrator', () => {
    const page = readFileSync('src/app/platform/errors/page.tsx', 'utf8');
    assert.match(page, /if \(!isAdministrator\(person\)\) notFound\(\);/);
    const nav = readFileSync('src/components/MainNav.tsx', 'utf8');
    assert.match(nav, /isAdministrator\(person\)\) links\.push\(\{ href: '\/platform\/errors'/);
  });
});
