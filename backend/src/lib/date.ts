/**
 * Date helpers.
 *
 * Postgres `date` columns are returned by Drizzle as `YYYY-MM-DD` strings,
 * so the API works with date strings rather than Date objects throughout.
 */

/**
 * Format a Date as a `YYYY-MM-DD` string using its **local** calendar date.
 *
 * Deliberately not `toISOString().slice(0, 10)`: that converts to UTC first, so
 * east of Greenwich a local midnight lands on the previous day. `new Date(2026,
 * 7, 1)` — 1 August — would come back as "2026-07-31" at UTC+2, shifting month
 * and week boundaries by a day for every quota, report and leaderboard.
 *
 * The dates this compares against (`entry_date`, `payout_date`) are plain
 * calendar dates with no timezone, so the local calendar day is the right
 * reading: a contribution logged at 00:30 belongs to that day, not yesterday.
 */
export function toDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Today's date as a `YYYY-MM-DD` string (UTC).
 */
export function todayDateString(): string {
  return toDateString(new Date());
}

/**
 * Format a value that may be a Date, a date string, or nullish.
 * Returns an empty string for nullish input — intended for CSV output.
 */
export function formatDateValue(value: Date | string | null | undefined): string {
  if (value == null) return '';
  return value instanceof Date ? toDateString(value) : String(value).slice(0, 10);
}

/**
 * Whole days elapsed since a `YYYY-MM-DD` date, or null when there is no date.
 * Used for inactivity reporting, where "never logged anything" and "logged
 * today" must stay distinguishable.
 */
export function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const then = new Date(`${dateStr}T00:00:00`).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}
