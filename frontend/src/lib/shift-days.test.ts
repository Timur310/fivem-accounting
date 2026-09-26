import { describe, it, expect } from 'vitest';
import { dayKey, minutesByDay } from './shift-days';

/**
 * Built from local wall-clock times, so the tests mean the same thing in any
 * timezone the suite runs in — which is exactly the property the calendar
 * needs, since it cuts at the viewer's own midnight.
 */
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 8, day, hour, minute).toISOString();

const split = (start: string, end: string | null, breakMinutes = 0, now = Date.now()) =>
  Object.fromEntries(minutesByDay({ startedAt: start, endedAt: end, breakMinutes }, now));

describe('splitting a shift across days', () => {
  it('keeps a same-day shift on its day', () => {
    expect(split(at(25, 10), at(25, 14))).toEqual({ '2026-09-25': 240 });
  });

  // The bug as reported: 18:00 to 02:00 lost the two hours after midnight.
  it('puts the hours after midnight on the next day', () => {
    expect(split(at(25, 18), at(26, 2))).toEqual({
      '2026-09-25': 360,
      '2026-09-26': 120,
    });
  });

  it('shares the break between the two days in proportion', () => {
    // 8 hours, 40-minute break: 6h side takes 30, 2h side takes 10.
    expect(split(at(25, 18), at(26, 2), 40)).toEqual({
      '2026-09-25': 330,
      '2026-09-26': 110,
    });
  });

  it('never loses or invents a minute across the split', () => {
    const parts = split(at(25, 17, 20), at(26, 3, 50), 25);
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    // 10h30m gross, less 25 minutes, within a minute of rounding.
    expect(Math.abs(total - (630 - 25))).toBeLessThanOrEqual(1);
  });

  // A running shift counts up to now, so it shows on today's cell after
  // midnight rather than waiting for the clock-out.
  it('counts a running shift up to now, onto the next day', () => {
    expect(split(at(25, 22), null, 0, new Date(at(26, 1)).getTime())).toEqual({
      '2026-09-25': 120,
      '2026-09-26': 60,
    });
  });

  it('crosses a month boundary the same way', () => {
    expect(split(at(30, 23), new Date(2026, 9, 1, 1).toISOString())).toEqual({
      '2026-09-30': 60,
      '2026-10-01': 60,
    });
  });

  it('puts a shift ending exactly at midnight entirely on its first day', () => {
    expect(split(at(25, 20), at(26, 0))).toEqual({ '2026-09-25': 240 });
  });
});

describe('dayKey', () => {
  it('reads the local day, not the UTC one', () => {
    expect(dayKey(new Date(2026, 8, 26, 0, 30))).toBe('2026-09-26');
    expect(dayKey(new Date(2026, 8, 25, 23, 59))).toBe('2026-09-25');
  });
});
