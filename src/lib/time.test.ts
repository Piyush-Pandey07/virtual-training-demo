import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  dayHasPassed,
  dayInTrainingZone,
  formatDay,
  formatDayLong,
  formatDayShort,
  formatMoment,
  formatSessionTime,
  momentFromTrainingZoneInput,
} from './time';

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

/**
 * The "When" box of a new session gives a time with no zone, and it is India time.
 */
describe('a time typed into a box', () => {
  const savedZone = process.env.TZ;
  afterEach(() => {
    if (savedZone === undefined) delete process.env.TZ;
    else process.env.TZ = savedZone;
  });

  it('is read as India time, whatever zone the browser is in', () => {
    for (const zone of ['UTC', 'Asia/Dubai', 'Asia/Kolkata', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      const moment = momentFromTrainingZoneInput('2026-11-20T10:00');
      assert.equal(moment, '2026-11-20T04:30:00.000Z', zone);
      assert.equal(formatSessionTime(moment!), 'Fri 20 Nov, 10:00 IST', zone);
    }
  });

  it('takes seconds when the box gives them, and gives nothing for an empty or broken value', () => {
    assert.equal(momentFromTrainingZoneInput('2026-11-20T10:00:30'), '2026-11-20T04:30:30.000Z');
    assert.equal(momentFromTrainingZoneInput(''), undefined);
    assert.equal(momentFromTrainingZoneInput('tomorrow at ten'), undefined);
    assert.equal(momentFromTrainingZoneInput('2026-13-45T10:00'), undefined);
  });
});

/**
 * A day on its own, with no time (D-04).
 *
 * A UAT dry run found one approval reading "19 Nov" in a heading and "18 Nov" in the
 * panel beneath it, and a consent given on the 19th reading "18 November" on My
 * profile. Each was a date formatted without a zone: the browser gave the day in India
 * and the server the day in UTC, which is the day before until half past five in the
 * morning.
 */
describe('days for people', () => {
  /** 01:30 on 19 November in India, while it is still the 18th in UTC. */
  const EARLY = '2026-11-18T20:00:00.000Z';

  const savedZone = process.env.TZ;
  afterEach(() => {
    if (savedZone === undefined) delete process.env.TZ;
    else process.env.TZ = savedZone;
  });

  it('reads 18 November 20:00 UTC as the 19th, which it is in India', () => {
    assert.equal(formatDay(EARLY), '19 Nov 2026');
    assert.equal(formatDayLong(EARLY), '19 November 2026');
    assert.equal(formatDayShort(EARLY), '19 Nov');
  });

  it('turns the day over at midnight in India, half past six in the evening UTC', () => {
    assert.equal(formatDay('2026-11-18T18:29:59.000Z'), '18 Nov 2026');
    assert.equal(formatDay('2026-11-18T18:30:00.000Z'), '19 Nov 2026');
    assert.equal(formatDayLong('2026-11-18T18:29:59.000Z'), '18 November 2026');
    assert.equal(formatDayShort('2026-11-18T18:30:00.000Z'), '19 Nov');
    // And over the year end, where the year changes with it.
    assert.equal(formatDay('2026-12-31T19:00:00.000Z'), '1 Jan 2027');
  });

  it('gives the same text whatever zone the machine is in, server or browser', () => {
    // Node reads TZ again when it is set. Where a platform does not, each pass still
    // has to give the day in India, so the test can only be too easy, never wrong.
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Auckland']) {
      process.env.TZ = zone;
      assert.equal(formatDay(EARLY), '19 Nov 2026', zone);
      assert.equal(formatDayLong(EARLY), '19 November 2026', zone);
      assert.equal(formatDayShort(EARLY), '19 Nov', zone);
      assert.equal(dayInTrainingZone(EARLY), '2026-11-19', zone);
    }
  });

  it('reads a due date, which has no time, as the day that was typed', () => {
    assert.equal(formatDay('2026-11-20'), '20 Nov 2026');
    assert.equal(formatDayShort('2026-11-20'), '20 Nov');
    assert.equal(dayInTrainingZone('2026-11-20'), '2026-11-20');
  });

  it('gives nothing for a value that is not a date, so the caller chooses the words', () => {
    for (const helper of [formatDay, formatDayLong, formatDayShort]) {
      assert.equal(helper('not a date'), '');
      assert.equal(helper(''), '');
    }
  });

  it('counts a day as over only once it has ended in India', () => {
    // 08:30 on the 20th in India. Set against the clock, a date due "2026-11-20" is
    // midnight UTC and had already gone by; it is not late until the 21st.
    assert.equal(dayHasPassed('2026-11-20', new Date('2026-11-20T03:00:00.000Z')), false);
    // 23:59 on the 20th in India, and then midnight.
    assert.equal(dayHasPassed('2026-11-20', new Date('2026-11-20T18:29:00.000Z')), false);
    assert.equal(dayHasPassed('2026-11-20', new Date('2026-11-20T18:30:00.000Z')), true);
    // 01:30 on the 20th in India is the 19th in UTC: the 19th is over, the 20th is not.
    const early = new Date('2026-11-19T20:00:00.000Z');
    assert.equal(dayHasPassed('2026-11-19', early), true);
    assert.equal(dayHasPassed('2026-11-20', early), false);
    assert.equal(dayHasPassed('not a date', early), false);
  });
});

/**
 * Nothing outside this module formats a date for itself.
 *
 * Eighteen files did, most with their own copy of the same three lines and none naming
 * a zone, which is how D-04 came to be on so many pages at once. A new one would bring
 * it back on whichever page it was added to, and nothing else would notice: the text is
 * right for most of the day. Numbers are another matter, and `toLocaleString` on a count
 * of characters is left alone. So are the developer log and the audit history, which
 * show UTC on purpose, say so, and cut the day out of the ISO string to do it.
 */
describe('dates are formatted in one place', () => {
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) sourceFiles(path, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
    }
    return out;
  }

  const files = sourceFiles('src').filter((path) => !/[\\/]lib[\\/]time\.ts$/.test(path));

  it('finds the source, so a broken walk cannot pass silently', () => {
    assert.ok(files.length > 100, `only ${files.length} source files found`);
  });

  it('never calls the date formatters directly, with or without a zone', () => {
    const direct = /\.toLocaleDateString\(|\.toLocaleTimeString\(|Intl\.DateTimeFormat\b/;
    assert.deepEqual(
      files.filter((path) => direct.test(readFileSync(path, 'utf8'))),
      [],
      'format dates with the helpers in src/lib/time.ts, which name the training zone',
    );
  });

  it('never formats a new Date with toLocaleString, which takes the zone of the machine', () => {
    // Only the plainest way of writing it, since the same method on a number is fine.
    const onADate = /new Date\([^)]*\)\s*\.toLocaleString\(/;
    assert.deepEqual(
      files.filter((path) => onADate.test(readFileSync(path, 'utf8'))),
      [],
    );
  });
});
