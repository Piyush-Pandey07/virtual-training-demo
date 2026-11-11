import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dayInTrainingZone, formatMoment, formatSessionTime } from './time';

/**
 * Session times read the same on the server, which runs on UTC, and in the browser,
 * whatever its zone, and say which zone they are in.
 */
describe('times for people', () => {
  it('shows a session at its time in India, saying so', () => {
    assert.equal(formatSessionTime('2026-11-13T04:30:00.000Z'), 'Fri 13 Nov, 10:00 IST');
  });

  it('records a moment in full, in India time', () => {
    assert.equal(formatMoment('2026-11-10T18:19:29.000Z'), '10 November 2026, 23:49 IST');
  });

  it('dates by the day in India, which can be the day after the UTC one', () => {
    assert.equal(dayInTrainingZone('2026-11-12T20:00:00.000Z'), '2026-11-13');
    assert.equal(dayInTrainingZone('2026-11-12T10:00:00.000Z'), '2026-11-12');
  });
});
