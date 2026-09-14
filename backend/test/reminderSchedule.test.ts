import { describe, it, expect } from 'vitest';
import { nextRun, isTooLate, MISSED_RUN_GRACE_MS } from '../src/lib/reminderSchedule.js';

/**
 * Every date here is built with the local-time constructor, the same one the
 * scheduler uses. Writing them as ISO strings would pin them to UTC and the
 * assertions would drift with the machine's timezone.
 */
const local = (y: number, m: number, d: number, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0);

describe('daily', () => {
  it('fires later today when the time has not passed', () => {
    const after = local(2026, 9, 14, 9, 0);
    expect(nextRun({ type: 'daily', timeOfDay: '20:00' }, after)).toEqual(local(2026, 9, 14, 20, 0));
  });

  it('rolls to tomorrow once the time has passed', () => {
    const after = local(2026, 9, 14, 20, 30);
    expect(nextRun({ type: 'daily', timeOfDay: '20:00' }, after)).toEqual(local(2026, 9, 15, 20, 0));
  });

  // Strictly after, never equal — otherwise a run scheduled from its own due
  // moment would reschedule itself for the same instant and fire forever.
  it('does not return the moment it is already on', () => {
    const after = local(2026, 9, 14, 20, 0);
    expect(nextRun({ type: 'daily', timeOfDay: '20:00' }, after)).toEqual(local(2026, 9, 15, 20, 0));
  });

  it('crosses a month boundary', () => {
    const after = local(2026, 9, 30, 23, 0);
    expect(nextRun({ type: 'daily', timeOfDay: '08:00' }, after)).toEqual(local(2026, 10, 1, 8, 0));
  });

  it('crosses a year boundary', () => {
    const after = local(2026, 12, 31, 23, 0);
    expect(nextRun({ type: 'daily', timeOfDay: '08:00' }, after)).toEqual(local(2027, 1, 1, 8, 0));
  });
});

describe('weekly', () => {
  // 2026-09-14 is a Monday.
  it('finds the next selected day', () => {
    const monday = local(2026, 9, 14, 9, 0);
    // Friday = 5
    expect(nextRun({ type: 'weekly', timeOfDay: '20:00', weekdays: [5] }, monday))
      .toEqual(local(2026, 9, 18, 20, 0));
  });

  it('fires today when today is selected and the time is still ahead', () => {
    const monday = local(2026, 9, 14, 9, 0);
    expect(nextRun({ type: 'weekly', timeOfDay: '20:00', weekdays: [1] }, monday))
      .toEqual(local(2026, 9, 14, 20, 0));
  });

  // The eighth day of the search window is what covers this: today is the only
  // selected day, and its time has gone.
  it('wraps a whole week when today is the only day and it has passed', () => {
    const monday = local(2026, 9, 14, 21, 0);
    expect(nextRun({ type: 'weekly', timeOfDay: '20:00', weekdays: [1] }, monday))
      .toEqual(local(2026, 9, 21, 20, 0));
  });

  it('takes the soonest of several days', () => {
    const monday = local(2026, 9, 14, 21, 0);
    // Wednesday and Sunday
    expect(nextRun({ type: 'weekly', timeOfDay: '20:00', weekdays: [3, 0] }, monday))
      .toEqual(local(2026, 9, 16, 20, 0));
  });

  it('has no next run with no days selected', () => {
    expect(nextRun({ type: 'weekly', timeOfDay: '20:00', weekdays: [] }, local(2026, 9, 14)))
      .toBeNull();
  });
});

describe('monthly', () => {
  it('fires later this month', () => {
    const after = local(2026, 9, 5, 12, 0);
    expect(nextRun({ type: 'monthly', timeOfDay: '10:00', dayOfMonth: 20 }, after))
      .toEqual(local(2026, 9, 20, 10, 0));
  });

  it('rolls to next month once the day has passed', () => {
    const after = local(2026, 9, 25, 12, 0);
    expect(nextRun({ type: 'monthly', timeOfDay: '10:00', dayOfMonth: 20 }, after))
      .toEqual(local(2026, 10, 20, 10, 0));
  });

  // Somebody who picks the 31st means the last day of the month. Skipping the
  // short months would silently drop seven reminders a year.
  it('clamps the 31st to the last day of a 30-day month', () => {
    const after = local(2026, 11, 1, 0, 0);
    expect(nextRun({ type: 'monthly', timeOfDay: '10:00', dayOfMonth: 31 }, after))
      .toEqual(local(2026, 11, 30, 10, 0));
  });

  it('clamps the 31st to the 28th in a non-leap February', () => {
    const after = local(2027, 2, 1, 0, 0);
    expect(nextRun({ type: 'monthly', timeOfDay: '10:00', dayOfMonth: 31 }, after))
      .toEqual(local(2027, 2, 28, 10, 0));
  });

  it('clamps the 31st to the 29th in a leap February', () => {
    const after = local(2028, 2, 1, 0, 0);
    expect(nextRun({ type: 'monthly', timeOfDay: '10:00', dayOfMonth: 31 }, after))
      .toEqual(local(2028, 2, 29, 10, 0));
  });

  it('crosses a year boundary', () => {
    const after = local(2026, 12, 20, 12, 0);
    expect(nextRun({ type: 'monthly', timeOfDay: '10:00', dayOfMonth: 5 }, after))
      .toEqual(local(2027, 1, 5, 10, 0));
  });
});

describe('one-off', () => {
  it('returns its moment while it is still ahead', () => {
    const runAt = local(2026, 9, 20, 18, 0);
    expect(nextRun({ type: 'once', runAt }, local(2026, 9, 14))).toEqual(runAt);
  });

  // Null is what ends it: the row stops being picked up and is switched off.
  it('has nothing after it has passed', () => {
    const runAt = local(2026, 9, 10, 18, 0);
    expect(nextRun({ type: 'once', runAt }, local(2026, 9, 14))).toBeNull();
  });
});

describe('malformed schedules', () => {
  it('refuses a time that is not HH:MM', () => {
    expect(nextRun({ type: 'daily', timeOfDay: '25:00' }, local(2026, 9, 14))).toBeNull();
    expect(nextRun({ type: 'daily', timeOfDay: '8:00' }, local(2026, 9, 14))).toBeNull();
    expect(nextRun({ type: 'daily', timeOfDay: 'evening' }, local(2026, 9, 14))).toBeNull();
  });
});

describe('missed runs', () => {
  it('lets a run a few minutes late through', () => {
    const due = local(2026, 9, 14, 20, 0);
    expect(isTooLate(due, new Date(due.getTime() + 5 * 60_000))).toBe(false);
  });

  // "Quota deadline tonight" arriving the next morning is worse than one that
  // never arrives, because people act on it.
  it('skips a run left over from an outage', () => {
    const due = local(2026, 9, 14, 20, 0);
    expect(isTooLate(due, new Date(due.getTime() + MISSED_RUN_GRACE_MS + 1))).toBe(true);
  });
});
