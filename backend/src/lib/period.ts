import { toDateString } from './date.js';

export interface PeriodRange {
  start: string;
  end: string;
}

/**
 * Compute the date range of the quota period containing `referenceDate`.
 *
 * - weekly: Monday-based 7-day window
 * - monthly: the calendar month
 *
 * Both bounds are inclusive `YYYY-MM-DD` strings, matching how `entry_date`
 * is stored and compared.
 */
export function getPeriodRange(periodType: string, referenceDate: Date): PeriodRange {
  const d = new Date(referenceDate);

  if (periodType === 'weekly') {
    // getDay(): Sunday = 0, Monday = 1 — shift so that Monday is the start.
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(d);
    monday.setDate(d.getDate() - diff);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: toDateString(monday), end: toDateString(sunday) };
  }

  // Monthly: day 0 of the next month is the last day of this one.
  const year = d.getFullYear();
  const month = d.getMonth();
  return {
    start: toDateString(new Date(year, month, 1)),
    end: toDateString(new Date(year, month + 1, 0)),
  };
}

/**
 * The period immediately before the one containing `referenceDate`. Quota
 * progress resets when a period rolls over, so without this the outcome of
 * the period that just closed is lost the moment a new one begins.
 */
export function getPreviousPeriodRange(periodType: string, referenceDate: Date): PeriodRange {
  const d = new Date(referenceDate);
  if (periodType === 'weekly') {
    return getPeriodRange(periodType, new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7));
  }
  return getPeriodRange(periodType, new Date(d.getFullYear(), d.getMonth() - 1, 1));
}
